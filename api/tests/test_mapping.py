"""Pure mappers: Yungu raw payloads (recorded fixtures) -> the frontend's TypeScript shapes."""
import random
from datetime import datetime, timedelta, timezone

import pytest
from pathlib import Path

import mapping
import yungu_task

FIXTURES = Path(__file__).parent / "fixtures"
CST = timezone(timedelta(hours=8))
NOW = 1792800000000
ME = 106

ASSIGNMENT_KEYS = {"id", "title", "course", "courseId", "dueAt", "assignedAt", "status", "estimatedMinutes",
                   "schoolGroup"}
DETAIL_KEYS = ASSIGNMENT_KEYS | {"teacher", "instructionsHtml", "attachments", "myFiles", "submittedFileIds",
                                 "submitted", "comments", "needsFiles"}
FILE_KEYS = {"id", "name", "kind", "mime", "size", "url", "createdAt"}


def ms(y, mo, d, h=0, mi=0, s=0):
    return int(datetime(y, mo, d, h, mi, s, tzinfo=CST).timestamp() * 1000)


def tasks(page):
    return [{**t, "group": g["groupName"]} for g in page["data"] for t in g["taskList"]]


# --------------------------------------------------------------------- times
def test_china_ms_reads_wall_clock_as_utc_plus_8_whatever_the_host_zone(monkeypatch):
    monkeypatch.setenv("TZ", "America/Los_Angeles")
    assert mapping.china_ms("2026-10-19 22:32:19") == ms(2026, 10, 19, 22, 32, 19)
    assert mapping.china_ms("2026-10-18 17:17:12.0") == ms(2026, 10, 18, 17, 17, 12)
    assert mapping.china_ms("2026-10-19 10:45:00.5") == ms(2026, 10, 19, 10, 45, 0) + 500
    assert mapping.china_ms(None) is None and mapping.china_ms("") is None and mapping.china_ms("junk") is None


# --------------------------------------------------------------- assignments
def test_todo_assignment_maps_every_ts_field(load):
    raw = tasks(load("todo_page.json"))[0]
    a = mapping.assignment(raw, raw["group"], NOW)
    assert set(a) == ASSIGNMENT_KEYS            # no submittedAt on work that is not handed in
    assert a == {
        "id": 94929, "title": "课后任务：做出你的第一版 MVP", "course": "EL-AI Create the Future",
        "courseId": 3325, "dueAt": raw["deadlineTimeMillis"], "assignedAt": raw["publishTimeMillis"],
        "status": "To submit", "estimatedMinutes": 60, "schoolGroup": "Due recently",
    }
    assert a["dueAt"] == ms(2026, 10, 23, 22)


@pytest.mark.parametrize("group,expected", [
    ("Due today", "Due today"), ("Due recently", "Due recently"), ("Delayed", "Delayed"),
    ("list", None), ("", None), (None, None), ("Something new", None),
])
def test_school_group_comes_from_the_group_name(load, group, expected):
    raw = tasks(load("todo_page.json"))[0]
    assert mapping.assignment(raw, group, NOW)["schoolGroup"] == expected


@pytest.mark.parametrize("minutes,expected", [(60, 60), (0, None), (None, None)])
def test_estimated_minutes_is_none_when_unset(load, minutes, expected):
    raw = {**tasks(load("todo_page.json"))[0], "expectFinishTime": minutes}
    assert mapping.assignment(raw, "Due today", NOW)["estimatedMinutes"] == expected


def test_submitted_assignment_uses_modified_time_as_submitted_at(load):
    raw = tasks(load("submitted_page1.json"))[0]
    a = mapping.assignment(raw, raw["group"], NOW)
    assert a["status"] == "Submitted" and a["schoolGroup"] is None
    # modifiedTime is China wall-clock "YYYY-MM-DD HH:MM:SS"; the list carries no other hand-in time.
    assert a["submittedAt"] == mapping.china_ms(raw["modifiedTime"])
    assert set(a) == ASSIGNMENT_KEYS | {"submittedAt"}


def test_late_submission_has_submitted_at_after_due(load):
    late = [t for t in tasks(load("submitted_page1.json")) if t["ifTimeout"]]
    assert late, "fixture should hold a late submission"
    a = mapping.assignment(late[0], "list", NOW)
    assert a["submittedAt"] > a["dueAt"]


def test_comment_bumped_modified_time_cannot_make_on_time_work_late(load):
    raw = {**tasks(load("submitted_page1.json"))[0], "ifTimeout": False}
    raw["modifiedTime"] = "2099-01-01 00:00:00"          # e.g. a teacher comment long after the deadline
    a = mapping.assignment(raw, "list", NOW)
    assert a["submittedAt"] == a["dueAt"]                # not > dueAt, so not shown as late


def test_late_flag_keeps_submitted_at_after_due_even_if_modified_time_is_earlier(load):
    raw = {**tasks(load("submitted_page1.json"))[0], "ifTimeout": True}
    raw["modifiedTime"] = "2000-01-01 00:00:00"
    a = mapping.assignment(raw, "list", NOW)
    assert a["submittedAt"] == a["dueAt"] + 1


def test_on_time_hand_in_before_deadline_is_untouched(load):
    raw = {**tasks(load("submitted_page1.json"))[0], "ifTimeout": False}
    a = mapping.assignment(raw, "list", NOW)
    assert a["submittedAt"] == mapping.china_ms(raw["modifiedTime"]) <= a["dueAt"]


def test_submitted_without_modified_time_falls_back_without_inventing_lateness(load):
    raw = {**tasks(load("submitted_page1.json"))[0], "modifiedTime": None}
    a = mapping.assignment(raw, "list", 10**15)
    assert a["submittedAt"] == a["dueAt"]
    a = mapping.assignment(raw, "list", a["dueAt"] - 1)    # never in the future
    assert a["submittedAt"] == a["dueAt"] - 1


def test_85_submitted_items_over_several_pages_give_85_unique_ids(load):
    template = tasks(load("submitted_page1.json"))[0]
    items = [{**template, "taskPublishId": 90000 + i, "title": f"Task {i}"} for i in range(85)]

    def fake_list(status, page, page_size, **kw):
        assert status == yungu_task.SUBMITTED
        chunk = items[(page - 1) * page_size: page * page_size]
        data = [{"groupName": "list", "count": len(chunk), "taskList": chunk}] if chunk else []
        return {"pageNum": page, "pageSize": page_size, "total": len(items), "data": data}

    c = yungu_task.YunguTask("id", "pw")
    c.list_tasks = fake_list
    mapped = [mapping.assignment(t, t["group"], NOW) for t in c.iter_tasks(yungu_task.SUBMITTED)]
    assert len(mapped) == 85
    assert len({a["id"] for a in mapped}) == 85


def test_real_submitted_page_has_unique_ids(load):
    ids = [t["taskPublishId"] for t in tasks(load("submitted_page1.json"))]
    assert len(ids) == len(set(ids)) == 10


# ----------------------------------------------------------------- calendar
def test_class_event_maps_class_and_routine_items(load):
    events = [mapping.class_event(e) for day in load("week.json") for e in day]
    assert events and all(set(e) == {"name", "room", "start", "end", "isClass", "courseId"} for e in events)
    classes = [e for e in events if e["isClass"]]
    routines = [e for e in events if not e["isClass"]]
    assert classes and routines
    assert all(e["courseId"] is not None and e["courseId"] > 0 for e in classes)
    assert all(e["courseId"] is None for e in routines)
    chinese = next(e for e in classes if e["name"] == "Chinese I")      # eName: the UI is English
    assert chinese["room"] == "D419" and chinese["start"] == 1792370400000 and chinese["end"] == 1792372800000
    wake = next(e for e in routines if e["name"] == "Wake-up")
    assert wake["room"] is None


def test_class_event_falls_back_to_name_and_blank_room():
    e = mapping.class_event({"name": "语文", "eName": None, "startTime": 1, "endTime": 2, "playground": "",
                             "courseId": 0})
    assert e == {"name": "语文", "room": None, "start": 1, "end": 2, "isClass": False, "courseId": None}


# ------------------------------------------------------------------ courses
PALETTE = ["Tomato", "Flamingo", "Tangerine", "Banana", "Sage", "Basil", "Peacock", "Blueberry", "Lavender",
           "Grape", "Graphite"]


def test_course_colours_follow_sort_order_and_cycle(load):
    raw = load("courses.json")
    out = mapping.courses(raw)
    assert len(out) == len(raw) == 13
    expected_order = [c["courseId"] for c in sorted(raw, key=lambda c: (c["sortNo"], c["courseId"]))]
    assert [c["id"] for c in out] == expected_order
    assert [c["color"] for c in out] == [PALETTE[i % 11] for i in range(13)]      # 12th, 13th wrap round
    assert all(set(c) == {"id", "name", "color"} for c in out)
    assert next(c for c in out if c["id"] == 3325)["name"] == "EL-AI Create the Future"


def test_course_colours_are_stable_whatever_order_the_service_returns(load):
    raw = load("courses.json")
    base = {c["id"]: c["color"] for c in mapping.courses(raw)}
    for seed in range(5):
        shuffled = raw[:]
        random.Random(seed).shuffle(shuffled)
        assert {c["id"]: c["color"] for c in mapping.courses(shuffled)} == base


def test_course_with_missing_sort_no_sorts_last():
    out = mapping.courses([{"courseId": 2, "courseName": "B", "sortNo": None},
                           {"courseId": 1, "courseName": "A", "sortNo": 5}])
    assert [c["id"] for c in out] == [1, 2]


# -------------------------------------------------------------------- files
def raw_file(name, ftype="pdf", size=10, created="2026-10-16 11:25:20.0", fid=7):
    return {"fileId": fid, "fileName": name, "type": ftype, "fileSizeByte": size, "fileCreateTime": created}


def test_file_ref_pdf(load):
    raw = load("mixed_attachments.json")["fileList"][1]      # 《城市发展》Lesson 01.pdf
    f = mapping.file_ref(raw)
    assert set(f) == FILE_KEYS
    assert f["kind"] == "pdf" and f["mime"] == "application/pdf" and f["name"].endswith("Lesson 01.pdf")
    assert f["id"] == str(raw["fileId"])
    assert f["url"] == f"/api/files/{f['id']}" and "previewPdfUrl" not in f
    assert f["size"] == 3876267


def test_file_ref_ids_urls_and_china_time():
    f = mapping.file_ref(raw_file("one.txt", "txt", 13, "2026-10-18 17:17:12.0", fid=11128687))
    assert f == {"id": "11128687", "name": "one.txt", "kind": "other", "mime": "text/plain", "size": 13,
                 "url": "/api/files/11128687", "createdAt": ms(2026, 10, 18, 17, 17, 12)}


@pytest.mark.parametrize("name,kind", [
    ("a.pdf", "pdf"), ("A.PDF", "pdf"), ("x.png", "image"), ("x.JPG", "image"), ("x.heic", "image"),
    ("clip.mp4", "video"), ("clip.mov", "video"), ("song.m4a", "audio"), ("song.mp3", "audio"),
    ("n.docx", "office"), ("n.xlsx", "office"), ("n.pptx", "office"), ("n.doc", "office"),
    ("n.pages", "office"), ("n.numbers", "office"), ("n.key", "office"),
    ("n.txt", "other"), ("noext", "other"), ("archive.zip", "other"),
])
def test_file_kind_from_extension(name, kind):
    assert mapping.file_ref(raw_file(name, "whatever"))["kind"] == kind


def test_office_files_get_a_pdf_preview_url():
    f = mapping.file_ref(raw_file("report.docx", "doc", fid=42))
    assert f["kind"] == "office"
    assert f["url"] == "/api/files/42" and f["previewPdfUrl"] == "/api/files/42?preview=1"
    assert "wordprocessingml" in f["mime"]


def test_yungu_type_is_only_a_fallback_when_the_extension_says_nothing():
    assert mapping.file_ref(raw_file("scan", "pdf"))["kind"] == "pdf"
    assert mapping.file_ref(raw_file("scan", "image"))["kind"] == "image"
    assert mapping.file_ref(raw_file("scan", "link"))["kind"] == "other"
    # ...but a known extension wins over a misleading type ("pdf" is what Yungu says for .numbers).
    assert mapping.file_ref(raw_file("t.numbers", "pdf"))["kind"] == "office"


def test_file_ref_tolerates_missing_size_and_time():
    f = mapping.file_ref({"fileId": 1, "fileName": "x.bin", "type": None, "fileSizeByte": None,
                          "fileCreateTime": None})
    assert f["size"] == 0 and f["createdAt"] == 0 and f["mime"] == "application/octet-stream"


# ----------------------------------------------------------------- comments
def test_comment_maps_author_mine_time_and_text(load):
    raw = load("comments_sample.json")
    mine = mapping.comment(raw[1], ME)
    assert mine == {"id": "327994", "author": "Student Sample Student", "mine": True,
                    "createdAt": ms(2026, 10, 19, 22, 32, 19), "text": "好的，今晚提交。"}
    other = mapping.comment(raw[0], ME)
    assert other["mine"] is False and other["author"] == "Teacher 1"        # no eName: no trailing space
    assert other["id"] == "327995"


def test_comment_mine_ignores_delete_permission(load):
    raw = load("comments_sample.json")
    assert raw[1]["deletePermission"] is False and mapping.comment(raw[1], ME)["mine"] is True
    assert raw[2]["deletePermission"] is True and mapping.comment(raw[2], ME)["mine"] is False


def test_comment_time_with_fraction(load):
    assert mapping.comment(load("comments_sample.json")[2], ME)["createdAt"] == ms(2026, 10, 19, 9)


# ------------------------------------------------------------------- detail
def test_detail_of_a_submitted_assignment(load):
    d = mapping.detail(load("mixed_93251.json"), load("achievement_93251.json"), [], ME, None)
    assert set(d) == DETAIL_KEYS
    assert d["id"] == 93251 and d["title"] == "我的产品，为谁解决什么问题？"
    assert d["course"] == "EL-AI Create the Future" and d["courseId"] == 3325
    assert d["dueAt"] == ms(2026, 10, 16, 22) and d["assignedAt"] == ms(2026, 10, 9, 11, 37, 25)
    assert d["estimatedMinutes"] == 30 and d["status"] == "Submitted" and d["submitted"] is True
    assert d["teacher"] == "Teacher 1, Teacher 2"
    assert "<strong>" in d["instructionsHtml"]                    # raw HTML; sanitising stays in Next
    assert d["attachments"] == []
    assert [f["name"] for f in d["myFiles"]] == ["wrap_3.txt"]
    assert d["submittedFileIds"] == ["11128687"]                  # unknown hand-in list: the current files
    assert d["comments"] == [] and d["schoolGroup"] is None


def test_detail_of_a_todo_assignment(load):
    d = mapping.detail(load("mixed_todo.json"), load("achievement_todo.json"), [], ME, None)
    assert d["id"] == 94929 and d["status"] == "To submit" and d["submitted"] is False
    assert d["myFiles"] == [] and d["submittedFileIds"] == [] and "submittedAt" not in d


def test_detail_uses_the_service_kept_submitted_ids(load):
    ach = load("achievement_93251.json")
    d = mapping.detail(load("mixed_93251.json"), ach, [], ME, ["1", "2"])
    assert d["submittedFileIds"] == ["1", "2"]
    ach["achievementStatus"] = 1
    d = mapping.detail(load("mixed_93251.json"), ach, [], ME, ["1", "2"])
    assert d["submitted"] is False and d["submittedFileIds"] == []        # empty before the first hand-in


def test_detail_comments_are_oldest_first(load):
    raw = load("comments_sample.json")            # fixture is newest first, as the API returns it
    d = mapping.detail(load("mixed_93251.json"), load("achievement_93251.json"), raw, ME, None)
    assert [c["id"] for c in d["comments"]] == ["327990", "327994", "327995"]
    assert [c["mine"] for c in d["comments"]] == [False, True, False]


def test_detail_attachments_skip_embedded_links_and_keep_the_rest(load):
    mixed = load("mixed_attachments.json")
    d = mapping.detail(mixed, load("achievement_todo.json"), [], ME, None)
    assert len(mixed["fileList"]) == 10 and len(d["attachments"]) == 9      # the one 'link' is an embed
    kinds = {f["name"].rsplit(".", 1)[-1]: f["kind"] for f in d["attachments"]}
    assert kinds["pdf"] == "pdf" and kinds["mp4"] == "video" and kinds["numbers"] == "office"
    assert all(f["url"] == f"/api/files/{f['id']}" for f in d["attachments"])


def test_detail_takes_group_and_submitted_at_from_the_listing(load):
    listed = {"schoolGroup": "Delayed", "submittedAt": 123}
    d = mapping.detail(load("mixed_93251.json"), load("achievement_93251.json"), [], ME, None, listed=listed)
    assert d["schoolGroup"] == "Delayed" and d["submittedAt"] == 123


# ------------------------------------------------------------- no deadline
def test_submitted_item_without_a_deadline_is_due_at_its_hand_in_and_never_late(load):
    raw = {**tasks(load("submitted_page1.json"))[0], "deadlineTimeMillis": None, "deadline": None}
    for late in (True, False, None):
        a = mapping.assignment({**raw, "ifTimeout": late}, "list", NOW)
        assert a["submittedAt"] == mapping.china_ms(raw["modifiedTime"]) == a["dueAt"]
        assert isinstance(a["assignedAt"], int)
    a = mapping.assignment({**raw, "modifiedTime": None}, "list", NOW)
    assert a["submittedAt"] == a["dueAt"] == NOW                      # no hand-in time either: now


def test_todo_item_without_a_deadline_sorts_last_and_is_never_overdue(load):
    raw = {**tasks(load("todo_page.json"))[0], "deadlineTimeMillis": None, "deadline": None}
    a = mapping.assignment(raw, raw["group"], NOW)
    assert a["dueAt"] == mapping.NO_DEADLINE_MS > NOW and isinstance(a["dueAt"], int)
    assert mapping.NO_DEADLINE_MS == ms(2099, 12, 31, 23, 59, 59)
    a = mapping.assignment({**raw, "publishTimeMillis": None}, raw["group"], NOW)
    assert a["assignedAt"] == mapping.NO_DEADLINE_MS


def test_detail_without_an_end_time_takes_the_listed_due_or_no_deadline(load):
    mixed = {**load("mixed_93251.json"), "endTime": None}
    d = mapping.detail(mixed, load("achievement_93251.json"), [], ME, None, listed={"dueAt": 5, "submittedAt": 5})
    assert d["dueAt"] == 5 and d["submittedAt"] == 5
    d = mapping.detail(mixed, load("achievement_93251.json"), [], ME, None)
    assert d["dueAt"] == mapping.NO_DEADLINE_MS


# --------------------------------------------------------- online documents
def test_online_document_is_marked_and_has_no_preview():
    raw = {"fileId": 11117133, "fileName": "my favorite department", "type": "onlineDocument",
           "url": '{"ops":[{"insert":"text"}]}', "fileCreateTime": None, "fileSizeByte": None}
    f = mapping.file_ref(raw)
    assert f["online"] is True and f["kind"] == "other" and "previewPdfUrl" not in f
    assert f["url"] == "/api/files/11117133" and f["size"] == 0
    assert "online" not in mapping.file_ref({"fileId": 1, "fileName": "a.pdf", "type": "pdf"})


def test_online_file_ref_carries_content(load):
    delta = (FIXTURES / "online_doc_delta.json").read_text(encoding="utf-8")
    raw = {"fileId": 11138501, "fileName": "研究测试", "type": "onlineDocument", "url": delta, "storeMeta": delta}
    f = mapping.file_ref(raw)
    assert f["online"] is True and f["content"] == delta


def test_online_file_ref_content_falls_back_to_url_then_empty():
    base = {"fileId": 1, "fileName": "d", "type": "onlineDocument"}
    assert mapping.file_ref({**base, "storeMeta": None, "url": '{"ops":[]}'})["content"] == '{"ops":[]}'
    assert mapping.file_ref({**base, "storeMeta": "", "url": None})["content"] == ""


def test_plain_file_ref_has_no_content():
    assert "content" not in mapping.file_ref({"fileId": 1, "fileName": "a.pdf", "type": "pdf"})


def test_detail_needs_files(load):
    mixed, ach = load("mixed_93251.json"), load("achievement_93251.json")
    assert ach["needEnclosure"] is False
    assert mapping.detail(mixed, ach, [], ME, None)["needsFiles"] is False
    # Achievement wins over the task-level flag; missing everywhere defaults to True (safe).
    assert mapping.detail({**mixed, "needEnclosure": False}, {**ach, "needEnclosure": True}, [], ME, None)["needsFiles"] is True
    ach2 = {k: v for k, v in ach.items() if k != "needEnclosure"}
    mixed2 = {k: v for k, v in mixed.items() if k != "needEnclosure"}
    assert mapping.detail(mixed2, ach2, [], ME, None)["needsFiles"] is True
    assert mapping.detail({**mixed2, "needEnclosure": False}, ach2, [], ME, None)["needsFiles"] is False


def test_detail_null_need_enclosure_means_files_required(load):
    # Yungu sending needEnclosure: null is "unknown", like a missing key: never offer a no-file hand-in.
    mixed, ach = load("mixed_93251.json"), load("achievement_93251.json")
    mixed_missing = {k: v for k, v in mixed.items() if k != "needEnclosure"}
    assert mapping.detail(mixed_missing, {**ach, "needEnclosure": None}, [], ME, None)["needsFiles"] is True
    assert mapping.detail({**mixed, "needEnclosure": None}, {**ach, "needEnclosure": None}, [], ME, None)["needsFiles"] is True
    assert mapping.detail({**mixed, "needEnclosure": None}, {**ach, "needEnclosure": False}, [], ME, None)["needsFiles"] is False
