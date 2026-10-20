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
  * AssignmentDetail.submitted: achievementStatus == 4 (the mixed detail's doTaskStatusId only if that is absent).
  * No deadline (`deadlineTimeMillis` / `endTime` null; the dashboard's dueAt is always a number): a
    Submitted item is due at its hand-in time (never late, filed under the week it was handed in); a
    To-do item gets NO_DEADLINE_MS (2099-12-31 23:59:59 China), so it sorts last and is never overdue.
  * FileRef.online: true for Yungu online documents (type "onlineDocument"); Yungu serves no file for them.
  * FileRef.kind: from the extension / guessed mime (mirrors the frontend's fileKind); Yungu's own
    `type` is only a fallback because it calls .numbers files "pdf". Apple iWork files count as
    office, so they get the PDF rendition Yungu's preview endpoint serves for them.
"""
import mimetypes
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

CST = timezone(timedelta(hours=8))
SCHOOL_GROUPS = ("Due today", "Due recently", "Delayed")
PALETTE = ["Tomato", "Flamingo", "Tangerine", "Banana", "Sage", "Basil", "Peacock", "Blueberry",
           "Lavender", "Grape", "Graphite"]
ACHIEVEMENT_SUBMITTED = 4
ONLINE_DOCUMENT_TYPE = "onlineDocument"     # a Yungu online document: its text lives in Yungu, no stored file

_IMAGE = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"}
_VIDEO = {"mp4", "mov", "m4v", "webm", "avi", "mkv"}
_AUDIO = {"mp3", "m4a", "wav", "ogg", "aac", "flac"}
_OFFICE = {"doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "pages", "numbers", "key"}
_OFFICE_MIME = re.compile(r"officedocument|msword|ms-excel|ms-powerpoint|opendocument")
_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$")


def china_ms(text) -> Optional[int]:
    """'2026-10-19 22:32:19[.f]' (China wall-clock) -> epoch ms; None if absent or malformed."""
    m = _TIME.match(text or "")
    if not m:
        return None
    y, mo, d, h, mi, s = (int(g) for g in m.groups()[:6])
    frac = int((m.group(7) or "0")[:3].ljust(3, "0"))
    return int(datetime(y, mo, d, h, mi, s, tzinfo=CST).timestamp() * 1000) + frac


NO_DEADLINE_MS = china_ms("2099-12-31 23:59:59")


# ---------------------------------------------------------------- assignments
def _status(submitted: bool) -> str:
    return "Submitted" if submitted else "To submit"


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


# --------------------------------------------------------------------- detail
def is_submitted(mixed: dict, achievement: dict) -> bool:
    status_id = achievement.get("achievementStatus")
    if status_id is None:
        status_id = mixed.get("doTaskStatusId")
    return status_id == ACHIEVEMENT_SUBMITTED


def handed_in_ids(mixed: dict, achievement: dict, submitted_ids: Optional[List[str]]) -> List[str]:
    """File ids with the teacher: none before a hand-in; the kept list of the last dashboard submit,
    or (unknown) the current files."""
    if not is_submitted(mixed, achievement):
        return []
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


def detail(mixed: dict, achievement: dict, comments: List[dict], me: int,
           submitted_ids: Optional[List[str]], listed: Optional[dict] = None) -> dict:
    """getMixedPublishDetail + getAchievementDetail + comments -> AssignmentDetail.

    `submitted_ids`: file ids handed in at the last submit made through the dashboard, or None when
    unknown (then the current files stand in for it once submitted). `listed`: the mapped list
    Assignment for the same task, if the caller has it, which supplies schoolGroup and submittedAt
    (the detail endpoints carry neither). `instructionsHtml` is raw; Next sanitises it."""
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
        "teacher": ", ".join(t["userName"] for t in mixed.get("mainTeachers") or [] if t.get("userName")),
        "instructionsHtml": mixed.get("taskContent") or mixed.get("taskDescription") or "",
        # type 'link' entries are embedded players (an <iframe> in `url`), not files /api/files can serve.
        "attachments": [file_ref(f) for f in mixed.get("fileList") or [] if f.get("type") != "link"],
        "myFiles": my_files,
        "submittedFileIds": handed_in,
        "submitted": submitted,
        "needsFiles": needs_files(mixed, achievement),
        "comments": sorted((comment(c, me) for c in comments or []), key=lambda c: (c["createdAt"], c["id"])),
    }
    if listed and listed.get("submittedAt") is not None and submitted:
        out["submittedAt"] = listed["submittedAt"]
    return out
