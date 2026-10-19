"""Capture redacted, READ-ONLY fixtures from task.yungu.org into tests/fixtures/.

    set -a; . /root/.config/yungu-lms/creds.env; set +a
    cd api && .venv/bin/python capture_fixtures.py

Needs env YUNGU_ID / YUNGU_PASSWORD. Only GET calls and the two POST *reads*
(getAchievementDetail, getAchievementDetail/comment) are made: no upload, draft,
submit or comment write, on any assignment. Everything is passed through a whitelist
or scrub step before it is written, and the output is checked for the credentials and
for phone / e-mail / ID-card shaped strings; the script aborts (writing nothing more)
if anything slips through, so a re-run stays clean.
"""
import json
import os
import re
import sys
from pathlib import Path

from yungu_task import SUBMITTED, TODO, YunguTask

OUT = Path(__file__).parent / "tests" / "fixtures"
SEED_ASSIGNMENT = 93251   # the designated test assignment (Submitted)
INSTRUCTIONS_STUB = "<p>Fixture instructions: <strong>bold</strong> &amp; text&nbsp;&mdash; end.</p>"

# Keys dropped wherever they appear: avatars, signed/private links, contact data, secrets.
DROP_KEYS = {
    "userAvatar", "avatar", "publicUrl", "storeMeta", "defaultPictureUrl", "previewImage",
    "studentNo", "loginId", "phoneNumber", "phone", "mobile", "email", "idCard", "idNumber",
    "token", "stsToken", "accessKeyId", "accessSecret", "ticket", "cookie", "password",
    "achievementUserResponse", "fileExtends", "evaluationItemResultResponse",
}
HTML_KEYS = {"taskDescription", "taskContent"}
TEACHER_KEYS = {"mainTeachers"}

SUSPECT = [
    re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),               # mainland mobile number
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),                # e-mail
    re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"),              # 18-digit ID card
    re.compile(r"Signature=|OSSAccessKeyId|SecurityToken|ticket=|SESSION", re.I),
]


def scrub(obj, secrets):
    """Drop sensitive keys, stub teacher names and long HTML, recursively."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in DROP_KEYS:
                continue
            if k in HTML_KEYS and isinstance(v, str):
                out[k] = INSTRUCTIONS_STUB if v else v
            elif k in TEACHER_KEYS and isinstance(v, list):
                out[k] = [{"userId": t.get("userId"), "userName": f"Teacher {i + 1}",
                           "eName": None if i == 0 else f"T{i + 1}"} for i, t in enumerate(v)]
            else:
                out[k] = scrub(v, secrets)
        return out
    if isinstance(obj, list):
        return [scrub(v, secrets) for v in obj]
    if isinstance(obj, str):
        for s in secrets:
            obj = obj.replace(s, "<redacted>")
    return obj


WEEK_KEYS = ("name", "eName", "startTime", "endTime", "playground", "courseId", "scheduleType")


def week_whitelist(week):
    """Calendar events carry teachers, students and groups: keep only the fields the mapper reads."""
    return [[{k: e.get(k) for k in WEEK_KEYS} for e in day] for day in week]


def main():
    login_id, password = os.environ["YUNGU_ID"], os.environ["YUNGU_PASSWORD"]
    c = YunguTask(login_id, password)
    c.login()
    me = c.user
    secrets = [s for s in (login_id, password, me.get("name"), me.get("enName"), me.get("watermarkName")) if s]
    OUT.mkdir(parents=True, exist_ok=True)
    written = {}

    def put(name, data):
        written[name] = scrub(data, secrets)

    def comments_of(publish_id):   # read-only POST, as the web UI sends it
        return c._api("POST", "/api/student/getAchievementDetail/comment", json_body={
            "distributionType": 1, "ifPc": True, "studentId": c.user_id, "teamId": None,
            "taskPublishId": str(publish_id)})["content"]

    put("todo_page.json", c.list_tasks(TODO, 1, 10))
    put("submitted_page1.json", c.list_tasks(SUBMITTED, 1, 10))
    put("week.json", week_whitelist(c.calendar_week()))
    put("courses.json", c.courses())

    todo = next((t for t in c.iter_tasks(TODO) if t["taskPublishId"] != SEED_ASSIGNMENT), None)
    targets = {"93251": SEED_ASSIGNMENT}
    if todo:
        targets["todo"] = todo["taskPublishId"]
    for label, pid in targets.items():
        put(f"mixed_{label}.json", c.task_detail(pid))
        put(f"achievement_{label}.json", c.achievement(pid))
        put(f"comments_{label}.json", comments_of(pid))
    # The task with the most teacher attachments (pdf, video, image, .numbers ...), among those
    # on the To-do list and the first two Submitted pages. Read-only.
    pool = [t["taskPublishId"] for t in c.iter_tasks(TODO)] + \
           [t["taskPublishId"] for n in (1, 2) for g in c.list_tasks(SUBMITTED, n, 10)["data"] for t in g["taskList"]]
    rich = max((c.task_detail(p) for p in dict.fromkeys(pool)), key=lambda d: len(d.get("fileList") or []))
    put("mixed_attachments.json", rich)

    blob = json.dumps(written, ensure_ascii=False)
    for s in secrets:
        assert s not in blob, "credential or personal name leaked into a fixture"
    for pat in SUSPECT:
        m = pat.search(blob)
        assert not m, f"suspicious string in fixtures: pattern {pat.pattern!r}"
    for name, data in written.items():
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    sys.exit(main())
