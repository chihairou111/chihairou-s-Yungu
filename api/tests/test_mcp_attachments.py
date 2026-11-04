"""read_attachment (api/service/mcp_tools.py + mcp_files.py) over the fake Yungu world. The signed OSS
download is mocked with `responses` (or a fake streaming response); no network."""
import io
import json

import pytest
import requests
import responses
from PIL import Image
from pypdf import PdfReader, PdfWriter

from service import mcp_files, mcp_tools
from service.app import Student
from service.mcp_files import ImageBlock, PdfBlock, TextBlock
from service.mcp_tools import SIGN_IN_TO_DASHBOARD, ToolFailure
from test_service import (ME, NOW, OTHER, UNREACHABLE, api, auth, b_auth, clock, make, no_network,  # noqa: F401
                          state_dir, tapi, world)

WRITES = {"save_draft", "submit", "add_comment", "delete_comment", "create_online_doc", "update_online_doc",
          "mark_notification_read", "mark_submitted", "upload_bytes"}
AID = 93251
OSS = "https://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/f.bin?Expires=1&OSSAccessKeyId=k&Signature=SIGNED-xyz"
MB = 1024 * 1024
PDF_MIME = "application/pdf"
ONLINE_DELTA = '{"ops":[{"insert":"Plan"},{"insert":"\\n","attributes":{"header":2}}]}'


@pytest.fixture(autouse=True)
def never_writes(world):
    yield
    for w in (world, world.peer):
        assert not WRITES & {c[0] for c in w.calls}, "read_attachment reached a Yungu write"


@pytest.fixture
def oss(world):
    """The signed OSS URL every file redirect answers, and the mocked OSS behind it."""
    world.redirect = world.peer.redirect = OSS
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        yield rsps


def make_pdf(pages):
    """A small valid PDF with one line of Helvetica text per page."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for text in pages:
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objs.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
        content = len(objs)
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content} 0 R "
                    "/Resources << /Font << /F1 3 0 R >> >> >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + (body if isinstance(body, bytes) else body.encode()) + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def encrypted(pdf, password):
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(pdf)))
    writer.encrypt(user_password=password, owner_password="owner-pw", algorithm="AES-128")
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def image_bytes(size, fmt="PNG", mode="RGB"):
    buf = io.BytesIO()
    Image.new(mode, size, (200, 30, 30) if mode == "RGB" else (200, 30, 30, 128)).save(buf, fmt)
    return buf.getvalue()


def entry(fid, name, size=1000, type_="pdf", **extra):
    return {"fileId": fid, "fileName": name, "type": type_, "fileSizeByte": size,
            "fileCreateTime": "2026-10-10 10:00:00", **extra}


def attach(world, *entries, aid=AID):
    world.mixed[aid]["fileList"] = list(entries)


def run(api, args, user_id=ME):
    return mcp_tools.run(Student(api.app.state.service, user_id), "read_attachment", args)


def read(api, fid, aid=AID, user_id=ME):
    out = run(api, {"assignment_id": aid, "file_id": fid}, user_id)
    assert len(out) == 3
    return out


def blocks_of(blocks, kind):
    return [b for b in blocks if isinstance(b, kind)]


def everything(summary, data, blocks):
    """Every text the agent receives (not the binary blobs)."""
    return summary + json.dumps(data, ensure_ascii=False) + "".join(b.text for b in blocks_of(blocks, TextBlock))


def redirects(world):
    return [c[1] for c in world.calls if c[0] == "file_redirect"]


# ------------------------------------------------------------- get_assignment
def test_get_assignment_lists_file_id_kind_size_readable(api, auth, world, load):
    files = load("mixed_attachments.json")["fileList"]
    attach(world, *files, entry(5, "Notes", type_="onlineDocument", storeMeta='{"ops":[{"insert":"hi\\n"}]}'),
           entry(6, "photo.png", 2 * MB, "image"), entry(7, "scan.heic", 1000, "image"),
           entry(8, "huge.pdf", 11 * MB), entry(9, "data.csv", 500, "other"))
    _, d = mcp_tools.run(Student(api.app.state.service, ME), "get_assignment", {"id": AID})
    rows = {a["name"]: a for a in d["attachments"]}
    assert rows["PA student booklet 城市发展与人文摄影学生任务书2026.pages"] == {
        "name": "PA student booklet 城市发展与人文摄影学生任务书2026.pages", "file_id": 11028518, "kind": "office",
        "size": 161917, "readable": True, "link": "https://yungu.chihairou.dev/api/files/11028518"}
    assert rows["《城市发展》Lesson 01.pdf"]["readable"] is True and rows["《城市发展》Lesson 01.pdf"]["kind"] == "pdf"
    assert rows["为什么我们要研究城中村.mp4"]["kind"] == "video" and rows["为什么我们要研究城中村.mp4"]["readable"] is False
    assert rows["Notes"] == {"name": "Notes", "file_id": 5, "kind": "online document", "size": None,
                             "readable": True, "link": "https://yungu.chihairou.dev/assignments?task=93251"}
    assert rows["photo.png"]["kind"] == "image" and rows["photo.png"]["readable"] is True
    assert rows["scan.heic"]["readable"] is False                      # not png/jpeg/gif/webp
    assert rows["huge.pdf"]["readable"] is False                       # over 10 MB
    assert rows["data.csv"]["kind"] == "text" and rows["data.csv"]["readable"] is True
    assert d["myFiles"] == [{"name": "wrap_3.txt", "file_id": 11128687, "kind": "text", "size": 13,
                             "readable": True, "link": "https://yungu.chihairou.dev/api/files/11128687"}]
    assert redirects(world) == []                                      # listing reads no file


# ------------------------------------------------------------------- PDF
def test_a_pdf_attachment_gives_page_separated_text_and_the_pdf(api, auth, world, oss):
    pdf = make_pdf(["Read chapter two", "Answer the questions"])
    attach(world, entry(11028511, "Lesson 01.pdf", len(pdf)))
    oss.add(responses.GET, OSS, body=pdf, content_type=PDF_MIME)
    summary, data, blocks = read(api, 11028511)
    assert redirects(world) == [(11028511, False)]                     # the original file, not a preview
    (text,) = blocks_of(blocks, TextBlock)
    assert text.text.startswith("--- Page 1 ---\nRead chapter two")
    assert "--- Page 2 ---\nAnswer the questions" in text.text
    (doc,) = blocks_of(blocks, PdfBlock)
    assert doc.data == pdf and doc.uri == "https://yungu.chihairou.dev/api/files/11028511"
    assert data["fileId"] == 11028511 and data["assignmentId"] == AID and data["name"] == "Lesson 01.pdf"
    assert data["kind"] == "pdf" and data["pages"] == 2 and data["included"] == ["text", "pdf"]
    assert data["truncated"] is False and data["textChars"] == len(text.text)
    assert "Lesson 01.pdf" in summary and "2 pages" in summary
    assert "SIGNED" not in everything(summary, data, blocks) and "aliyuncs" not in everything(summary, data, blocks)
    sent = oss.calls[0].request
    assert sent.headers.get("Cookie") is None and sent.headers["Accept-Encoding"] == "identity"


def test_pdf_text_is_capped(api, auth, world, oss, monkeypatch):
    monkeypatch.setattr(mcp_files, "MAX_TEXT_CHARS", 30)
    pdf = make_pdf(["A" * 40, "B" * 40])
    attach(world, entry(11, "long.pdf", len(pdf)))
    oss.add(responses.GET, OSS, body=pdf)
    _, data, blocks = read(api, 11)
    (text,) = blocks_of(blocks, TextBlock)
    assert len(text.text) <= 32 and data["truncated"] is True and "B" not in text.text
    assert blocks_of(blocks, PdfBlock)                                  # the whole PDF still comes along


def test_an_encrypted_pdf_is_metadata_link_and_a_note(api, auth, world, oss):
    pdf = encrypted(make_pdf(["secret words"]), "user-pw")
    attach(world, entry(12, "locked.pdf", len(pdf)))
    oss.add(responses.GET, OSS, body=pdf)
    summary, data, blocks = read(api, 12)
    assert blocks == [] and data["included"] == []
    assert "password" in data["note"] and data["link"] == "https://yungu.chihairou.dev/api/files/12"
    assert "secret words" not in everything(summary, data, blocks)


def test_a_pdf_encrypted_with_an_empty_password_is_read(api, auth, world, oss):
    pdf = encrypted(make_pdf(["open words"]), "")
    attach(world, entry(13, "open.pdf", len(pdf)))
    oss.add(responses.GET, OSS, body=pdf)
    _, data, blocks = read(api, 13)
    assert "open words" in blocks_of(blocks, TextBlock)[0].text and data["included"] == ["text", "pdf"]


@pytest.mark.parametrize("body", [b"%PDF-1.4\n garbage that is no pdf", b"<html>not a pdf</html>", b""])
def test_a_broken_pdf_is_metadata_link_and_a_note(api, auth, world, oss, body):
    attach(world, entry(14, "broken.pdf", 100))
    oss.add(responses.GET, OSS, body=body)
    summary, data, blocks = read(api, 14)
    assert blocks == [] and data["included"] == [] and data["note"]
    assert data["link"] == "https://yungu.chihairou.dev/api/files/14"


def test_a_pdf_without_a_text_layer_still_comes_as_a_pdf(api, auth, world, oss):
    pdf = make_pdf([""])
    attach(world, entry(15, "scan.pdf", len(pdf)))
    oss.add(responses.GET, OSS, body=pdf)
    _, data, blocks = read(api, 15)
    assert data["included"] == ["pdf"] and "no text" in data["note"].lower()
    assert blocks_of(blocks, PdfBlock) and not blocks_of(blocks, TextBlock)


# ---------------------------------------------------------- Office / iWork
@pytest.mark.parametrize("name", ["booklet.pages", "slides.pptx", "sheet.numbers", "essay.docx"])
def test_office_and_iwork_files_are_read_from_yungus_pdf_preview(api, auth, world, oss, name):
    pdf = make_pdf(["Preview text"])
    attach(world, entry(16, name, 999999))
    oss.add(responses.GET, OSS, body=pdf)
    summary, data, blocks = read(api, 16)
    assert redirects(world) == [(16, True)]                            # Yungu's PDF preview
    assert data["kind"] == "office" and data["included"] == ["text", "pdf"]
    assert "Preview text" in blocks_of(blocks, TextBlock)[0].text
    (doc,) = blocks_of(blocks, PdfBlock)
    assert doc.data == pdf and doc.uri == "https://yungu.chihairou.dev/api/files/16?preview=1"


def test_an_office_preview_that_is_not_a_pdf_is_a_note(api, auth, world, oss):
    attach(world, entry(17, "essay.docx", 5000))
    oss.add(responses.GET, OSS, body=b"<html>viewer</html>", content_type="text/html")
    _, data, blocks = read(api, 17)
    assert blocks == [] and data["note"] and data["included"] == []


# ------------------------------------------------------------------ images
def test_a_small_image_comes_as_it_is(api, auth, world, oss):
    png = image_bytes((300, 200))
    attach(world, entry(18, "diagram.png", len(png), "image"))
    oss.add(responses.GET, OSS, body=png, content_type="image/png")
    summary, data, blocks = read(api, 18)
    (img,) = blocks_of(blocks, ImageBlock)
    assert img.data == png and img.mime == "image/png"
    assert data["included"] == ["image"] and data["width"] == 300 and data["height"] == 200
    assert not blocks_of(blocks, TextBlock)


def test_a_large_image_is_downscaled_to_2048_px(api, auth, world, oss):
    jpg = image_bytes((4000, 1000), "JPEG")
    attach(world, entry(19, "board.jpg", len(jpg), "image"))
    oss.add(responses.GET, OSS, body=jpg)
    _, data, blocks = read(api, 19)
    (img,) = blocks_of(blocks, ImageBlock)
    assert img.mime == "image/jpeg"
    assert Image.open(io.BytesIO(img.data)).size == (2048, 512)
    assert data["width"] == 4000 and data["downscaled"] is True


def test_an_image_with_transparency_stays_png_when_downscaled(api, auth, world, oss):
    png = image_bytes((3000, 3000), "PNG", "RGBA")
    attach(world, entry(20, "logo.png", len(png), "image"))
    oss.add(responses.GET, OSS, body=png)
    _, _, blocks = read(api, 20)
    (img,) = blocks_of(blocks, ImageBlock)
    assert img.mime == "image/png" and Image.open(io.BytesIO(img.data)).size == (2048, 2048)


def test_the_image_type_comes_from_its_bytes(api, auth, world, oss):
    gif = image_bytes((10, 10), "GIF")
    attach(world, entry(21, "named.jpg", len(gif), "image"))
    oss.add(responses.GET, OSS, body=gif)
    _, _, blocks = read(api, 21)
    assert blocks_of(blocks, ImageBlock)[0].mime == "image/gif"


def test_bytes_that_are_no_image_are_a_note(api, auth, world, oss):
    attach(world, entry(22, "fake.png", 100, "image"))
    oss.add(responses.GET, OSS, body=b"definitely not an image")
    _, data, blocks = read(api, 22)
    assert blocks == [] and data["note"] and data["included"] == []


# -------------------------------------------------------------- plain text
def test_the_students_own_text_file_is_decoded(api, auth, world, oss):
    oss.add(responses.GET, OSS, body="第一行\nsecond line\n".encode("utf-8"))
    summary, data, blocks = read(api, 11128687)                        # wrap_3.txt, in myFiles
    (text,) = blocks_of(blocks, TextBlock)
    assert text.text == "第一行\nsecond line\n" and data["included"] == ["text"] and data["kind"] == "text"
    assert redirects(world) == [(11128687, False)]


def test_text_falls_back_to_gb18030_and_is_capped(api, auth, world, oss, monkeypatch):
    attach(world, entry(23, "notes.md", 100, "other"), entry(24, "notes2.md", 100, "other"))
    oss.add(responses.GET, OSS, body="城中村研究笔记".encode("gb18030"))
    _, data, blocks = read(api, 23)
    assert blocks_of(blocks, TextBlock)[0].text == "城中村研究笔记" and data["truncated"] is False
    monkeypatch.setattr(mcp_files, "MAX_TEXT_CHARS", 3)
    _, data, blocks = read(api, 24)
    assert blocks_of(blocks, TextBlock)[0].text.startswith("城中村") and data["truncated"] is True


# ---------------------------------------------------------- online documents
def test_an_online_document_is_read_from_its_delta_without_a_fetch(api, auth, world, oss):
    delta = {"ops": [{"insert": "研究计划"}, {"insert": "\n", "attributes": {"header": 1}},
                     {"insert": "第一步", "attributes": {"bold": True}}, {"insert": "\n", "attributes": {"list": "ordered"}},
                     {"insert": "第二步"}, {"insert": "\n", "attributes": {"list": "ordered"}},
                     {"insert": "point"}, {"insert": "\n", "attributes": {"list": "bullet"}},
                     {"insert": {"image": "https://x/y.png"}}, {"insert": "\nsee "},
                     {"insert": "this", "attributes": {"link": "https://example.org/a"}}, {"insert": "\n"}]}
    attach(world, entry(25, "Plan", 0, "onlineDocument", storeMeta=json.dumps(delta, ensure_ascii=False)))
    summary, data, blocks = read(api, 25)
    (text,) = blocks_of(blocks, TextBlock)
    assert text.text == "# 研究计划\n1. 第一步\n2. 第二步\n- point\n[image]\nsee this (https://example.org/a)"
    assert data["kind"] == "online document" and data["included"] == ["text"]
    assert data["link"] == "https://yungu.chihairou.dev/assignments?task=93251"
    assert redirects(world) == [] and len(oss.calls) == 0


# --------------------------------------------------- not readable / too large
def test_video_is_metadata_and_the_link_only(api, auth, world, oss, load):
    attach(world, *load("mixed_attachments.json")["fileList"])
    summary, data, blocks = read(api, 10900967)
    assert blocks == [] and data["kind"] == "video" and data["size"] == 111178124 and data["included"] == []
    assert data["link"] == "https://yungu.chihairou.dev/api/files/10900967" and data["note"]
    assert redirects(world) == [] and len(oss.calls) == 0


def test_a_file_known_to_be_over_10_mb_is_not_downloaded(api, auth, world, oss):
    attach(world, entry(26, "big.pdf", 11 * MB))
    summary, data, blocks = read(api, 26)
    assert blocks == [] and "10 MB" in data["note"] and redirects(world) == [] and len(oss.calls) == 0


def test_a_download_announcing_over_10_mb_is_not_read(api, auth, world, oss):
    attach(world, entry(27, "deck.pptx", 1000))                       # its preview PDF turns out huge
    oss.add(responses.GET, OSS, body=b"x", headers={"Content-Length": str(10 * MB + 1)},
            auto_calculate_content_length=False)
    _, data, blocks = read(api, 27)
    assert blocks == [] and "10 MB" in data["note"]


class Endless:
    """A streaming response without Content-Length that never ends: counts the bytes handed out."""

    def __init__(self, tick=None):
        self.status_code, self.headers, self.given, self.closed, self.tick = 200, {}, 0, False, tick

    def iter_content(self, chunk_size):
        while True:
            if self.tick:
                self.tick()
            self.given += chunk_size
            yield b"%" * chunk_size

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.closed = True


def test_the_download_stops_at_the_10_mb_cap(api, auth, world, oss, monkeypatch):
    endless = Endless()
    monkeypatch.setattr(mcp_files, "_get", lambda url: endless)
    attach(world, entry(28, "stream.pdf", 1000))
    _, data, blocks = read(api, 28)
    assert blocks == [] and "10 MB" in data["note"]
    assert endless.given <= mcp_files.MAX_BYTES + mcp_files.CHUNK_BYTES and endless.closed


def test_a_slow_download_is_cut_off_after_the_call_timeout(api, auth, world, oss, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(mcp_files, "clock", lambda: now[0])
    endless = Endless(tick=lambda: now.__setitem__(0, now[0] + 5))
    monkeypatch.setattr(mcp_files, "_get", lambda url: endless)
    attach(world, entry(29, "slow.pdf", 1000))
    with pytest.raises(ToolFailure) as e:
        read(api, 29)
    assert e.value.status == "timeout" and "too long" in e.value.message
    assert endless.given <= 8 * mcp_files.CHUNK_BYTES and endless.closed
    assert mcp_files.DOWNLOAD_TIMEOUT_SECONDS == 30


def test_a_socket_timeout_is_the_same_friendly_message(api, auth, world, oss):
    attach(world, entry(30, "t.pdf", 1000))
    oss.add(responses.GET, OSS, body=requests.Timeout(f"read timed out {OSS}"))
    with pytest.raises(ToolFailure) as e:
        read(api, 30)
    assert e.value.status == "timeout" and "SIGNED" not in e.value.message


@pytest.mark.parametrize("failure", [{"status": 403}, {"status": 500},
                                     {"body": requests.ConnectionError(f"refused {OSS}")}])
def test_oss_failures_are_the_friendly_unreachable_message(api, auth, world, oss, failure):
    attach(world, entry(31, "x.pdf", 1000))
    oss.add(responses.GET, OSS, **failure)
    with pytest.raises(ToolFailure) as e:
        read(api, 31)
    assert e.value.message == UNREACHABLE and e.value.status == "unavailable"


def test_a_redirect_that_is_not_https_is_refused(api, auth, world, oss):
    world.redirect = "http://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/a.pdf?Signature=x"
    attach(world, entry(32, "x.pdf", 1000))
    with pytest.raises(ToolFailure) as e:
        read(api, 32)
    assert e.value.message == UNREACHABLE and len(oss.calls) == 0


# ---------------------------------------------------------------- ownership
def test_a_file_id_not_on_that_assignment_is_not_found_without_a_fetch(api, auth, world, oss):
    attach(world, entry(33, "x.pdf", 1000))
    for fid in (34, 11028511):
        with pytest.raises(ToolFailure) as e:
            read(api, fid)
        assert e.value.message == "Not found." and e.value.status == "not_found"
    with pytest.raises(ToolFailure) as e:
        read(api, 33, aid=424242)                                       # no such assignment
    assert e.value.message == "Not found."
    assert redirects(world) == [] and len(oss.calls) == 0


def test_another_accounts_file_id_is_not_found(api, world, auth, b_auth, oss):
    oss.add(responses.GET, OSS, body=b"their text")
    _, theirs, blocks = read(api, 22220001, user_id=OTHER)              # B's own b.txt on 93251
    assert theirs["name"] == "b.txt" and blocks_of(blocks, TextBlock)[0].text == "their text"
    with pytest.raises(ToolFailure) as e:
        read(api, 22220001)                                             # A on the same assignment id
    assert e.value.message == "Not found."
    assert redirects(world) == [] and redirects(world.peer) == [(22220001, False)]


def test_bad_arguments(api, auth, world):
    for bad in ({}, {"assignment_id": AID}, {"file_id": 1}, {"assignment_id": "x", "file_id": 1},
                {"assignment_id": AID, "file_id": -1}, {"assignment_id": AID, "file_id": 1, "extra": 1}):
        with pytest.raises(ToolFailure) as e:
            run(api, bad)
        assert e.value.status == "bad_arguments"


# ----------------------------------------------------------------- failures
def test_yungu_down_and_ended_sessions(api, world, auth, b_auth, oss):
    world.fail = requests.ConnectionError("down https://task.yungu.org/?ticket=x")
    with pytest.raises(ToolFailure) as e:
        read(api, 11128687)
    assert e.value.message == UNREACHABLE
    world.peer.expire_all()
    with pytest.raises(ToolFailure) as e:
        read(api, 22220001, user_id=OTHER)
    assert e.value.message == SIGN_IN_TO_DASHBOARD and world.peer.logins == ["S207"]
    assert len(oss.calls) == 0


# ------------------------------------------------- server-wide read slots
def test_the_too_large_note_is_the_agreed_sentence(api, auth, world, oss):
    attach(world, entry(35, "big.pdf", 11 * MB))
    _, data, _ = read(api, 35)
    assert data["note"] == "Too large to read here (over 10 MB) — open it on the dashboard."
    assert mcp_files.MAX_CONCURRENT_READS == 2 and mcp_files.READ_WAIT_SECONDS == 30


@pytest.fixture
def slots(monkeypatch):
    """Fresh server-wide read slots, with a short wait."""
    import threading
    monkeypatch.setattr(mcp_files, "_reads", threading.BoundedSemaphore(mcp_files.MAX_CONCURRENT_READS))
    monkeypatch.setattr(mcp_files, "READ_WAIT_SECONDS", 0.3)
    return mcp_files._reads


def test_when_every_read_slot_is_taken_a_caller_is_told_busy_after_the_wait(api, auth, world, oss, slots):
    pdf = make_pdf(["x"])
    attach(world, entry(36, "a.pdf", len(pdf)))
    oss.add(responses.GET, OSS, body=pdf)
    slots.acquire()
    slots.acquire()                                                   # two reads in progress elsewhere
    with pytest.raises(ToolFailure) as e:
        read(api, 36)
    assert e.value.message == "Busy, try again in a moment." and e.value.status == "busy"
    assert len(oss.calls) == 0
    slots.release()
    _, data, _ = read(api, 36)                                        # a slot is free again
    assert data["included"] == ["text", "pdf"]
    slots.release()


def test_at_most_two_reads_run_at_once_across_accounts(api, world, auth, b_auth, oss, slots, monkeypatch):
    import threading
    monkeypatch.setattr(mcp_files, "READ_WAIT_SECONDS", 10)
    pdf = make_pdf(["x"])
    attach(world, entry(37, "a.pdf", len(pdf)))
    attach(world.peer, entry(37, "a.pdf", len(pdf)))
    lock, state, gate = threading.Lock(), {"now": 0, "max": 0}, threading.Event()

    class Held:
        status_code, headers = 200, {}

        def __enter__(self):
            with lock:
                state["now"] += 1
                state["max"] = max(state["max"], state["now"])
            return self

        def __exit__(self, *exc):
            with lock:
                state["now"] -= 1

        def iter_content(self, size):
            gate.wait(5)
            yield pdf

    monkeypatch.setattr(mcp_files, "_get", lambda url: Held())
    results, threads = [], []
    for user in (ME, ME, OTHER, OTHER, ME):
        t = threading.Thread(target=lambda u=user: results.append(read(api, 37, user_id=u)[1]["included"]))
        threads.append(t)
        t.start()
    for _ in range(100):
        if state["now"] == 2:
            break
        threading.Event().wait(0.02)
    threading.Event().wait(0.2)
    assert state["now"] == 2                                          # the other three wait for a slot
    gate.set()
    for t in threads:
        t.join(10)
    assert state["max"] == 2 and results == [["text", "pdf"]] * 5


# ------------------------------------------------------- fix round 1: hardening
def test_a_redirect_from_oss_is_not_followed(api, auth, world, oss):
    attach(world, entry(40, "x.pdf", 1000))
    oss.add(responses.GET, OSS, status=302, headers={"Location": "http://127.0.0.1/latest/meta-data"})
    oss.add(responses.GET, "http://127.0.0.1/latest/meta-data", body=b"%PDF-1.4 internal")
    with pytest.raises(ToolFailure) as e:
        read(api, 40)
    assert e.value.message == UNREACHABLE and len(oss.calls) == 1


@pytest.mark.parametrize("url", [
    "https://evil.example.com/taskFile/a.pdf?Signature=x",
    "https://yungu-common.oss-cn-hangzhou.aliyuncs.com.evil.example/a.pdf",
    "https://other-bucket.oss-cn-hangzhou.aliyuncs.com/a.pdf",
    "https://127.0.0.1/a.pdf", "https://[::1]/a.pdf", "https://169.254.169.254/a.pdf",
    "https://yungu-common.oss-cn-hangzhou.aliyuncs.com:8443/a.pdf",
    "https://user:pw@yungu-common.oss-cn-hangzhou.aliyuncs.com/a.pdf",
    "ftp://yungu-common.oss-cn-hangzhou.aliyuncs.com/a.pdf"])
def test_only_yungus_oss_hosts_are_fetched(api, auth, world, oss, url):
    world.redirect = url
    attach(world, entry(41, "x.pdf", 1000))
    with pytest.raises(ToolFailure) as e:
        read(api, 41)
    assert e.value.message == UNREACHABLE and len(oss.calls) == 0


def test_both_known_oss_hosts_are_fetched(api, auth, world, oss):
    pdf = make_pdf(["ok"])
    public = OSS.replace("yungu-common", "yungu-public")
    world.redirect = public
    attach(world, entry(42, "x.pdf", len(pdf)))
    oss.add(responses.GET, public, body=pdf)
    assert read(api, 42)[1]["included"] == ["text", "pdf"]


class Stalled:
    """A response whose body never comes until it is closed (a slow drip, or a stall)."""

    def __init__(self):
        import threading
        self.status_code, self.headers, self.closed = 200, {}, threading.Event()

    def iter_content(self, size):
        yield b"%PDF-"
        self.closed.wait(10)
        raise requests.ConnectionError("read on a closed connection")

    def close(self):
        self.closed.set()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def test_a_stalled_body_is_cut_off_at_the_deadline(api, auth, world, oss, monkeypatch):
    import time
    stalled = Stalled()
    monkeypatch.setattr(mcp_files, "_get", lambda url: stalled)
    monkeypatch.setattr(mcp_files, "DOWNLOAD_TIMEOUT_SECONDS", 0.3)
    attach(world, entry(43, "slow.pdf", 1000))
    started = time.monotonic()
    with pytest.raises(ToolFailure) as e:
        read(api, 43)
    assert e.value.status == "timeout" and time.monotonic() - started < 3
    assert stalled.closed.is_set()


def test_the_50_megapixel_guard_refuses_before_decoding(api, auth, world, oss):
    buf = io.BytesIO()
    Image.new("1", (8000, 7000)).save(buf, "PNG")                    # 56 MP, tiny on the wire
    attach(world, entry(44, "huge.png", len(buf.getvalue()), "image"))
    oss.add(responses.GET, OSS, body=buf.getvalue())
    _, data, blocks = read(api, 44)
    assert blocks == [] and "too large" in data["note"] and data["included"] == []


def test_bmp_bytes_named_png_are_refused_gracefully(api, auth, world, oss):
    bmp = image_bytes((20, 20), "BMP")
    attach(world, entry(45, "pic.png", len(bmp), "image"))
    oss.add(responses.GET, OSS, body=bmp)
    _, data, blocks = read(api, 45)
    assert blocks == [] and data["note"] and data["included"] == []


def test_a_file_from_another_of_the_accounts_assignments_is_not_found(api, auth, world, oss):
    attach(world, entry(46, "mine-elsewhere.pdf", 1000), aid=94929)    # a real assignment of this account
    attach(world, entry(47, "here.pdf", 1000))
    with pytest.raises(ToolFailure) as e:
        read(api, 46, aid=AID)
    assert e.value.message == "Not found." and redirects(world) == [] and len(oss.calls) == 0
