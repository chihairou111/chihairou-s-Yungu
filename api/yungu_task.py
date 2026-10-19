"""Client for task.yungu.org (云谷课堂), reverse-engineered from the web app.

Everything here mirrors requests that the real web UI sends (observed 2026-10-18).
Auth is cookie-based (CAS login at login.yungu.org, then ticket -> SESSION cookie).

Usage:
    c = YunguTask(os.environ["YUNGU_ID"], os.environ["YUNGU_PASSWORD"])
    c.login()
    for t in c.iter_tasks(TODO): print(t["title"], t["deadline"], t["doTaskStatus"])
"""
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.utils import formatdate
from typing import Iterator, List, Optional
from urllib.parse import quote

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

LOGIN = "https://login.yungu.org"
BASE = "https://task.yungu.org"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/153.0.0.0 Safari/537.36")
CST = timezone(timedelta(hours=8))

# getAllTasks?inCludeTaskStatus=
TODO, ARCHIVED, SUBMITTED = 0, 1, 2

ROLE_STUDENT = 2
ACHIEVEMENT_NOT_SUBMITTED = 1   # observed achievementStatus before first submit
ACHIEVEMENT_SUBMITTED = 4       # observed after submit


class YunguError(Exception):
    def __init__(self, msg, resp=None):
        super().__init__(msg)
        self.resp = resp


def session_expired(resp_json) -> bool:
    """True if a task.yungu.org JSON body says the login session is gone:
    `ifLogin: false` or `code: 1000` (observed when the SESSION cookie expires)."""
    return isinstance(resp_json, dict) and (resp_json.get("ifLogin") is False or resp_json.get("code") == 1000)


@dataclass
class UploadedFile:
    file_id: int
    file_name: str
    raw: dict


class YunguTask:
    def __init__(self, login_id: str, password: str, timeout: int = 60):
        self.login_id = login_id
        self.password = password
        self.timeout = timeout
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA})
        self.user: Optional[dict] = None

    session_expired = staticmethod(session_expired)

    # ------------------------------------------------------------------ http
    def _api(self, method: str, path: str, *, params=None, json_body=None, base=BASE,
             referer=BASE + "/umiTask", check=True) -> dict:
        headers = {"Accept": "application/json, text/plain, */*", "Referer": referer}
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        r = self.s.request(method, base + path, params=params, headers=headers,
                           data=None if json_body is None else json.dumps(json_body, ensure_ascii=False,
                                                                          separators=(",", ":")).encode(),
                           timeout=self.timeout, allow_redirects=False)
        if r.status_code != 200:
            raise YunguError(f"{method} {path} -> HTTP {r.status_code}", r)
        j = r.json()
        if check and j.get("code") != 0:
            raise YunguError(f"{method} {path} -> code={j.get('code')} message={j.get('message')}", r)
        return j

    # ----------------------------------------------------------------- login
    def login(self) -> dict:
        """CAS login. Password is sent as RSA(PKCS1 v1.5, server public key) of
        {"password": md5(password), "timestamp": <ms>, "nonce": <uuid4>}."""
        ref = f"{LOGIN}/cas/login?service={quote(BASE + '/', safe='')}"
        self.s.get(ref, timeout=self.timeout)  # establishes SESSION cookie / CAS service
        h = {"Referer": ref, "Accept": "application/json"}
        self.s.get(f"{LOGIN}/api/getStudentLoginId", params={"name": self.login_id}, headers=h,
                   timeout=self.timeout)
        kr = self.s.get(f"{LOGIN}/cas/getPublicKey", headers=h, timeout=self.timeout).json()
        pub = serialization.load_der_public_key(base64.b64decode(kr["content"]))
        plain = json.dumps({"password": hashlib.md5(self.password.encode()).hexdigest(),
                            "timestamp": int(time.time() * 1000), "nonce": str(uuid.uuid4())},
                           separators=(",", ":")).encode()
        enc = base64.b64encode(pub.encrypt(plain, padding.PKCS1v15())).decode()
        body = {"loginId": self.login_id, "password": enc, "type": "mobile", "language": "zhCN",
                "role": ROLE_STUDENT, "eduGroupCompanyId": 1, "schoolId": 1}
        r = self.s.post(f"{LOGIN}/cas/loginForLoginId", json=body,
                        headers={**h, "Content-Type": "application/json; charset=utf-8"},
                        timeout=self.timeout, allow_redirects=False)
        try:
            j = r.json()
        except ValueError:
            raise YunguError(f"login: HTTP {r.status_code}, non-JSON response", r)
        if not j.get("success"):
            raise YunguError(f"login failed: {j.get('msg') or j}", r)
        r2 = self.s.get(j["redirectUrl"], timeout=self.timeout)  # ?ticket=... -> task.yungu.org session
        if r2.status_code != 200:
            raise YunguError(f"ticket exchange failed HTTP {r2.status_code}", r2)
        self.user = self.current_user()
        return self.user

    def current_user(self) -> dict:
        return self._api("GET", "/api/currentUser")["content"]

    @property
    def user_id(self) -> int:
        if not self.user:
            self.user = self.current_user()
        return self.user["userId"]

    # ----------------------------------------------------------- assignments
    def task_counts(self, course_id: str = "") -> dict:
        return self._api("GET", "/api/taskPublish/getTaskCountForStudent",
                         params={"courseId": course_id})["content"]

    def courses(self) -> List[dict]:
        return self._api("GET", "/api/my/currentCourses")["content"]["data"]

    def list_tasks(self, status: int = TODO, page: int = 1, page_size: int = 10, course_id="",
                   keyword: str = "", sort_type: int = 2, semester_id: Optional[int] = None) -> dict:
        """Raw getAllTasks. content = {pageSize,pageNum,total,data:[{groupName,count,taskList}]}.
        TODO groups by 'Due today' / 'Due recently' / 'Delayed'; other tabs use one group 'list'."""
        p = {"courseId": course_id, "includeContentLike": keyword, "inCludeTaskStatus": status,
             "pageNum": page, "pageSize": page_size}
        if status == TODO:
            p["sortType"] = sort_type          # UI sends sortType=2 on the To-do tab only
        if status == ARCHIVED and semester_id is not None:
            p["semesterId"] = semester_id      # UI sends semesterId on the Archived tab
        return self._api("GET", "/api/getAllTasks", params=p)["content"]

    def iter_tasks(self, status: int = TODO, page_size: int = 10, **kw) -> Iterator[dict]:
        """Yield every task (flattened). Adds 'group' (groupName) to each task dict.
        Each has: title, courseName, courseId, deadline ('MM-DD HH:MM'), deadlineTimeMillis,
        doTaskStatus ('To submit'...), doTaskStatusId, taskPublishId, taskId, teamId, ..."""
        page, seen = 1, 0
        while True:
            c = self.list_tasks(status, page, page_size, **kw)
            for g in c["data"] or []:
                for t in g["taskList"] or []:
                    seen += 1
                    yield {**t, "group": g["groupName"]}
            if not c["data"] or seen >= c["total"]:
                return
            page += 1

    # --------------------------------------------------------- task details
    def task_detail(self, publish_id: int) -> dict:
        """Description + teacher attachments in content['fileList'] (see attachments())."""
        return self._api("GET", "/api/getMixedPublishDetail",
                         params={"taskPublishId": publish_id})["content"]

    def attachments(self, publish_id: int) -> List[dict]:
        return self.task_detail(publish_id)["fileList"] or []

    def achievement(self, publish_id: int, team_id=None) -> dict:
        """My submission state: taskUserRelationId, achievementId, achievementStatus,
        fileModelList (draft/submitted files), courseId, feedback, ..."""
        return self._api("POST", "/api/student/getAchievementDetail", json_body={
            "distributionType": 1, "ifPc": True, "studentId": self.user_id,
            "taskPublishId": str(publish_id), "teamId": team_id})["content"]

    def achievement_files(self, publish_id: int, team_id=None) -> List[dict]:
        j = self._api("POST", "/api/student/getAchievementDetail/fileList", json_body={
            "distributionType": 1, "ifPc": True, "studentId": self.user_id,
            "teamId": team_id, "taskPublishId": str(publish_id)})
        return j["content"]["fileModelList"] or []

    def file_redirect(self, file_id: int, preview: bool) -> str:
        """Signed OSS URL (valid ~2h) from the 302 of preview_file (preview=True) or
        new_download_file (preview=False)."""
        path = "/api/preview_file" if preview else "/api/new_download_file"
        r = self.s.get(BASE + path, params={"id": file_id}, allow_redirects=False,
                       timeout=self.timeout, headers={"Referer": BASE + "/umiTask"})
        if r.status_code != 302:
            raise YunguError(f"{path}?id={file_id} -> HTTP {r.status_code}", r)
        return r.headers["Location"]

    def file_url(self, file_id: int, download: bool = False) -> str:
        return self.file_redirect(file_id, preview=not download)

    def download_file(self, file_id: int, dest: str) -> str:
        url = self.file_url(file_id, download=True)
        with requests.get(url, stream=True, timeout=self.timeout) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
        return dest

    # --------------------------------------------------------------- upload
    def _sts(self) -> dict:
        return self._api("GET", "/api/sts/token", params={"type": 1})["content"]

    def upload_file(self, path: str, name: Optional[str] = None) -> UploadedFile:
        """Upload a local file; see upload_bytes. Does NOT attach it to a task."""
        name = name or os.path.basename(path)
        with open(path, "rb") as f:
            data = f.read()
        return self.upload_bytes(name, mimetypes.guess_type(name)[0] or "application/octet-stream", data)

    def upload_bytes(self, name: str, mime: str, data: bytes) -> UploadedFile:
        """1) STS token 2) PUT to OSS 3) register with /api/upload_file/new -> fileId.
        Note: does NOT attach the file to a task; use save_draft()/submit() for that."""
        ctype = mime or "application/octet-stream"
        sts = self._sts()
        ts = int(time.time() * 1000)
        key = f"{sts['ossPath']}{ts}_{name}"
        self._oss_put(sts, key, data, ctype)
        j = self._api("GET", "/api/upload_file/new", params={
            "fileName": name, "bucketName": sts["bucketName"], "fileSize": len(data),
            "fileType": ctype, "fileUrl": key, "percent": 100, "uuid": ts})
        c = j["content"]
        return UploadedFile(c["fileId"], c["fileName"], c)

    def _oss_put(self, sts: dict, key: str, data: bytes, ctype: str):
        """Aliyun OSS signature v1 with STS token (same as the web app's ali-oss SDK)."""
        date = formatdate(usegmt=True)
        canon_headers = f"x-oss-date:{date}\nx-oss-security-token:{sts['stsToken']}\n"
        resource = f"/{sts['bucketName']}/{key}"
        to_sign = f"PUT\n\n{ctype}\n{date}\n{canon_headers}{resource}"
        sig = base64.b64encode(hmac.new(sts["accessSecret"].encode(), to_sign.encode(),
                                        hashlib.sha1).digest()).decode()
        host = sts["endpoint"].replace("https://", "")
        url = f"https://{sts['bucketName']}.{host}/{quote(key, safe='/')}"
        r = requests.put(url, data=data, timeout=max(self.timeout, 300), headers={
            "Authorization": f"OSS {sts['accessKeyId']}:{sig}", "x-oss-date": date,
            "x-oss-security-token": sts["stsToken"], "Content-Type": ctype,
            "Referer": BASE + "/"})
        if r.status_code != 200:
            raise YunguError(f"OSS PUT {key} -> HTTP {r.status_code}: {r.text[:300]}", r)

    # ---------------------------------------------------- draft / submission
    def save_draft(self, task_user_relation_id: int, file_ids: List[int]) -> dict:
        """Overwrite the draft file list. Adding/removing files in the UI both call this
        with the full resulting list (empty list = delete everything)."""
        return self._api("GET", "/api/student/submitAchievementForDrafts", params={
            "taskUserRelationId": task_user_relation_id,
            "fileIds": ",".join(str(i) for i in file_ids)})

    def submit(self, publish_id: int, file_ids: List[int], team_id=None) -> dict:
        """Submit (first time) or re-submit after Edit (updates existing achievement).
        First time -> POST /api/submitAchievementSendMessage
        Already submitted (achievementId set) -> POST /api/updateAchievementAndSendMessage"""
        a = self.achievement(publish_id, team_id)
        body = {"courseId": a["courseId"], "fileList": list(file_ids), "studentIds": [self.user_id],
                "teamList": None, "taskPublishId": publish_id,
                "taskUserRelationId": a["taskUserRelationId"], "textStatus": a.get("textStatus") or 0}
        if a.get("achievementId"):
            return self._api("POST", "/api/updateAchievementAndSendMessage",
                             json_body={"achievementId": a["achievementId"], **body})
        return self._api("POST", "/api/submitAchievementSendMessage", json_body=body)

    def set_files_and_submit(self, publish_id: int, paths: List[str], team_id=None) -> List[UploadedFile]:
        """Convenience: upload files, save as draft, submit. Replaces any existing files."""
        a = self.achievement(publish_id, team_id)
        ups = [self.upload_file(p) for p in paths]
        ids = [u.file_id for u in ups]
        self.save_draft(a["taskUserRelationId"], ids)
        self.submit(publish_id, ids, team_id)
        return ups

    def my_file_ids(self, publish_id: int, team_id=None) -> List[int]:
        return [f["fileId"] for f in (self.achievement(publish_id, team_id)["fileModelList"] or [])]

    # -------------------------------------------------------------- comments
    # The comment thread belongs to the student's own work on a task (api/NOTES.md section 7).
    def comments(self, publish_id: int, team_id=None) -> List[dict]:
        """Comments on my work for this task, newest first: feedbackId, parentId, userId, userName,
        eName, descript, feedbackTime ('YYYY-MM-DD HH:MM:SS', China time), deletePermission (unreliable)."""
        j = self._api("POST", "/api/student/getAchievementDetail/comment", json_body={
            "distributionType": 1, "ifPc": True, "studentId": self.user_id,
            "teamId": team_id, "taskPublishId": str(publish_id)})
        return j["content"] or []

    def add_comment(self, publish_id: int, text: str) -> None:
        """Post a comment. taskId is the task's id (not taskPublishId); both it and
        taskUserRelationId come from getAchievementDetail. `distributioType` is spelt that way."""
        a = self.achievement(publish_id)
        self._api("POST", "/api/saveCommentary", json_body={
            "commentaryUserId": self.user_id, "taskUserRelationIds": [a["taskUserRelationId"]],
            "distributioType": 1, "taskId": a["taskId"], "content": text, "status": "1"})

    def delete_comment(self, feedback_id: int) -> None:
        self._api("GET", "/api/deletedCommentary", params={"feedbackId": feedback_id})

    # -------------------------------------------------------------- calendar
    @staticmethod
    def week_bounds(day: date):
        """(Monday 00:00:00.000, Sunday 23:59:59.999) in UTC+8, as ms timestamps."""
        monday = day - timedelta(days=day.weekday())
        start = datetime(monday.year, monday.month, monday.day, tzinfo=CST)
        end = start + timedelta(days=7) - timedelta(milliseconds=1)
        return int(start.timestamp() * 1000), int(end.timestamp() * 1000)

    def calendar_week(self, day: Optional[date] = None, start_ms: Optional[int] = None) -> List[List[dict]]:
        """Seven lists (Mon..Sun). Event keys: name, eName, startTime, endTime (ms),
        playground (classroom, e.g. 'D419'), courseId, teachers[], studentGroups[], scheduleType."""
        if start_ms is None:
            s, e = self.week_bounds(day or datetime.now(CST).date())
        else:
            s, e = start_ms, start_ms + 7 * 86400 * 1000 - 1
        return self._api("GET", "/calendar/api/personal/schdedule/templateForPc", params={
            "weekNumber": 1, "queryStartTime": s, "queryEndTime": e},
            referer=BASE + "/newSchoolCalendar/")["content"]

    def calendar_next_week(self, start_ms: int):
        return self.calendar_week(start_ms=start_ms + 7 * 86400 * 1000)

    def calendar_prev_week(self, start_ms: int):
        return self.calendar_week(start_ms=start_ms - 7 * 86400 * 1000)
