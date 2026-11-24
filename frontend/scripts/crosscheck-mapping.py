"""Cross-check for src/lib/yungu/mapping.ts: runs api/mapping.py (the hosted implementation) over the anonymised
fixtures and over edge cases, and prints {case: {fn, args, out}} as JSON. mapping.crosscheck.test.ts replays the
same calls through the TypeScript port and compares. Run from the repository root:

    CROSSCHECK=1 npx vitest run src/lib/yungu/mapping.crosscheck.test.ts   (in frontend/)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
import mapping  # noqa: E402

FIX = Path(__file__).resolve().parents[1] / "src" / "lib" / "yungu" / "fixtures"
NOW, ME = 1792800000000, 342
cases = {}


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def case(name, fn, *args):
    try:
        out = {"value": getattr(mapping, fn)(*args)}
    except Exception as e:  # noqa: BLE001 - recorded as an expected error
        out = {"error": type(e).__name__}
    cases[name] = {"fn": fn, "args": list(args), "out": out}


def tasks(page):
    return [{**t, "group": g["groupName"]} for g in page["data"] for t in g["taskList"]]


# china_ms / month_window
for i, s in enumerate(["2026-10-19 22:32:19", "2026-10-18 17:17:12.0", "2026-10-19 10:45:00.5", "2026-10-20 16:08",
                       "2026-10-19T22:32:19", "2026-10-19 22:32:19.123456", "2026-10-19 22:32:19.9", "junk", "", None, 5,
                       "2026-02-30 10:00:00", "2026-13-01 10:00:00", "0001-01-01 00:00:00", "2026-10-19 24:00:00",
                       "2026-10-19 22:32:19\n", "2026-10-19 22:32:19 ", "2099-12-31 23:59:59"]):
    case(f"china_ms/{i}", "china_ms", s)
for i, s in enumerate(["2026-10", "2026-09", "2028-02", "2100-02", "2000-02", "2026-12", "2026-13", "2026-00", "2026-1",
                       "26-10", "2026-10-01", "", None, "２０２６-10", "0000-01", 5]):
    case(f"month_window/{i}", "month_window", s)

# assignments
todo, sub = tasks(load("todo_page.json")), tasks(load("submitted_page1.json"))
for i, t in enumerate(todo + sub):
    case(f"assignment/{i}", "assignment", t, t["group"], NOW)
t0, s0 = todo[0], sub[0]
variants = [
    ("revision-a", {**t0, "doTaskStatus": "To edit", "doTaskStatusId": 3, "ifTimeout": False}, "Due update"),
    ("revision-b", {**t0, "doTaskStatus": "To edit"}, "Due recently"),
    ("revision-c", {**t0, "doTaskStatusId": 3}, None),
    ("revision-d", t0, "Due update"),
    ("minutes0", {**t0, "expectFinishTime": 0}, "Due today"),
    ("minutesNone", {**t0, "expectFinishTime": None}, "Delayed"),
    ("group-list", t0, "list"), ("group-empty", t0, ""), ("group-new", t0, "Something new"),
    ("nodeadline-todo", {**t0, "deadlineTimeMillis": None}, "Due today"),
    ("nodeadline-todo-nopub", {**t0, "deadlineTimeMillis": None, "publishTimeMillis": None}, "Due today"),
    ("sub-late", {**s0, "ifTimeout": True, "modifiedTime": "2000-01-01 00:00:00"}, "list"),
    ("sub-ontime-bumped", {**s0, "ifTimeout": False, "modifiedTime": "2099-01-01 00:00:00"}, "list"),
    ("sub-nomod", {**s0, "modifiedTime": None}, "list"),
    ("sub-nodl-late", {**s0, "deadlineTimeMillis": None, "ifTimeout": True}, "list"),
    ("sub-nodl-nomod", {**s0, "deadlineTimeMillis": None, "modifiedTime": None}, "list"),
    ("sub-statusid", {**t0, "doTaskStatus": "To submit", "doTaskStatusId": 4, "modifiedTime": None}, "Delayed"),
]
for name, raw, group in variants:
    case(f"assignment/{name}", "assignment", raw, group, NOW)
    case(f"assignment/{name}-far", "assignment", raw, group, 10 ** 15)
    case(f"assignment/{name}-past", "assignment", raw, group, 1)
    case(f"is_revision/{name}", "is_revision", raw, group)

# calendar, courses
for i, e in enumerate(e for day in load("week.json") for e in day):
    case(f"class_event/{i}", "class_event", e)
case("class_event/fallback", "class_event", {"name": "n", "eName": None, "startTime": 1, "endTime": 2, "playground": "", "courseId": 0})
case("class_event/missing", "class_event", {"name": "n"})
case("courses/fixture", "courses", load("courses.json"))
case("courses/nosort", "courses", [{"courseId": 2, "courseName": "B", "sortNo": None}, {"courseId": 1, "courseName": "A", "sortNo": 5}])
case("courses/names", "courses", [{"courseId": 1, "courseEnName": "E"}, {"courseId": 2}])

# files
mixed_att = load("mixed_attachments.json")
raw_files = mixed_att["fileList"] + load("achievement_submitted.json")["fileModelList"]
for i, f in enumerate(raw_files):
    case(f"file_ref/{i}", "file_ref", f)
for i, n in enumerate(["a.pdf", "A.PDF", "x.png", "x.JPG", "x.heic", "clip.mp4", "clip.mov", "song.m4a", "song.mp3", "n.docx",
                       "n.xlsx", "n.pptx", "n.doc", "n.pages", "n.numbers", "n.key", "n.txt", "noext", "archive.zip", "a.tar.gz",
                       "a.svgz", "x.webp", "a.md", "x.WEBM", ".hidden", "a..pdf", "dir/b.png", "a:b.pdf", "x.gz", "note.txt.gz",
                       "weird.name.zzz", "", "t.tif", "t.csv"]):
    for ty in ("whatever", "pdf", "image", "link", None):
        case(f"file_ref/name{i}/{ty}", "file_ref", {"fileId": 7, "fileName": n, "type": ty, "fileSizeByte": 10, "fileCreateTime": "2026-10-16 11:25:20.0"})
case("file_ref/missing", "file_ref", {"fileId": 1, "fileName": "x.bin", "type": None, "fileSizeByte": None, "fileCreateTime": None})
case("file_ref/nofileid", "file_ref", {"fileName": "x.bin"})
delta = (FIX / "online_doc_delta.json").read_text(encoding="utf-8")
for i, raw in enumerate([
    {"fileId": 1, "fileName": "d", "type": "onlineDocument", "url": delta, "storeMeta": delta},
    {"fileId": 1, "fileName": "d", "type": "onlineDocument", "storeMeta": None, "url": '{"ops":[]}'},
    {"fileId": 1, "fileName": "d", "type": "onlineDocument", "storeMeta": "", "url": None},
    {"fileId": 1, "fileName": "d", "type": "onlineDocument", "fileSizeByte": None, "fileCreateTime": None},
]):
    case(f"file_ref/online{i}", "file_ref", raw)

# comments
comments = load("comments_sample.json")
for i, c in enumerate(comments):
    case(f"comment/{i}", "comment", c, ME)
    case(f"comment/{i}-other", "comment", c, 1)
case("comment/bare", "comment", {"feedbackId": 1, "userName": None, "eName": "  x ", "userId": 5}, 5)

# notifications
FEEDBACK_ITEM = {
    "messageId": 5180327, "messageSendTime": "2026-10-20 16:08", "ifRead": True, "title": "t", "titleEn": "T",
    "content": "c", "contentEn": "C", "messageUrl": "https://task.yungu.org/#/taskInfo/58316/1/321", "messageType": 24,
    "templateCode": "NEW_TASK_FEEDBACK", "senderName": "Teacher 1", "attribute": {"taskPublishId": 58316},
}
BEH = {"messageId": 5180411, "messageSendTime": "2026-10-20 14:58", "ifRead": False, "title": "b", "titleEn": None,
       "content": "x", "contentEn": None, "messageUrl": "https://task.yungu.org/#/studentTemplate", "messageType": 11,
       "templateCode": "BEHAVIOR_RECORD", "senderName": "Teacher 1", "attribute": {}}
for i, url in enumerate(["https://task.yungu.org/#/taskInfo/57402/1/321", "https://task.yungu.org/umiTask#/stuTaskInfo/60417/1/null/1",
                         "https://task.yungu.org/#/task", "https://task.yungu.org/#/studentTemplate", "#/taskInfo/5",
                         "#/taskInfo/5?x=1", "#/TaskInfo/5/", "#/taskInfo/5x", "https://evaluation.yungu.org/#/portrait", None, 5]):
    case(f"notification/url{i}", "notification", {**FEEDBACK_ITEM, "messageUrl": url})
for i, r in enumerate([{}, {"messageUrl": None}, {"templateCode": "BEHAVIOR_TIER", "messageUrl": None}, {"templateCode": None},
                       {"templateCode": "NEW_TASK_FEEDBACK"}]):
    case(f"notification/beh{i}", "notification", {**BEH, **r})
for i, v in enumerate([False, 1, "1", "true", " TRUE ", 0, "0", "no", True, 2, 1.0, None]):
    case(f"notification/read{i}", "notification", {**FEEDBACK_ITEM, "ifRead": v})
    case(f"notification/read2-{i}", "notification", {**FEEDBACK_ITEM, "ifRead": None, "read": v})
case("notification/fallback", "notification", {"messageId": 5, "messageSendTime": "2025-01-02 08:00", "ifRead": True, "title": "x",
                                               "titleEn": None, "content": "y", "contentEn": "", "messageUrl": None, "senderName": "T"})
case("notification/bare", "notification", {"messageId": 6, "senderName": "Teacher 2", "messageSendTime": None})
case("notification/blank", "notification", {"messageId": 6, "senderName": "  ", "title": "  A  "})

# detail
m93, a93 = load("mixed_submitted.json"), load("achievement_submitted.json")
mt, at = load("mixed_todo.json"), load("achievement_todo.json")
fb = load("feedback_samples.json")
pairs = {"60417": (m93, a93), "todo": (mt, at), "attach": (mixed_att, at)}
for name, (m, a) in pairs.items():
    for kept in (None, ["1", "2"], []):
        for cs in (None, [], comments):
            case(f"detail/{name}/{kept}/{'none' if cs is None else len(cs)}", "detail", m, a, cs, ME, kept)
    for listed in ({"schoolGroup": "Delayed", "submittedAt": 123}, {"revision": True}, {"dueAt": 5, "submittedAt": 5}, {}):
        case(f"detail/{name}/listed/{sorted(listed)}", "detail", m, a, [], ME, None, listed)
        case(f"detail/{name}/listed-noend/{sorted(listed)}", "detail", {**m, "endTime": None}, a, [], ME, None, listed)
for change in ({"ifEditStatus": True}, {"ifEditStatus": None}, {"achievementStatus": 1}, {"achievementStatus": None}, {"needEnclosure": None},
               {"needEnclosure": True}, {"needEnclosure": 0}):
    for kept in (None, ["1", "2"]):
        case(f"detail/60417/change/{sorted(change.items())}/{kept}", "detail", m93, {**a93, **change}, [], ME, kept)
    case(f"hand_in_on_yungu/{sorted(change.items())}", "hand_in_on_yungu", m93, {**a93, **change})
    case(f"needs_files/{sorted(change.items())}", "needs_files", {**m93, "needEnclosure": None}, {**a93, **change})
    case(f"achievement_status/{sorted(change.items())}", "achievement_status", m93, {**a93, **change})
    case(f"is_submitted/{sorted(change.items())}", "is_submitted", {**m93, "doTaskStatusId": 4}, {**a93, **change})
for name in ("numeric_no_comment", "numeric_comment", "level_comment", "level_rubric", "not_graded"):
    s = fb[name]
    case(f"feedback/{name}", "feedback", s["mixed"], s["achievement"])
    case(f"detail/feedback/{name}", "detail", {**m93, **s["mixed"]}, {**a93, **s["achievement"]}, [], ME, None)
for i, (m, a) in enumerate([({}, {}), ({}, {"evaluationItemResultResponse": None}),
                            ({}, {"evaluationItemResultResponse": {"totalScore": "5", "itemResultResponses": [{"scoreType": 1, "score": "5", "status": 0}]}}),
                            ({}, {"evaluationItemResultResponse": {"totalScore": "5", "itemResultResponses": [{"scoreType": 1, "score": None, "feedback": "  ", "status": 1}]}}),
                            ({}, {"evaluationItemResultResponse": {"totalScore": None, "itemResultResponses": [{"status": 1, "scoreType": 1, "score": None, "feedback": " late submission. "}]}}),
                            ({"totalScore": "10"}, {"evaluationItemResultResponse": {"totalScore": None, "itemResultResponses": [{"status": 1, "scoreType": 1, "score": "8"}]}}),
                            ({}, {"evaluationItemResultResponse": {"totalScore": None, "itemResultResponses": [{"status": 1, "scoreType": 1, "score": "8"}]}}),
                            ({}, {"evaluationItemResultResponse": {"totalScore": "5", "itemResultResponses": [{"status": 1, "scoreType": 2, "criterionItemResponse": {"levelName": "L [5]", "levelEName": None}}]}}),
                            ({}, {"evaluationItemResultResponse": {"totalScore": 5, "itemResultResponses": [{"status": 1, "scoreType": 1, "score": 4.5}]}}),
                            ({}, {"evaluationItemResultResponse": {"totalScore": 5, "itemResultResponses": [{"status": None, "scoreType": 1, "score": 0}]}}),
                            ({}, {"evaluationItemResultResponse": {"itemResultResponses": [{"status": 1, "scoreType": 1, "score": "3",
                                  "itemIndicatorResultModelList": [{"indicatorId": 9, "indicatorName": "n", "indicatorEname": None, "score": "ok", "levelName": None, "description": None}, "x", {}]}]}}),
                            ({}, {"evaluationItemResultResponse": {"itemResultResponses": ["x"]}}),
                            ({}, {"evaluationItemResultResponse": {"itemResultResponses": [{"status": 1, "modifyTime": "2026-10-01 10:00:00", "createTime": "2026-09-01 10:00:00", "feedback": "f"}]}}),
                            ({}, {"evaluationItemResultResponse": {"itemResultResponses": [{"status": 1, "createTime": "2026-09-01 10:00:00", "feedback": "f"}]}})]):
    case(f"feedback/edge{i}", "feedback", m, a)

# behaviour
bd, br = load("behaviour_detail.json"), load("behaviour_records.json")
for month in ("2026-10", "2026-09"):
    case(f"behaviour/{month}", "behaviour", month, bd[month], br[month]["data"])
    for other in ("2026-08", "2026-11"):
        case(f"behaviour/{month}-as-{other}", "behaviour", other, bd[month], br[month]["data"])


def rec(rid, score, at, type_=None, revoke=None, level=None, **kw):
    if type_ is None:
        type_ = 0 if isinstance(score, str) and score.startswith("+") else 2
    return {"id": rid, "type": type_, "score": score, "level": level, "revoke": revoke, "revokeIcon": bool(revoke),
            "recordTime": at, "sortTime": at, "createDate": at, "behaviorTypeName": kw.get("name", f"b{rid}"),
            "behaviorTypeEnName": "Behaviour", "subjectId": kw.get("subject_id", -1), "subjectName": "s",
            "subjectEnName": "Others", "creatorName": "T1", "creatorEnName": "T1", "recordActorName": "T1",
            "recordActorEnName": "T1", "desc": kw.get("desc")}


TOTAL = {"score": 91.0, "baseScore": 100.0, "positiveScore": 8.0, "negativeScore": -17.0}
beh = [
    ("pair", "2026-10", {**TOTAL, "negativeScore": -2.0}, [rec(2, "+5", "2026-10-12T02:00:00.000+00:00", 2, True), rec(2, "-5", "2026-10-10T02:00:00.000+00:00"), rec(1, "-2", "2026-10-09T02:00:00.000+00:00")]),
    ("pair-rev", "2026-10", TOTAL, [rec(2, "-5", "2026-10-10T02:00:00.000+00:00"), rec(2, "+5", "2026-10-12T02:00:00.000+00:00", 2, True)]),
    ("later-month", "2026-09", TOTAL, [{**rec(3, "-2", "2026-09-28T02:00:00.000+00:00"), "revokeIcon": True}]),
    ("lone-rev", "2026-10", TOTAL, [rec(4, "+2", "2026-10-02T02:00:00.000+00:00", 2, True)]),
    ("repeat", "2026-10", TOTAL, [rec(i, "-1" if i % 3 else "+1", f"2026-10-{1 + i % 28:02d}T0{i % 10}:00:00.000+00:00") for i in range(1, 60)] * 2),
    ("tz-sept", "2026-09", TOTAL, [rec(5, "-2", "2026-09-30T15:30:00.000+00:00"), rec(6, "-2", "2026-09-30T16:30:00.000+00:00")]),
    ("tz-oct", "2026-10", TOTAL, [rec(5, "-2", "2026-09-30T15:30:00.000+00:00"), rec(6, "-2", "2026-09-30T16:30:00.000+00:00")]),
    ("tier", "2026-10", {"score": 77.0, "positiveScore": 3.0, "negativeScore": -26.0},
     [rec(1, "+2", "2026-10-03T02:00:00.000+00:00"), rec(2, "-5", "2026-10-04T02:00:00.000+00:00"), rec(2, "+5", "2026-10-05T02:00:00.000+00:00", 2, True), rec(9, None, "2026-10-04T02:00:00.000+00:00", 2, False, 2)]),
    ("empty", "2026-07", {"score": 100.0, "positiveScore": 0.0, "negativeScore": 0.0}, []),
    ("none-rows", "2026-07", {"score": 100}, None),
    ("fraction", "2026-10", {"score": 90.5, "positiveScore": 0.5, "negativeScore": -10.0}, [rec(1, "+0.5", "2026-10-03T02:00:00.000+00:00")]),
    ("scores", "2026-10", TOTAL, [rec(i, s, f"2026-10-0{i}T02:00:00.000+00:00") for i, s in enumerate(["+2", "-2.0", " 3 ", "1e1", "+.5", "5.", "1_0", "inf", "-inf", "nan", "abc", "", None], start=1) if i < 10]),
    ("scores2", "2026-10", TOTAL, [{**rec(i, s, "2026-10-04T02:00:00.000+00:00"), "type": None} for i, s in enumerate([8.0, -0.0, 0, True, False, "+0", "-0.0", [], {}], start=20)]),
    ("kinds", "2026-10", TOTAL, [{**rec(30 + i, "+1", "2026-10-04T02:00:00.000+00:00"), "type": t} for i, t in enumerate([0, 2, 1, None, "0"])]),
    ("text", "2026-10", TOTAL, [{**rec(7, "-2", "2026-10-03T02:00:00.000+00:00", subject_id=14, desc="  x "), "subjectName": "n", "subjectEnName": "Math", "creatorEnName": None},
                                {**rec(8, "+1", "2026-10-03T02:00:00.000+00:00", desc=""), "behaviorTypeName": None, "creatorName": None, "creatorEnName": None, "recordActorName": None, "recordActorEnName": None, "subjectId": 3, "subjectName": "c", "subjectEnName": ""},
                                {**rec(9, "+1", "2026-10-03T02:00:00.000+00:00"), "subjectId": "-1"}]),
    ("bad-rows", "2026-10", TOTAL, [{"score": "+1", "recordTime": "2026-10-03T02:00:00.000+00:00"}, "x", None, {**rec(1, "+1", None), "sortTime": None, "createDate": None}, rec(2, "+1", "2026-10-03T02:00:00.000+00:00")]),
    ("tier-same-id", "2026-10", TOTAL, [rec(5, None, "2026-10-04T02:00:00.000+00:00", 2, False, 3), rec(5, "-5", "2026-10-04T02:00:00.000+00:00")]),
    ("later-rev", "2026-05", {"score": 97.0, "positiveScore": 0.0, "negativeScore": -3.0},
     [rec(41, "+5", "2026-07-06T09:55:56.000+00:00", 2, True), {**rec(41, "-5", "2026-05-08T01:55:01.000+00:00"), "revokeIcon": True}, rec(42, "-3", "2026-05-09T01:00:00.000+00:00")]),
    ("time-formats", "2026-10", TOTAL, [rec(i, "+1", t) for i, t in enumerate(["2026-10-03T02:00:00Z", "2026-10-04T02:00:00+08:00", "2026-10-05 02:00:00", "2026-10-06T02:00:00.123456+00:00",
                                                                           "2026-10-07T02:00:00.1234567+05:30", "2026-10-08", "2026-10-09T02:00", "2026-10-10T02", "2026-10-11T02:00:00-0330", "2026-10-12T25:00:00", "2026-10-13T02:00:00+25:00",
                                                                           "2026-10-14t02:00:00", "  2026-10-15T02:00:00  ", "2026-10-31T23:59:59.999+00:00", "2026-10-31T16:00:00+00:00", "2026-10-01T00:00:00+08:00", 5], start=1)]),
    ("no-total", "2026-10", {}, []),
    ("bad-total", "2026-10", {"score": True}, []),
    ("str-total", "2026-10", {"score": "91"}, []),
    ("partial-total", "2026-10", {"score": 3, "positiveScore": "x", "negativeScore": None}, []),
    ("bad-month", "2026-1", TOTAL, []),
]
for name, month, total, rows in beh:
    case(f"behaviour/{name}", "behaviour", month, total, rows)

print(json.dumps(cases, ensure_ascii=False, allow_nan=True))
