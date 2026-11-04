"""Pure mappers from task.yungu.org payloads to the dashboard's TypeScript shapes
(frontend/src/lib/types.ts). No network, no clock reads: callers pass `now_ms` and `me`.

Field decisions (chosen from recorded fixtures, tests/fixtures/):
  * All wall-clock strings from Yungu ("2026-10-19 22:32:19", "...17:17:12.0") are China time.
  * Assignment.submittedAt: the Submitted list has no hand-in time field. `modifiedTime` on a
    Submitted item is the last change to the student's work (it falls between publish and
    deadline for on-time work, and 93251 moved when a comment was added), so it is used as the
    hand-in time, clamped by `ifTimeout` (see assignment()). Without it: min(dueAt, now_ms), i.e. never late and never in the future.
  * Assignment.status: 'Submitted' when doTaskStatus is 'Submitted' (doTaskStatusId 4), else 'To submit'.
  * Assignment.schoolGroup: only the three To-do group names survive; the Submitted/Archived
    group is literally "list" and maps to null.
  * Assignment.revision: the teacher sent the work back to edit (live 2026-11-04, 94616): Yungu lists it in
    To-do as doTaskStatus "To edit" / doTaskStatusId 3 under the group "Due update", with ifTimeout false and
    the ORIGINAL deadline, which may be long past. Yungu does not count it late, so neither does the dashboard.
  * AssignmentDetail.submitted: achievementStatus == 4 (the mixed detail's doTaskStatusId only if that is absent).
  * No deadline (`deadlineTimeMillis` / `endTime` null; the dashboard's dueAt is always a number): a
    Submitted item is due at its hand-in time (never late, filed under the week it was handed in); a
    To-do item gets NO_DEADLINE_MS (2099-12-31 23:59:59 China), so it sorts last and is never overdue.
  * AssignmentDetail.feedback: the teacher's grade, from getAchievementDetail's
    evaluationItemResultResponse.itemResultResponses[0] (empty = not graded or not released). scoreType 1
    is numeric ("4.5/5", out of the evaluation's totalScore, else the task's); 2 is a level (its English
    name, e.g. "Extraordinary [5]"). Rubric criteria take their names and levels from
    getMixedPublishDetail.evaluationItemRubricsResponses when the result points at it. AI feedback fields
    are null everywhere so far and are ignored. NOTES.md section 9.
  * FileRef.online: true for Yungu online documents (type "onlineDocument"); Yungu serves no file for them.
  * FileRef.kind: from the extension / guessed mime (mirrors the frontend's fileKind); Yungu's own
    `type` is only a fallback because it calls .numbers files "pdf". Apple iWork files count as
    office, so they get the PDF rendition Yungu's preview endpoint serves for them.
"""
import calendar
import mimetypes
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

CST = timezone(timedelta(hours=8))
SCHOOL_GROUPS = ("Due today", "Due recently", "Delayed")
PALETTE = ["Tomato", "Flamingo", "Tangerine", "Banana", "Sage", "Basil", "Peacock", "Blueberry",
           "Lavender", "Grape", "Graphite"]
ACHIEVEMENT_SUBMITTED = 4
TO_EDIT_STATUS_ID, TO_EDIT_STATUS, REVISION_GROUP = 3, "To edit", "Due update"   # returned for revision
ONLINE_DOCUMENT_TYPE = "onlineDocument"     # a Yungu online document: its text lives in Yungu, no stored file

_IMAGE = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"}
_VIDEO = {"mp4", "mov", "m4v", "webm", "avi", "mkv"}
_AUDIO = {"mp3", "m4a", "wav", "ogg", "aac", "flac"}
_OFFICE = {"doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "pages", "numbers", "key"}
_OFFICE_MIME = re.compile(r"officedocument|msword|ms-excel|ms-powerpoint|opendocument")
_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$")
# A notification's link to an assignment: '#/taskInfo/{taskPublishId}/…' (or the inner '#/stuTaskInfo/…').
_TASK_LINK = re.compile(r"#/(?:stu)?[tT]askInfo/(\d+)(?:[/?]|$)")


def china_ms(text) -> Optional[int]:
    """'2026-10-19 22:32[:19[.f]]' (China wall-clock) -> epoch ms; None if absent or malformed."""
    m = _TIME.match(text if isinstance(text, str) else "")
    if not m:
        return None
    y, mo, d, h, mi, s = (int(g or 0) for g in m.groups()[:6])
    frac = int((m.group(7) or "0")[:3].ljust(3, "0"))
    return int(datetime(y, mo, d, h, mi, s, tzinfo=CST).timestamp() * 1000) + frac


NO_DEADLINE_MS = china_ms("2099-12-31 23:59:59")


# ---------------------------------------------------------------- assignments
def _status(submitted: bool) -> str:
    return "Submitted" if submitted else "To submit"


def is_revision(raw: dict, group: Optional[str]) -> bool:
    """A To-do row the teacher returned for revision (see Assignment.revision above)."""
    return (raw.get("doTaskStatusId") == TO_EDIT_STATUS_ID or raw.get("doTaskStatus") == TO_EDIT_STATUS
            or group == REVISION_GROUP)


def assignment(raw: dict, group: Optional[str], now_ms: int) -> dict:
    """One getAllTasks task item -> Assignment. `group` is the item's groupName."""
    submitted = raw.get("doTaskStatus") == "Submitted" or raw.get("doTaskStatusId") == ACHIEVEMENT_SUBMITTED
    due = raw.get("deadlineTimeMillis")
    handed_in = None
    if submitted:
        handed_in = china_ms(raw.get("modifiedTime")) or min(due if due is not None else now_ms, now_ms)
    if due is None:
        due = handed_in if submitted else NO_DEADLINE_MS
    minutes = raw.get("expectFinishTime")
    out = {
        "id": raw["taskPublishId"],
        "title": raw["title"],
        "course": raw["courseName"],
        "courseId": raw["courseId"],
        "dueAt": due,
        "assignedAt": raw.get("publishTimeMillis") or due,
        "status": _status(submitted),
        "estimatedMinutes": minutes if minutes and minutes > 0 else None,
        "schoolGroup": group if group in SCHOOL_GROUPS else None,
        "revision": not submitted and is_revision(raw, group),
    }
    if submitted:
        at = handed_in
        # modifiedTime also moves on later comments, so `ifTimeout` (Yungu's own late flag) decides
        # which side of the deadline the hand-in time sits on: the UI shows "late" iff submittedAt > dueAt.
        if raw.get("deadlineTimeMillis") is None:
            pass                         # no deadline to be on either side of: dueAt is the hand-in time
        elif raw.get("ifTimeout") is False and at > due:
            at = due
        elif raw.get("ifTimeout") is True and at <= due:
            at = due + 1
        out["submittedAt"] = at
    return out


# ------------------------------------------------------------------- calendar
def class_event(raw: dict) -> dict:
    """One calendar item -> ClassEvent. Classes carry a courseId; routine items (meals, wake-up) do not."""
    course_id = raw.get("courseId") or None
    return {
        "name": raw.get("eName") or raw.get("name") or "",
        "room": raw.get("playground") or None,
        "start": raw["startTime"],
        "end": raw["endTime"],
        "isClass": course_id is not None,
        "courseId": course_id,
    }


# -------------------------------------------------------------------- courses
def courses(raw_list: List[dict]) -> List[dict]:
    """currentCourses -> Course[]. Colour = palette[position % 11] in (sortNo, courseId) order, so it
    does not depend on the order the API happens to return."""
    ordered = sorted(raw_list, key=lambda c: (c.get("sortNo") if c.get("sortNo") is not None else 10**9,
                                              c["courseId"]))
    return [{"id": c["courseId"], "name": c.get("courseName") or c.get("courseEnName") or "",
             "color": PALETTE[i % len(PALETTE)]} for i, c in enumerate(ordered)]


# ---------------------------------------------------------------------- files
def _extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _kind(mime: str, ext: str, yungu_type: Optional[str]) -> str:
    if mime == "application/pdf" or ext == "pdf":
        return "pdf"
    if ext in _OFFICE or _OFFICE_MIME.search(mime):
        return "office"
    if mime.startswith("image/") or ext in _IMAGE:
        return "image"
    if mime.startswith("video/") or ext in _VIDEO:
        return "video"
    if mime.startswith("audio/") or ext in _AUDIO:
        return "audio"
    return yungu_type if yungu_type in ("pdf", "image", "video", "audio") else "other"


def file_ref(raw: dict) -> dict:
    """A fileModelList / fileList entry -> FileRef. All bytes go through /api/files/<fileId>."""
    name = raw.get("fileName") or ""
    fid = str(raw["fileId"])
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    kind = _kind(mime, _extension(name), raw.get("type"))
    out = {
        "id": fid,
        "name": name,
        "kind": kind,
        "mime": mime,
        "size": raw.get("fileSizeByte") or 0,
        "url": f"/api/files/{fid}",
        "createdAt": china_ms(raw.get("fileCreateTime")) or 0,
    }
    if kind == "office":
        out["previewPdfUrl"] = f"/api/files/{fid}?preview=1"
    if raw.get("type") == ONLINE_DOCUMENT_TYPE:
        out["online"] = True
        out["content"] = raw.get("storeMeta") or raw.get("url") or ""   # the Quill delta JSON string
    return out


# ------------------------------------------------------------------- comments
def comment(raw: dict, me: int) -> dict:
    """A getAchievementDetail/comment row -> Comment. `mine` is by userId: Yungu's deletePermission
    is false even on the student's own comments."""
    author = f"{raw.get('userName') or ''} {raw.get('eName') or ''}".strip()
    return {
        "id": str(raw["feedbackId"]),
        "author": author,
        "mine": raw.get("userId") == me,
        "createdAt": china_ms(raw.get("feedbackTime")) or 0,
        "text": raw.get("descript") or "",
    }


# -------------------------------------------------------------- notifications
def _truthy(value) -> bool:
    """Yungu's client counts true, 1, "1" and "true" as read."""
    return value is True or value == 1 or (isinstance(value, str) and value.strip().lower() in ("1", "true"))


# Behaviour records (messageType 11): a new record, or a tier penalty from one. Yungu links them to
# #/studentTemplate or nowhere; messageType 11 also carries 校内安排, so the template code decides.
_BEHAVIOUR_TEMPLATES = ("BEHAVIOR_RECORD", "BEHAVIOR_TIER")


def notification(raw: dict) -> dict:
    """A messageCenter v2/page item -> Notification. English text first (title -> titleEn -> senderName in
    Yungu's own fallback order, English moved to the front); `taskId` only from a link to an assignment;
    `target` "behaviour" for a behaviour record (the Behaviour page), else None."""
    link = _TASK_LINK.search(raw.get("messageUrl") or "") if isinstance(raw.get("messageUrl"), str) else None
    return {
        "id": str(raw["messageId"]),
        "title": _text(raw.get("titleEn")) or _text(raw.get("title")) or _text(raw.get("senderName")) or "",
        "body": _text(raw.get("contentEn")) or _text(raw.get("content")) or "",
        "createdAt": china_ms(raw.get("messageSendTime")) or 0,
        "read": _truthy(raw.get("ifRead")) or _truthy(raw.get("read")),
        "taskId": int(link.group(1)) if link else None,
        "target": "behaviour" if raw.get("templateCode") in _BEHAVIOUR_TEMPLATES else None,
    }


# --------------------------------------------------------------------- detail
def achievement_status(mixed: dict, achievement: dict) -> Optional[int]:
    """The student's status on the task: the achievement's, else the task-level one (None if neither)."""
    status_id = achievement.get("achievementStatus")
    return mixed.get("doTaskStatusId") if status_id is None else status_id


def is_submitted(mixed: dict, achievement: dict) -> bool:
    return achievement_status(mixed, achievement) == ACHIEVEMENT_SUBMITTED


def hand_in_on_yungu(mixed: dict, achievement: dict) -> Optional[List[str]]:
    """What the teacher has, when Yungu's own read says so: once submitted and with no draft open
    (`ifEditStatus` false), `fileModelList` IS the hand-in. None while a draft differs from it
    (`ifEditStatus` true or unknown) or before a hand-in."""
    if not is_submitted(mixed, achievement) or achievement.get("ifEditStatus") is not False:
        return None
    return [str(f["fileId"]) for f in achievement.get("fileModelList") or []]


def handed_in_ids(mixed: dict, achievement: dict, submitted_ids: Optional[List[str]]) -> List[str]:
    """File ids with the teacher: none before a hand-in; Yungu's list when no draft is open; else the
    kept list (the last hand-in the service saw), or, unknown, every current file (when unsure, a
    file counts as handed in)."""
    if not is_submitted(mixed, achievement):
        return []
    shown = hand_in_on_yungu(mixed, achievement)
    if shown is not None:
        return shown
    if submitted_ids is None:
        return [str(f["fileId"]) for f in achievement.get("fileModelList") or []]
    return list(submitted_ids)


def needs_files(mixed: dict, achievement: dict) -> bool:
    """'Attachment required' (needEnclosure): the achievement's flag, else the task's. Missing or null
    = True, so we never offer a hand-in Yungu might refuse."""
    for source in (achievement, mixed):
        value = source.get("needEnclosure")
        if value is not None:
            return bool(value)
    return True


def _text(value) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _criterion(raw: dict, rubrics: List[dict]) -> dict:
    """One itemIndicatorResultModelList row -> {name, result, description?}, the rubric's wording first."""
    rubric = next((r for r in rubrics if r.get("id") == raw.get("indicatorId")), {})
    level = next((i for i in rubric.get("list") or [] if i.get("id") == raw.get("evaluationCriterionItemId")), {})
    out = {
        "name": (_text(raw.get("indicatorEname")) or _text(rubric.get("ename")) or _text(raw.get("indicatorName"))
                 or _text(rubric.get("name")) or ""),
        "result": (_text(level.get("ename")) or _text(level.get("name")) or _text(raw.get("levelName"))
                   or _text(raw.get("score")) or ""),
    }
    description = _text(level.get("descriptionEn")) or _text(level.get("description")) or _text(raw.get("description"))
    if description:
        out["description"] = description
    return out


def feedback(mixed: dict, achievement: dict) -> Optional[dict]:
    """The teacher's grade and written feedback -> AssignmentDetail.feedback; None before grading (or when
    there is nothing to show: no score, no comment, no criteria)."""
    evaluation = achievement.get("evaluationItemResultResponse") or {}
    results = evaluation.get("itemResultResponses") or []
    result = results[0] if results and isinstance(results[0], dict) else None
    if result is None or result.get("status") not in (None, 1):      # Yungu shows a result only at status 1
        return None
    if result.get("scoreType") == 2:
        level = result.get("criterionItemResponse") or {}
        score = _text(level.get("levelEName")) or _text(level.get("levelName")) or ""
    else:
        points = _text(str(result["score"])) if result.get("score") is not None else None
        total = _text(str(evaluation.get("totalScore") or mixed.get("totalScore") or ""))
        score = f"{points}/{total}" if points and total else points or ""
    rubrics = [r for r in mixed.get("evaluationItemRubricsResponses") or [] if isinstance(r, dict)]
    criteria = [_criterion(c, rubrics) for c in result.get("itemIndicatorResultModelList") or [] if isinstance(c, dict)]
    comment_text = _text(result.get("feedback"))
    if not score and not comment_text and not criteria:
        return None
    return {
        "score": score,
        "comment": comment_text,
        "criteria": criteria,
        "updatedAt": china_ms(result.get("modifyTime")) or china_ms(result.get("createTime")),
    }


def detail(mixed: dict, achievement: dict, comments: List[dict], me: int,
           submitted_ids: Optional[List[str]], listed: Optional[dict] = None) -> dict:
    """getMixedPublishDetail + getAchievementDetail + comments -> AssignmentDetail.

    `submitted_ids`: the kept hand-in list (the last hand-in the service saw), or None when unknown;
    Yungu's own list wins whenever no draft is open (see handed_in_ids). `listed`: the mapped list
    Assignment for the same task, if the caller has it, which supplies schoolGroup, revision and submittedAt
    (the detail endpoints carry none of them). `instructionsHtml` is raw; Next sanitises it."""
    submitted = is_submitted(mixed, achievement)
    my_files = [file_ref(f) for f in achievement.get("fileModelList") or []]
    handed_in = handed_in_ids(mixed, achievement, submitted_ids)
    minutes = mixed.get("useTime")
    due = china_ms(mixed.get("endTime")) or (listed or {}).get("dueAt") or NO_DEADLINE_MS
    out = {
        "id": mixed["taskPublishId"],
        "title": mixed["taskTitle"],
        "course": mixed["courseName"],
        "courseId": mixed["courseId"],
        "dueAt": due,
        "assignedAt": china_ms(mixed.get("sendTime")) or due,
        "status": _status(submitted),
        "estimatedMinutes": minutes if minutes and minutes > 0 else None,
        "schoolGroup": (listed or {}).get("schoolGroup"),
        "revision": not submitted and (listed or {}).get("revision") is True,
        "teacher": ", ".join(t["userName"] for t in mixed.get("mainTeachers") or [] if t.get("userName")),
        "instructionsHtml": mixed.get("taskContent") or mixed.get("taskDescription") or "",
        # type 'link' entries are embedded players (an <iframe> in `url`), not files /api/files can serve.
        "attachments": [file_ref(f) for f in mixed.get("fileList") or [] if f.get("type") != "link"],
        "myFiles": my_files,
        "submittedFileIds": handed_in,
        "submitted": submitted,
        "needsFiles": needs_files(mixed, achievement),
        "comments": sorted((comment(c, me) for c in comments or []), key=lambda c: (c["createdAt"], c["id"])),
        "feedback": feedback(mixed, achievement),
    }
    if listed and listed.get("submittedAt") is not None and submitted:
        out["submittedAt"] = listed["submittedAt"]
    return out


# ------------------------------------------------------------------ behaviour
# 凌云积分 (Lingyun points) for one China calendar month; Yungu's requests and fields in NOTES.md section 11.
_MONTH = re.compile(r"([0-9]{4})-(0[1-9]|1[0-2])")
TIER_ID_PREFIX = "tier-"        # tier rows number apart from records: their ids may coincide


def month_window(month) -> Tuple[str, str]:
    """'2026-10' -> ('2026-10-01', '2026-10-31'): the month's first and last China dates, as Yungu takes them.
    ValueError for anything but YYYY-MM."""
    m = _MONTH.fullmatch(month) if isinstance(month, str) else None
    if not m:
        raise ValueError("month must be YYYY-MM")
    year, mon = int(m.group(1)), int(m.group(2))
    return f"{year:04d}-{mon:02d}-01", f"{year:04d}-{mon:02d}-{calendar.monthrange(year, mon)[1]:02d}"


def _points(value):
    """Yungu's signed score ('+2', '-5', '-2.0', 8.0) -> 2 / -5 / -2 / 8 (int when whole); None if absent."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value.strip())
        except ValueError:
            return None
    if not isinstance(value, (int, float)) or value != value or value in (float("inf"), float("-inf")):
        return None
    return int(value) if float(value).is_integer() else value


def _total(total, key: str, required: bool = False):
    value = total.get(key) if isinstance(total, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        if required:
            raise ValueError(f"stu/detail has no number for {key}")
        return 0
    return _points(value)


def _utc_ms(value) -> Optional[int]:
    """'2026-10-20T06:58:22.000+00:00' (an instant; no offset = UTC) -> epoch ms."""
    if not isinstance(value, str):
        return None
    try:
        when = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return int(when.timestamp() * 1000)


def _is_tier(raw: dict) -> bool:
    """A T1–T3 disciplinary tier row: a level and no points."""
    return raw.get("level") is not None and _points(raw.get("score")) is None


def _record(raw: dict, at: int, revoked: bool, points) -> dict:
    tier = _is_tier(raw)
    if tier:
        kind = "tier"
    elif raw.get("type") == 0:
        kind = "bonus"
    elif raw.get("type") == 2:
        kind = "deduction"
    else:
        kind = "bonus" if (points or 0) >= 0 else "deduction"
    subject = None
    if raw.get("subjectId") not in (-1, "-1"):                       # -1 = 其他 (other): no subject
        subject = _text(raw.get("subjectEnName")) or _text(raw.get("subjectName"))
    level = raw.get("level")
    return {
        "id": (TIER_ID_PREFIX if tier else "") + str(raw["id"]),
        "name": _text(raw.get("behaviorTypeName")) or _text(raw.get("behaviorTypeEnName")) or "",
        "points": None if tier else points,
        "level": level if tier and isinstance(level, int) else None,
        "kind": kind,
        "at": at,
        "subject": subject,
        "recorder": (_text(raw.get("creatorEnName")) or _text(raw.get("creatorName"))
                     or _text(raw.get("recordActorEnName")) or _text(raw.get("recordActorName"))),
        "remark": _text(raw.get("desc")),
        "revoked": revoked,
    }


def behaviour(month: str, total: dict, rows: List[dict]) -> dict:
    """stu/detail's row + every allStu/behavior row of the month -> Behaviour.

    The number and the chip totals are Yungu's (`score`, `positiveScore`, `negativeScore`), never a sum
    of rows. Rows: each id once (pages can repeat rows); a revoked record is one row, `revoked`, at the
    original's time with the original's points (Yungu lists the original plus a revocation row with the
    same id, `revoke: true`, the opposite sign and the revocation's time; either half may fall in another
    month, and an original whose revocation is elsewhere still carries `revokeIcon: true`). Times come
    from `recordTime` (UTC); a row whose China date is outside the month is dropped. Counts: records
    per side that count (not revoked, not tiers). Newest first; ties keep Yungu's order."""
    first, last = month_window(month)
    score = _total(total, "score", required=True)
    originals, revocations, order = {}, {}, {}           # order: first sighting of each key
    for raw in rows or []:
        if not isinstance(raw, dict) or raw.get("id") is None:
            continue
        at = _utc_ms(raw.get("recordTime")) or _utc_ms(raw.get("sortTime")) or _utc_ms(raw.get("createDate"))
        if at is None:
            continue
        day = datetime.fromtimestamp(at / 1000, CST).strftime("%Y-%m-%d")
        if not first <= day <= last:
            continue
        key = ("tier" if _is_tier(raw) else "record", str(raw["id"]))
        bucket = revocations if raw.get("revoke") is True and key[0] == "record" else originals
        if key in bucket:
            continue
        bucket[key] = (raw, at)
        order.setdefault(key, None)
    records = []
    for key in order:
        if key in originals:
            raw, at = originals[key]
            revoked = key in revocations or raw.get("revokeIcon") is True or raw.get("revoke") is True
            points = _points(raw.get("score"))
        else:
            raw, at = revocations[key]
            revoked = True
            points = _points(raw.get("score"))
            points = -points if points is not None else None
        records.append(_record(raw, at, revoked, points))
    records.sort(key=lambda r: -r["at"])
    counted = [r for r in records if not r["revoked"]]
    return {
        "month": month,
        "score": score,
        "bonus": _total(total, "positiveScore"),
        "deduction": _total(total, "negativeScore"),
        "bonusCount": sum(r["kind"] == "bonus" for r in counted),
        "deductionCount": sum(r["kind"] == "deduction" for r in counted),
        "records": records,
    }
