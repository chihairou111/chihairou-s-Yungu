"""Client additions: request shapes mirror api/NOTES.md sections 4 and 7. No network (responses mocks)."""
import json
import re
from urllib.parse import parse_qs, urlparse

import pytest
import responses

import yungu_task
from yungu_task import BASE, YunguError, YunguTask, session_expired

ME = 106


def client():
    c = YunguTask("id", "pw")
    c.user = {"userId": ME}
    return c


def ok(content=None):
    return {"ifLogin": True, "status": True, "message": "成功", "code": 0, "content": content}


def body_of(call):
    return json.loads(call.request.body)


def qs(call):
    return {k: v[0] for k, v in parse_qs(urlparse(call.request.url).query).items()}


ACH = {"taskUserRelationId": 4544147, "taskId": 725048, "courseId": 3325, "achievementId": 867961}


@responses.activate
def test_comments_posts_the_read_payload_and_returns_the_list():
    rows = [{"feedbackId": 1, "descript": "hi"}]
    responses.post(BASE + "/api/student/getAchievementDetail/comment", json=ok(rows))
    assert client().comments(93251) == rows
    assert body_of(responses.calls[0]) == {"distributionType": 1, "ifPc": True, "studentId": ME,
                                          "teamId": None, "taskPublishId": "93251"}


@responses.activate
def test_comments_null_content_is_an_empty_list():
    responses.post(BASE + "/api/student/getAchievementDetail/comment", json=ok(None))
    assert client().comments(93251) == []


@responses.activate
def test_add_comment_posts_save_commentary_with_exact_payload():
    responses.post(BASE + "/api/student/getAchievementDetail", json=ok(ACH))
    responses.post(BASE + "/api/saveCommentary", json=ok(None))
    assert client().add_comment(93251, "test") is None
    save = responses.calls[-1]
    assert save.request.url == BASE + "/api/saveCommentary"
    # taskId is the task's id (not taskPublishId); the key is spelled distributioType on purpose.
    assert body_of(save) == {"commentaryUserId": ME, "taskUserRelationIds": [4544147],
                             "distributioType": 1, "taskId": 725048, "content": "test", "status": "1"}


@responses.activate
def test_add_comment_keeps_chinese_text_verbatim():
    responses.post(BASE + "/api/student/getAchievementDetail", json=ok(ACH))
    responses.post(BASE + "/api/saveCommentary", json=ok(None))
    client().add_comment(93251, "好的，今晚提交。")
    assert body_of(responses.calls[-1])["content"] == "好的，今晚提交。"


@responses.activate
def test_delete_comment_is_a_get_with_feedback_id():
    responses.get(BASE + "/api/deletedCommentary", json=ok(0))
    assert client().delete_comment(327994) is None
    call = responses.calls[0]
    assert call.request.method == "GET" and qs(call) == {"feedbackId": "327994"}


@responses.activate
def test_write_failure_raises():
    responses.get(BASE + "/api/deletedCommentary", json={"code": 500, "message": "no"})
    with pytest.raises(YunguError):
        client().delete_comment(1)


@responses.activate
@pytest.mark.parametrize("preview,path", [(True, "/api/preview_file"), (False, "/api/new_download_file")])
def test_file_redirect_returns_the_location_of_the_302(preview, path):
    signed = "https://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/x?Expires=1&Signature=s"
    responses.get(BASE + path, status=302, headers={"Location": signed})
    assert client().file_redirect(11128597, preview) == signed
    assert qs(responses.calls[0]) == {"id": "11128597"}


@responses.activate
def test_file_redirect_non_302_raises():
    responses.get(BASE + "/api/preview_file", status=200, json=ok())
    with pytest.raises(YunguError):
        client().file_redirect(1, True)


@responses.activate
def test_file_url_still_delegates():
    responses.get(BASE + "/api/new_download_file", status=302, headers={"Location": "https://oss/x"})
    assert client().file_url(5, download=True) == "https://oss/x"


STS = {"accessKeyId": "AK", "accessSecret": "SECRET", "stsToken": "TOKEN", "bucketName": "yungu-common",
       "endpoint": "https://oss-cn-hangzhou.aliyuncs.com", "ossPath": "taskFile/"}


def mock_upload():
    responses.get(BASE + "/api/sts/token", json=ok(STS))
    responses.put(re.compile(r"https://yungu-common\.oss-cn-hangzhou\.aliyuncs\.com/.*"), status=200)
    responses.get(BASE + "/api/upload_file/new", json=ok({"fileId": 11128597, "fileName": "笔记 1.txt"}))


@responses.activate
def test_upload_bytes_sts_then_oss_put_then_register():
    mock_upload()
    up = client().upload_bytes("笔记 1.txt", "text/plain", "你好".encode())
    assert (up.file_id, up.file_name) == (11128597, "笔记 1.txt")
    sts, put, reg = responses.calls
    assert qs(sts) == {"type": "1"}
    assert put.request.method == "PUT" and put.request.body == "你好".encode()
    assert put.request.headers["Content-Type"] == "text/plain"
    assert put.request.headers["x-oss-security-token"] == "TOKEN"
    assert put.request.headers["Authorization"].startswith("OSS AK:")
    # The key keeps the Chinese name (percent-encoded in the URL) after taskFile/<ms>_.
    key = re.match(r"https://yungu-common\.oss-cn-hangzhou\.aliyuncs\.com/(taskFile/\d+_.*)", put.request.url)
    assert key and key.group(1).endswith("_%E7%AC%94%E8%AE%B0%201.txt")
    q = qs(reg)
    assert q["fileName"] == "笔记 1.txt" and q["bucketName"] == "yungu-common"
    assert q["fileSize"] == str(len("你好".encode())) and q["fileType"] == "text/plain"
    assert q["percent"] == "100" and q["fileUrl"].startswith("taskFile/") and q["uuid"].isdigit()


@responses.activate
def test_upload_bytes_without_mime_falls_back_to_octet_stream():
    mock_upload()
    client().upload_bytes("blob", "", b"x")
    assert responses.calls[1].request.headers["Content-Type"] == "application/octet-stream"


@responses.activate
def test_upload_bytes_oss_failure_raises():
    responses.get(BASE + "/api/sts/token", json=ok(STS))
    responses.put(re.compile(r"https://yungu-common.*"), status=403, body="denied")
    with pytest.raises(YunguError):
        client().upload_bytes("a.txt", "text/plain", b"x")


@responses.activate
def test_upload_file_is_a_thin_wrapper_over_upload_bytes(tmp_path):
    mock_upload()
    f = tmp_path / "one.txt"
    f.write_bytes(b"1")
    up = client().upload_file(str(f))
    assert up.file_id == 11128597
    reg = qs(responses.calls[2])
    assert reg["fileName"] == "one.txt" and reg["fileType"] == "text/plain" and reg["fileSize"] == "1"


def test_session_expired():
    assert session_expired({"ifLogin": False, "code": 1000}) is True
    assert session_expired({"ifLogin": False}) is True
    assert session_expired({"code": 1000}) is True
    assert YunguTask.session_expired({"ifLogin": False, "code": 1000}) is True
    assert session_expired({"ifLogin": True, "code": 0, "content": []}) is False
    assert session_expired({"code": 500}) is False
    assert session_expired(None) is False
    assert session_expired("<html>") is False
