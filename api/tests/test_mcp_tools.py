"""The eight read-only MCP tools (api/service/mcp_tools.py) over the fake Yungu world; no network."""
import json

import pytest

import requests

from service import mcp_tools
from service.app import Student
from service.mcp_tools import SIGN_IN_TO_DASHBOARD, ToolFailure
from test_service import (ME, NOW, OTHER, UNREACHABLE, api, auth, b_auth, clock, make, no_network,  # noqa: F401
                          state_dir, tapi, world)
from yungu_task import TODO

WRITES = {"save_draft", "submit", "add_comment", "delete_comment", "create_online_doc", "update_online_doc",
          "mark_notification_read", "mark_submitted", "upload_bytes", "file_redirect"}


ARGS = {"get_assignment": {"id": 93251}, "read_attachment": {"assignment_id": 93251, "file_id": 11128687}}


def student(api, user_id=ME):
    return Student(api.app.state.service, user_id)


def run(api, name, args=None, user_id=ME):
    return mcp_tools.run(student(api, user_id), name, args or {})


@pytest.fixture(autouse=True)
def never_writes(world):
    yield
    for w in (world, world.peer):
        assert not WRITES & {c[0] for c in w.calls}, "a tool reached a Yungu write or a file"


# ------------------------------------------------------------------ shapes
def test_list_todo(api, auth, world):
    summary, data = run(api, "list_todo")
    assert data == {"count": 1, "assignments": [{
        "id": 94929, "title": "课后任务：做出你的第一版 MVP", "course": data["assignments"][0]["course"],
        "due": "2026-10-23T22:00:00+08:00", "dueRelative": "10 h late", "priority": "overdue",
        "estimatedMinutes": 60, "link": "https://yungu.chihairou.dev/assignments?task=94929"}]}
    assert summary == "1 assignment to do: 1 overdue."
    json.dumps(data)                                          # plain JSON


def test_list_todo_orders_by_priority_then_due(api, auth, world, clock):
    base = world.lists[TODO][0]
    world.lists[TODO] = [
        {**base, "taskPublishId": 1, "title": "later", "deadlineTimeMillis": int(NOW * 1000) + 3 * 86400_000},
        {**base, "taskPublishId": 2, "title": "soon", "deadlineTimeMillis": int(NOW * 1000) + 5 * 3600_000},
        {**base, "taskPublishId": 3, "title": "late", "deadlineTimeMillis": int(NOW * 1000) - 60_000},
        {**base, "taskPublishId": 4, "title": "delayed", "group": "Delayed",
         "deadlineTimeMillis": int(NOW * 1000) + 86400_000 * 2},
        {**base, "taskPublishId": 5, "title": "open", "deadlineTimeMillis": None},
    ]
    summary, data = run(api, "list_todo")
    rows = data["assignments"]
    assert [r["title"] for r in rows] == ["late", "delayed", "soon", "later", "open"]
    assert [r["priority"] for r in rows] == ["overdue", "overdue", "nearly overdue", "upcoming", "upcoming"]
    assert [r["dueRelative"] for r in rows] == ["1 min late", "in 2 days", "in 5 h", "in 3 days", None]
    assert rows[-1]["due"] is None                                   # no deadline
    assert summary == "5 assignments to do: 2 overdue, 1 nearly overdue, 2 upcoming."


def test_list_todo_work_returned_for_revision_is_nearly_overdue_never_overdue(api, auth, world, clock):
    base = world.lists[TODO][0]
    returned = {"doTaskStatus": "To edit", "doTaskStatusId": 3, "ifTimeout": False, "group": "Due update"}
    world.lists[TODO] = [
        {**base, "taskPublishId": 1, "title": "returned, old deadline", **returned,
         "deadlineTimeMillis": int(NOW * 1000) - 10 * 86400_000},
        {**base, "taskPublishId": 2, "title": "returned, deadline ahead", **returned,
         "deadlineTimeMillis": int(NOW * 1000) + 3 * 86400_000},
        {**base, "taskPublishId": 3, "title": "late", "deadlineTimeMillis": int(NOW * 1000) - 60_000},
    ]
    summary, data = run(api, "list_todo")
    rows = data["assignments"]
    assert [r["title"] for r in rows] == ["late", "returned, old deadline", "returned, deadline ahead"]
    assert [r["priority"] for r in rows] == ["overdue", "nearly overdue", "nearly overdue"]
    assert [r.get("revision") for r in rows] == [None, True, True]
    assert rows[1]["dueRelative"] == "returned for revision" and "late" not in rows[1]["dueRelative"]
    assert rows[2]["dueRelative"] == "returned for revision"
    assert summary == "3 assignments to do: 1 overdue, 2 nearly overdue."


def test_get_assignment_returned_for_revision_is_not_late(api, auth, world):
    base = world.lists[TODO][0]
    world.lists[TODO] = [{**base, "doTaskStatus": "To edit", "doTaskStatusId": 3, "ifTimeout": False,
                          "group": "Due update"}]
    summary, d = run(api, "get_assignment", {"id": base["taskPublishId"]})
    assert d["revision"] is True and d["status"] == "to submit" and d["late"] is False
    assert d["dueRelative"] == "returned for revision"
    assert "late" not in summary and "returned for revision" in summary


def test_list_submitted_newest_first_with_course_and_limit(api, auth, world):
    summary, data = run(api, "list_submitted")
    rows = data["assignments"]
    assert data["total"] == len(rows) == 10
    assert set(rows[0]) == {"id", "title", "course", "due", "submittedAt", "late", "link"}
    assert [r["submittedAt"] for r in rows] == sorted((r["submittedAt"] for r in rows), reverse=True)
    assert all(r["submittedAt"].endswith("+08:00") for r in rows)
    assert summary == "10 of 10 handed-in assignments, newest hand-in first."
    course = rows[0]["course"]
    _, only = run(api, "list_submitted", {"course": course[2:8].upper(), "limit": 1})
    assert len(only["assignments"]) == 1 and only["assignments"][0]["course"] == course
    assert only["total"] == sum(r["course"] == course for r in rows)
    summary, none = run(api, "list_submitted", {"course": "no such course"})
    assert none == {"total": 0, "assignments": []} and summary.startswith("No handed-in assignments")


def test_get_assignment_plain_text_instructions_links_files_feedback_comments(api, auth, world, load):
    world.mixed[93251]["fileList"] = load("mixed_attachments.json")["fileList"]
    world.mixed[93251]["taskContent"] = (
        "<p>Read <strong>chapter 2</strong> &amp; answer:</p><ul><li>one</li><li>two</li></ul>"
        "<p>See <a href=\"https://example.org/x\">this</a>&nbsp;&mdash; end.</p><script>alert(1)</script>")
    summary, d = run(api, "get_assignment", {"id": 93251})
    assert d["id"] == 93251 and d["status"] == "submitted" and d["course"] == "EL-AI Create the Future"
    assert d["teacher"].startswith("Teacher 1")
    assert d["due"] == "2026-10-16T22:00:00+08:00"
    assert d["instructions"] == "Read chapter 2 & answer:\n\n- one\n\n- two\n\nSee this (https://example.org/x) — end."
    assert "<" not in d["instructions"] and "alert" not in d["instructions"]
    assert d["attachments"][0] == {"name": "PA student booklet 城市发展与人文摄影学生任务书2026.pages", "kind": "office",
                                   "file_id": 11028518, "size": 161917, "readable": True,
                                   "link": "https://yungu.chihairou.dev/api/files/11028518"}
    assert all(set(a) == {"name", "file_id", "kind", "size", "readable", "link"}
               and a["link"].startswith("https://yungu.chihairou.dev/") for a in d["attachments"])
    assert [f["name"] for f in d["myFiles"]] == ["wrap_3.txt"]
    assert d["comments"] and set(d["comments"][0]) == {"author", "mine", "at", "text"}
    assert d["link"] == "https://yungu.chihairou.dev/assignments?task=93251"
    assert summary.startswith("我的产品，为谁解决什么问题？ (EL-AI Create the Future): handed in")
    json.dumps(d)


def test_get_assignment_feedback(api, auth, world, load):
    sample = load("feedback_samples.json")["level_rubric"]
    world.mixed[93251] = {**world.mixed[93251], **sample["mixed"]}
    world.ach[93251] = {**world.ach[93251], **sample["achievement"]}
    summary, d = run(api, "get_assignment", {"id": "93251"})           # a numeric string is fine too
    assert set(d["feedback"]) == {"score", "comment", "criteria", "updatedAt"}
    assert d["feedback"]["score"] == "Advanced [4]" and d["feedback"]["criteria"][0]["result"] == "Proficient"
    assert summary.endswith("feedback: Advanced [4].")


def test_get_assignment_online_document_links_to_the_assignment(api, auth, world):
    world.mixed[93251]["fileList"] = [{"fileId": 5, "fileName": "Notes", "type": "onlineDocument", "storeMeta": "{}"}]
    _, d = run(api, "get_assignment", {"id": 93251})
    assert d["attachments"] == [{"name": "Notes", "file_id": 5, "kind": "online document", "size": None,
                                 "readable": False, "link": "https://yungu.chihairou.dev/assignments?task=93251"}]


def test_get_assignment_unknown_id_and_bad_ids(api, auth, world):
    with pytest.raises(ToolFailure) as e:
        run(api, "get_assignment", {"id": 123})
    assert e.value.message == "No assignment with that id." and e.value.status == "not_found"
    for bad in ({}, {"id": "x"}, {"id": -1}, {"id": True}, {"id": 1.5}, {"id": 1, "extra": 2}):
        with pytest.raises(ToolFailure) as e:
            run(api, "get_assignment", bad)
        assert e.value.status == "bad_arguments"


def test_get_schedule_day_and_week(api, auth, world):
    summary, day = run(api, "get_schedule")                             # today: Saturday 2026-10-24
    assert day == {"date": "2026-10-24", "weekday": "Saturday", "events": []}
    assert summary == "Saturday 2026-10-24: 0 classes."
    summary, mon = run(api, "get_schedule", {"date": "2026-10-19"})
    assert mon["weekday"] == "Monday" and len(mon["events"]) == 21
    assert mon["events"][0] == {"name": "Wake-up", "room": None, "start": "2026-10-19T07:00:00+08:00",
                                "end": "2026-10-19T07:00:00+08:00", "type": "other"}
    classes = [e for e in mon["events"] if e["type"] == "class"]
    assert classes and all(e["start"].startswith("2026-10-19T") for e in mon["events"])
    assert summary.startswith(f"Monday 2026-10-19: {len(classes)} class")
    summary, week = run(api, "get_schedule", {"date": "2026-10-22", "week": True})
    assert week["weekStart"] == "2026-10-19" and [d["weekday"] for d in week["days"]][0] == "Monday"
    assert [len(d["events"]) for d in week["days"]] == [21, 22, 21, 23, 15, 0, 1]
    assert summary.startswith("Week of 2026-10-19: ")
    for bad in ({"date": "2026/10/19"}, {"date": "2026-13-01"}, {"week": "yes"}, {"date": 20261019}):
        with pytest.raises(ToolFailure) as e:
            run(api, "get_schedule", bad)
        assert e.value.status == "bad_arguments"


def test_list_courses(api, auth, world):
    summary, data = run(api, "list_courses")
    assert len(data["courses"]) == 13 and data["courses"][0] == {"id": 1086, "name": "Chinese I"}
    assert summary.startswith("13 courses: Chinese I, H Algebra 2 I, ")


def test_get_behaviour(api, auth, world):
    summary, b = run(api, "get_behaviour", {"month": "2026-10"})
    assert b["month"] == "2026-10" and isinstance(b["score"], (int, float))
    assert set(b) == {"month", "score", "bonus", "deduction", "bonusCount", "deductionCount", "records"}
    assert b["records"] and set(b["records"][0]) == {"name", "points", "level", "kind", "at", "subject",
                                                     "recorder", "reason", "revoked"}
    assert all(r["at"].endswith("+08:00") for r in b["records"])
    assert summary.startswith(f"凌云积分 for 2026-10: {b['score']}")
    _, this = run(api, "get_behaviour")                                 # default: this month (China)
    assert this["month"] == "2026-10"
    for bad in ({"month": "2026-11"}, {"month": "1999-12"}, {"month": "2026-1"}, {"month": "x"}):
        with pytest.raises(ToolFailure) as e:
            run(api, "get_behaviour", bad)
        assert e.value.status == "bad_arguments"


def test_list_notifications(api, auth, world):
    summary, data = run(api, "list_notifications")
    rows = data["notifications"]
    assert len(rows) == 20 and rows[0]["read"] is False and all(r["read"] for r in rows[1:])
    assert set(rows[0]) == {"id", "title", "text", "time", "read", "assignmentId"}
    assert rows[0]["assignmentId"] == 7790000 and rows[0]["time"] == "2026-10-20T16:08:00+08:00"
    assert summary == "20 notifications (1 unread), newest first."
    summary, unread = run(api, "list_notifications", {"unread_only": True, "limit": 5})
    assert [r["id"] for r in unread["notifications"]] == ["7790000"]
    assert summary == "1 unread notification, newest first."
    _, few = run(api, "list_notifications", {"limit": 3})
    assert len(few["notifications"]) == 3
    for bad in ({"limit": 0}, {"limit": 51}, {"unread_only": 1}):
        with pytest.raises(ToolFailure):
            run(api, "list_notifications", bad)


def test_unknown_tool_and_non_object_arguments(api, auth):
    with pytest.raises(ToolFailure) as e:
        run(api, "submit_assignment")
    assert e.value.status == "unknown_tool"
    with pytest.raises(ToolFailure) as e:
        mcp_tools.run(student(api), "list_todo", ["x"])
    assert e.value.status == "bad_arguments"


# ------------------------------------------------------------------ failures
def test_yungu_down_is_the_friendly_unreachable_message(api, auth, world):
    world.fail = requests.ConnectionError("down at http://secret.example/?ticket=abc")
    for name in mcp_tools.TOOLS:
        args = ARGS.get(name, {})
        with pytest.raises(ToolFailure) as e:
            run(api, name, args)
        assert e.value.message == UNREACHABLE and e.value.status == "unavailable"


def test_a_non_owner_without_a_live_session_gets_the_sign_in_message_and_no_login(make, world, auth, b_auth):
    restarted = make()                                   # S207's memory session is gone with the restart
    for name in mcp_tools.TOOLS:
        args = ARGS.get(name, {})
        with pytest.raises(ToolFailure) as e:
            run(restarted, name, args, user_id=OTHER)
        assert e.value.message == SIGN_IN_TO_DASHBOARD and e.value.status == "sign_in"
    assert world.peer.logins == ["S207"]                  # only the original sign-in


def test_tools_read_only_their_own_accounts_data(api, world, auth, b_auth):
    _, mine = run(api, "get_assignment", {"id": 93251})
    _, theirs = run(api, "get_assignment", {"id": 93251}, user_id=OTHER)
    assert theirs["title"].startswith("B ") and not mine["title"].startswith("B ")
    assert [f["name"] for f in theirs["myFiles"]] == ["b.txt"]
    _, courses = run(api, "list_courses", user_id=OTHER)
    assert all(c["name"].startswith("B ") for c in courses["courses"])
