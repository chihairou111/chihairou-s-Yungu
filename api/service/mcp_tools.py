"""The seven read-only MCP tools, over one account's `Student` (app.py): the same read paths, session and
60 s read cache as the dashboard. Nothing here writes to Yungu or Todoist or hands out file bytes: files are
dashboard links only.

Each tool answers `(summary, data)`: a short sentence for the agent and compact JSON-able data. Times are
China time ISO 8601 ("2026-10-23T22:00:00+08:00"); "no deadline" is null. `run` turns every failure into a
`ToolFailure` with a message fit for the agent (never a stack trace) and a short status for the log.
"""
import html
import re
from datetime import date as Date, datetime, timedelta
from html.parser import HTMLParser
from typing import Any, Callable, Dict, List, Optional, Tuple

import mapping
from yungu_task import CST

from .yungu import UNREACHABLE, ServiceError, SignInAgain, Unavailable

PUBLIC_URL = "https://yungu.chihairou.dev"
SIGN_IN_TO_DASHBOARD = "Sign in to the dashboard again to keep agent access working."
NO_SUCH_ASSIGNMENT = "No assignment with that id."
SOMETHING_WRONG = "Something went wrong reading Yungu. Try again."
NEARLY_OVERDUE_MS = 24 * 3600 * 1000           # the dashboard's "nearly overdue" (frontend/src/lib/priority.ts)
DEFAULT_LIMIT, MAX_LIMIT = 20, 100
MAX_NOTIFICATIONS = 50
MAX_INSTRUCTIONS_CHARS = 20000
EARLIEST_MONTH = "2000-01"
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_MONTH = re.compile(r"[0-9]{4}-(0[1-9]|1[0-2])")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


class ToolFailure(Exception):
    """What the agent is told (`message`) and what the log says (`status`)."""

    def __init__(self, message: str, status: str):
        super().__init__(message)
        self.message, self.status = message, status


def _bad(message: str) -> ToolFailure:
    return ToolFailure(message, "bad_arguments")


# ------------------------------------------------------------------ shapes
def iso(ms) -> Optional[str]:
    """Epoch ms -> China time ISO 8601; None for no time (or the no-deadline sentinel)."""
    if not isinstance(ms, int) or isinstance(ms, bool) or ms <= 0 or ms == mapping.NO_DEADLINE_MS:
        return None
    return datetime.fromtimestamp(ms / 1000, CST).isoformat(timespec="seconds")


def relative(due: int, now: int) -> Optional[str]:
    """As the dashboard says it (relativeDue): "in 3 days", "2 h late"."""
    if due == mapping.NO_DEADLINE_MS:
        return None
    diff = due - now
    gap = abs(diff)
    if gap < 3600_000:
        text = f"{gap // 60_000} min"
    elif gap < 86400_000:
        text = f"{gap // 3600_000} h"
    else:
        days = gap // 86400_000
        text = f"{days} {'day' if days == 1 else 'days'}"
    return f"{text} late" if diff < 0 else f"in {text}"


def priority(a: dict, now: int) -> str:
    """As the dashboard's priorityOf: overdue (past due, or Yungu's Delayed), nearly overdue (due within
    24 h), upcoming."""
    if a["dueAt"] < now or a.get("schoolGroup") == "Delayed":
        return "overdue"
    if a["dueAt"] - now <= NEARLY_OVERDUE_MS:
        return "nearly overdue"
    return "upcoming"


def assignment_link(aid) -> str:
    return f"{PUBLIC_URL}/assignments?task={aid}"


class _Text(HTMLParser):
    """Teacher HTML -> plain text: blocks on their own lines, list items as "- ", links keep their URL."""
    BLOCKS = {"p", "div", "br", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6",
              "blockquote", "pre", "section", "article", "hr"}
    SKIP = {"script", "style", "head", "title"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self._skip = 0
        self._href: List[Optional[str]] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag in self.BLOCKS:
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("- ")
        elif tag in ("td", "th"):
            self.parts.append(" ")
        elif tag == "a":
            href = dict(attrs).get("href")
            self._href.append(href if isinstance(href, str) and href.startswith(("http://", "https://")) else None)

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
        elif tag in self.BLOCKS:
            self.parts.append("\n")
        elif tag == "a" and self._href:
            href = self._href.pop()
            if href:
                self.parts.append(f" ({href})")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def plain_text(markup: str) -> str:
    parser = _Text()
    try:
        parser.feed(markup or "")
        parser.close()
        text = "".join(parser.parts)
    except Exception:                                    # malformed beyond the parser: drop the tags crudely
        text = html.unescape(re.sub(r"<[^>]*>", " ", markup or ""))
    lines = [re.sub(r"[ \t 　]+", " ", line).strip() for line in text.replace("\r", "").split("\n")]
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return out if len(out) <= MAX_INSTRUCTIONS_CHARS else out[:MAX_INSTRUCTIONS_CHARS].rstrip() + " …"


def _file_link(ref: dict, aid) -> dict:
    """A FileRef -> {name, kind, link}: the dashboard opens it (with the student's own dashboard session)."""
    if ref.get("online"):
        return {"name": ref["name"], "kind": "online document", "link": assignment_link(aid)}
    return {"name": ref["name"], "kind": ref["kind"], "link": f"{PUBLIC_URL}/api/files/{ref['id']}"}


def _count(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


# --------------------------------------------------------------- arguments
def _check_keys(args: Dict[str, Any], allowed: Tuple[str, ...]) -> None:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise _bad(f"Unknown argument: {unknown[0][:40]}.")


def _int(args: Dict[str, Any], key: str, default: Optional[int], low: int, high: int) -> Optional[int]:
    value = args.get(key)
    if value is None:
        return default
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        value = int(value.strip())
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise _bad(f"{key} must be a whole number from {low} to {high}.")
    return value


def _bool(args: Dict[str, Any], key: str) -> bool:
    value = args.get(key)
    if value is None:
        return False
    if not isinstance(value, bool):
        raise _bad(f"{key} must be true or false.")
    return value


def _str(args: Dict[str, Any], key: str) -> Optional[str]:
    value = args.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _bad(f"{key} must be text.")
    return value.strip() or None


def _today(now: int) -> Date:
    return datetime.fromtimestamp(now / 1000, CST).date()


def _day_ms(day: Date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=CST).timestamp() * 1000)


# ------------------------------------------------------------------- tools
def list_todo(me, args) -> Tuple[str, dict]:
    _check_keys(args, ())
    now = me.now_ms()
    order = ("overdue", "nearly overdue", "upcoming")
    todo = [a for a in me.todo() if a.get("status") != "Submitted"]
    todo.sort(key=lambda a: (order.index(priority(a, now)), a["dueAt"]))      # as the dashboard groups them
    rows = [{"id": a["id"], "title": a["title"], "course": a["course"], "due": iso(a["dueAt"]),
             "dueRelative": relative(a["dueAt"], now), "priority": priority(a, now),
             "estimatedMinutes": a.get("estimatedMinutes"), "link": assignment_link(a["id"])} for a in todo]
    if not rows:
        return "Nothing to do: every assignment is handed in.", {"count": 0, "assignments": []}
    parts = [f"{n} {p}" for p in order if (n := sum(r["priority"] == p for r in rows))]
    return (f"{_count(len(rows), 'assignment')} to do: {', '.join(parts)}.",
            {"count": len(rows), "assignments": rows})


def list_submitted(me, args) -> Tuple[str, dict]:
    _check_keys(args, ("course", "limit"))
    course = _str(args, "course")
    limit = _int(args, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)
    rows = me.submitted_list()
    if course:
        wanted = course.casefold()
        rows = [a for a in rows if wanted in (a.get("course") or "").casefold()]
    shown = rows[:limit]
    items = [{"id": a["id"], "title": a["title"], "course": a["course"], "due": iso(a["dueAt"]),
              "submittedAt": iso(a.get("submittedAt")),
              "late": isinstance(a.get("submittedAt"), int) and a["submittedAt"] > a["dueAt"],
              "link": assignment_link(a["id"])} for a in shown]
    where = f" for courses matching \"{course[:64]}\"" if course else ""
    if not items:
        return f"No handed-in assignments{where}.", {"total": 0, "assignments": []}
    return (f"{len(items)} of {_count(len(rows), 'handed-in assignment')}{where}, newest hand-in first.",
            {"total": len(rows), "assignments": items})


def get_assignment(me, args) -> Tuple[str, dict]:
    _check_keys(args, ("id",))
    if args.get("id") is None:
        raise _bad("id is required: an assignment id from list_todo or list_submitted.")
    aid = _int(args, "id", None, 1, 10**12)
    now = me.now_ms()
    try:
        d = me.detail(aid)
    except ServiceError as e:
        if getattr(e, "status", None) == 404:
            raise ToolFailure(NO_SUCH_ASSIGNMENT, "not_found") from None
        raise
    feedback = d.get("feedback")
    submitted_at = d.get("submittedAt")
    data = {
        "id": d["id"], "title": d["title"], "course": d["course"], "teacher": d.get("teacher") or None,
        "due": iso(d["dueAt"]), "dueRelative": None if d["submitted"] else relative(d["dueAt"], now),
        "status": "submitted" if d["submitted"] else "to submit",
        "submittedAt": iso(submitted_at),
        "late": isinstance(submitted_at, int) and submitted_at > d["dueAt"],
        "estimatedMinutes": d.get("estimatedMinutes"),
        "instructions": plain_text(d.get("instructionsHtml") or ""),
        "attachments": [_file_link(f, d["id"]) for f in d.get("attachments") or []],
        "myFiles": [{"name": f["name"]} for f in d.get("myFiles") or []],
        "feedback": None if not feedback else {
            "score": feedback.get("score") or None, "comment": feedback.get("comment"),
            "criteria": feedback.get("criteria") or [], "updatedAt": iso(feedback.get("updatedAt"))},
        "comments": [{"author": c["author"], "mine": c["mine"], "at": iso(c["createdAt"]), "text": c["text"]}
                     for c in d.get("comments") or []],
        "link": assignment_link(d["id"]),
    }
    state = "handed in" if d["submitted"] else (f"due {data['dueRelative']}" if data["dueRelative"] else "no deadline")
    graded = f", feedback: {data['feedback']['score']}" if data["feedback"] and data["feedback"]["score"] else (
        ", has feedback" if data["feedback"] else "")
    return f"{d['title']} ({d['course']}): {state}{graded}.", data


def _event(e: dict) -> dict:
    return {"name": e["name"], "room": e.get("room"), "start": iso(e["start"]), "end": iso(e["end"]),
            "type": "class" if e.get("isClass") else "other"}


def get_schedule(me, args) -> Tuple[str, dict]:
    _check_keys(args, ("date", "week"))
    text = _str(args, "date")
    week = _bool(args, "week")
    now = me.now_ms()
    if text is None:
        day = _today(now)
    else:
        try:
            if not _DATE.fullmatch(text):
                raise ValueError
            day = Date.fromisoformat(text)
        except ValueError:
            raise _bad("date must be YYYY-MM-DD (China time).") from None
    events = me.week(_day_ms(day))
    monday = day - timedelta(days=day.weekday())
    days = []
    for offset in range(7):
        d = monday + timedelta(days=offset)
        start, end = _day_ms(d), _day_ms(d + timedelta(days=1))
        days.append({"date": d.isoformat(), "weekday": WEEKDAYS[offset],
                     "events": [_event(e) for e in events if start <= e["start"] < end]})
    if week:
        classes = sum(e["type"] == "class" for d in days for e in d["events"])
        return (f"Week of {monday.isoformat()}: {_count(classes, 'class', 'classes')}.",
                {"weekStart": monday.isoformat(), "days": days})
    one = days[day.weekday()]
    classes = sum(e["type"] == "class" for e in one["events"])
    return (f"{one['weekday']} {one['date']}: {_count(classes, 'class', 'classes')}"
            f"{'' if classes == len(one['events']) else ', ' + _count(len(one['events']) - classes, 'other item')}.",
            one)


def list_courses(me, args) -> Tuple[str, dict]:
    _check_keys(args, ())
    rows = [{"id": c["id"], "name": c["name"]} for c in me.courses()]
    names = ", ".join(c["name"] for c in rows)
    return (f"{_count(len(rows), 'course')}{': ' + names if rows else ''}.", {"courses": rows})


def get_behaviour(me, args) -> Tuple[str, dict]:
    _check_keys(args, ("month",))
    month = _str(args, "month")
    this_month = datetime.fromtimestamp(me.now_ms() / 1000, CST).strftime("%Y-%m")
    month = month or this_month
    if not _MONTH.fullmatch(month) or not EARLIEST_MONTH <= month <= this_month:
        raise _bad(f"month must be YYYY-MM, no later than {this_month}.")
    b = me.behaviour(month)
    records = [{"name": r["name"], "points": r["points"], "level": r["level"], "kind": r["kind"],
                "at": iso(r["at"]), "subject": r["subject"], "recorder": r["recorder"], "reason": r["remark"],
                "revoked": r["revoked"]} for r in b["records"]]
    data = {"month": b["month"], "score": b["score"], "bonus": b["bonus"], "deduction": b["deduction"],
            "bonusCount": b["bonusCount"], "deductionCount": b["deductionCount"], "records": records}
    return (f"凌云积分 for {month}: {b['score']} ({_count(b['bonusCount'], 'bonus', 'bonuses')} "
            f"{b['bonus']:+}, {_count(b['deductionCount'], 'deduction')} -{abs(b['deduction'])}).", data)


def list_notifications(me, args) -> Tuple[str, dict]:
    _check_keys(args, ("unread_only", "limit"))
    unread_only = _bool(args, "unread_only")
    limit = _int(args, "limit", DEFAULT_LIMIT, 1, MAX_NOTIFICATIONS)
    rows = list(me.notifications(False, 1, limit)["items"])            # Yungu lists unread and read apart
    if not unread_only:
        rows += me.notifications(True, 1, limit)["items"]
    rows.sort(key=lambda n: -n["createdAt"])
    items = [{"id": n["id"], "title": n["title"], "text": n["body"], "time": iso(n["createdAt"]),
              "read": n["read"], "assignmentId": n.get("taskId")} for n in rows[:limit]]
    unread = sum(not n["read"] for n in items)
    if not items:
        return ("No unread notifications." if unread_only else "No notifications."), {"notifications": []}
    what = "unread notification" if unread_only else "notification"
    tail = "" if unread_only else f" ({unread} unread)"
    return f"{_count(len(items), what)}{tail}, newest first.", {"notifications": items}


# --------------------------------------------------------------- the list
_NO_ARGS = {"type": "object", "properties": {}, "additionalProperties": False}
TOOLS: Dict[str, dict] = {
    "list_todo": {
        "fn": list_todo, "title": "To-do assignments",
        "description": ("The student's assignments not yet handed in, most urgent first: id, title, course, due "
                        "(China time, ISO 8601) and how far off, priority (overdue / nearly overdue = due within "
                        "24 h / upcoming) and estimated minutes."),
        "schema": _NO_ARGS},
    "list_submitted": {
        "fn": list_submitted, "title": "Handed-in assignments",
        "description": "Handed-in assignments, newest hand-in first; optionally only courses whose name contains `course`.",
        "schema": {"type": "object", "additionalProperties": False, "properties": {
            "course": {"type": "string", "description": "Part of a course name (case-insensitive)."},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT}}}},
    "get_assignment": {
        "fn": get_assignment, "title": "Assignment details",
        "description": ("One assignment by id: title, course, teacher, due, status, instructions as plain text, "
                        "attachments (name, kind, dashboard link), the student's own files (names), the teacher's "
                        "feedback (score or level, comment, criteria) and comments."),
        "schema": {"type": "object", "additionalProperties": False, "required": ["id"], "properties": {
            "id": {"type": "integer", "description": "Assignment id from list_todo or list_submitted."}}}},
    "get_schedule": {
        "fn": get_schedule, "title": "Class schedule",
        "description": ("Classes and other timetable items (name, room, start, end in China time) for one day "
                        "(default today, China time), or for that day's whole week (Monday to Sunday)."),
        "schema": {"type": "object", "additionalProperties": False, "properties": {
            "date": {"type": "string", "description": "YYYY-MM-DD, China time. Default today."},
            "week": {"type": "boolean", "default": False, "description": "The whole week of `date`."}}}},
    "list_courses": {
        "fn": list_courses, "title": "Courses", "description": "The student's current courses (id, name).",
        "schema": _NO_ARGS},
    "get_behaviour": {
        "fn": get_behaviour, "title": "Behaviour points (凌云积分)",
        "description": ("凌云积分 (behaviour points) for one month: the score, bonus and deduction totals and every "
                        "record with its points, reason, subject and who recorded it."),
        "schema": {"type": "object", "additionalProperties": False, "properties": {
            "month": {"type": "string", "description": "YYYY-MM, China time. Default this month."}}}},
    "list_notifications": {
        "fn": list_notifications, "title": "Notifications",
        "description": ("Yungu notifications, newest first: title, text, time, read or not, and the linked "
                        "assignment id when there is one. Reading them here does not mark them read."),
        "schema": {"type": "object", "additionalProperties": False, "properties": {
            "unread_only": {"type": "boolean", "default": False},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_NOTIFICATIONS, "default": DEFAULT_LIMIT}}}},
}


def run(me, name: str, args) -> Tuple[str, dict]:
    """Run tool `name` for `me` (a Student). ToolFailure for anything but an answer."""
    tool = TOOLS.get(name)
    if tool is None:
        raise ToolFailure("Unknown tool.", "unknown_tool")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise _bad("Arguments must be an object.")
    fn: Callable = tool["fn"]
    try:
        return fn(me, args)
    except ToolFailure:
        raise
    except SignInAgain:                    # also PasswordChanged; never a Yungu login for anyone but the owner
        raise ToolFailure(SIGN_IN_TO_DASHBOARD, "sign_in") from None
    except Unavailable:
        raise ToolFailure(UNREACHABLE, "unavailable") from None
    except ServiceError as e:
        if e.status == 400:
            raise _bad(e.message) from None
        raise ToolFailure(UNREACHABLE, "unavailable") from None
