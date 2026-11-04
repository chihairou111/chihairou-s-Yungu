"""What read_attachment (mcp_tools.py) makes of one file: the download from Yungu's signed OSS URL and what an
agent can read of it.

  * PDF (and Office/iWork through Yungu's PDF preview): the text, page by page (pypdf), plus the PDF itself.
    Password-protected or damaged PDFs: a note instead.
  * Images (PNG, JPEG, GIF, WebP): the image; over MAX_IMAGE_SIDE px or MAX_IMAGE_BYTES it is downscaled
    (Pillow) so it stays usable by model APIs (Anthropic's take about 5 MB of base64 per image).
  * Plain text (txt, csv, md, json, code...): decoded (UTF-8, else GB18030).
  * Yungu online documents: the text of their Quill delta (no download).

Downloads stream into memory, never more than MAX_BYTES (no disk), and stop at DOWNLOAD_TIMEOUT_SECONDS for
the whole call; at most MAX_CONCURRENT_READS run at once in the whole server (read_slot). The signed URL
never leaves `download` and nothing here logs: failures are plain exceptions without the URL in their text.
"""
import io
import json
import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import List, Tuple

import requests
from PIL import Image, ImageOps
from pypdf import PdfReader

MAX_BYTES = 10 * 1024 * 1024
CHUNK_BYTES = 64 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 30            # the whole call: download, then text extraction with what is left
EXTRACT_MIN_SECONDS = 5                 # PDF text gets at least this long, however slow the download was
SOCKET_TIMEOUT = (5, 10)                 # connect, each read (the overall deadline is checked per chunk)
MAX_TEXT_CHARS = 200_000
MAX_IMAGE_SIDE = 2048
MAX_IMAGE_BYTES = 3_500_000              # as sent: base64 of this is just under 5 MB
MAX_IMAGE_PIXELS = 50_000_000            # refused before decoding (decompression bombs)
MAX_CONCURRENT_READS = 2                 # downloads + extractions at once, whatever the account (memory)
READ_WAIT_SECONDS = 30                   # how long a call waits for one before it is told Busy
clock = time.monotonic
_reads = threading.BoundedSemaphore(MAX_CONCURRENT_READS)

IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
IMAGE_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp"}
TEXT_EXTENSIONS = {
    "txt", "text", "csv", "tsv", "md", "markdown", "json", "jsonl", "ipynb", "xml", "yaml", "yml", "toml", "ini",
    "cfg", "log", "tex", "bib", "srt", "vtt", "html", "htm", "css", "scss", "js", "mjs", "ts", "jsx", "tsx", "py",
    "java", "c", "h", "cpp", "cc", "hpp", "cs", "go", "rs", "rb", "php", "swift", "kt", "m", "r", "sql", "sh",
    "bat", "ps1", "lua", "pl", "scala", "dart", "vue", "svelte"}

Image.MAX_IMAGE_PIXELS = None            # PIL's own check only warns below 2x; ours (MAX_IMAGE_PIXELS) refuses
logging.getLogger("pypdf").setLevel(logging.CRITICAL)        # its warnings about odd files are not ours to log

TOO_LARGE_NOTE = "Too large to read here (over 10 MB) — open it on the dashboard."


@dataclass
class TextBlock:
    text: str


@dataclass
class PdfBlock:
    data: bytes
    uri: str


@dataclass
class ImageBlock:
    data: bytes
    mime: str


class TooLarge(Exception):
    pass


class TooSlow(Exception):
    pass


class DownloadFailed(Exception):
    pass


class Busy(Exception):
    """Every read slot stayed taken for READ_WAIT_SECONDS."""


class Unreadable(Exception):
    """The bytes came but cannot be read: the message is the note for the agent."""


# ------------------------------------------------------------------ kinds
def extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def kind_of(ref: dict) -> str:
    """The FileRef's kind as the agent sees it: mapping's, plus "online document" and "text"."""
    if ref.get("online"):
        return "online document"
    if ref.get("kind") == "other" and extension(ref.get("name") or "") in TEXT_EXTENSIONS:
        return "text"
    return ref.get("kind") or "other"


def readable(ref: dict) -> bool:
    """Whether read_attachment gives content for it (an Office file's PDF preview may still prove too big)."""
    kind, size = kind_of(ref), ref.get("size") or 0
    if kind == "online document":
        return bool(delta_text(ref.get("content") or ""))
    if kind == "office":
        return True
    if kind == "image" and extension(ref.get("name") or "") not in IMAGE_EXTENSIONS:
        return False
    return kind in ("pdf", "image", "text") and size <= MAX_BYTES


# --------------------------------------------------------------- download
@contextmanager
def read_slot():
    """One of the MAX_CONCURRENT_READS server-wide slots for a download and what is made of it: a 10 MB
    file costs over 100 MB while it is read (bytes, pypdf, base64, JSON). Busy after READ_WAIT_SECONDS.
    Runs in the tool's worker thread, which waits; the per-account cap (mcp_server) bounds how many do."""
    slots = _reads
    if not slots.acquire(timeout=READ_WAIT_SECONDS):
        raise Busy()
    try:
        yield
    finally:
        slots.release()


def _get(url: str):
    return requests.get(url, stream=True, timeout=SOCKET_TIMEOUT, allow_redirects=True,
                        headers={"Accept-Encoding": "identity"})        # what we count is what arrives


def download(url: str, deadline: float) -> bytes:
    """The bytes behind a signed https URL, at most MAX_BYTES. TooLarge / TooSlow / DownloadFailed."""
    if not url.startswith("https://"):
        raise DownloadFailed("not https")
    try:
        with _get(url) as r:
            if r.status_code != 200:
                raise DownloadFailed(f"HTTP {r.status_code}")
            declared = str(r.headers.get("Content-Length") or "")
            if declared.isdigit() and int(declared) > MAX_BYTES:
                raise TooLarge()
            out = bytearray()
            for chunk in r.iter_content(CHUNK_BYTES):
                if clock() > deadline:
                    raise TooSlow()
                out += chunk
                if len(out) > MAX_BYTES:
                    raise TooLarge()
            return bytes(out)
    except requests.Timeout:
        raise TooSlow() from None
    except requests.RequestException as e:
        raise DownloadFailed(type(e).__name__) from None


# ----------------------------------------------------------------- reading
def _cap(text: str) -> Tuple[str, bool]:
    if len(text) <= MAX_TEXT_CHARS:
        return text, False
    return text[:MAX_TEXT_CHARS].rstrip() + " …", True


def looks_like_pdf(data: bytes) -> bool:
    return b"%PDF-" in data[:1024]                  # viewers accept a little junk before the header


def pdf_text(data: bytes, deadline: float) -> Tuple[str, int, bool]:
    """(page-separated text, pages, truncated). Unreadable for password-protected or damaged PDFs. Pages
    past `deadline` (at least EXTRACT_MIN_SECONDS from now) are left out, as is text past MAX_TEXT_CHARS."""
    deadline = max(deadline, clock() + EXTRACT_MIN_SECONDS)
    if not looks_like_pdf(data):
        raise Unreadable("This file is not a readable PDF. Open it in the dashboard.")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                opened = reader.decrypt("")
            except Exception:
                opened = 0
            if not opened:
                raise Unreadable("This PDF is password-protected, so it can't be read here. Open it in the dashboard.")
        pages = reader.pages
        count = len(pages)
    except Unreadable:
        raise
    except Exception:
        raise Unreadable("This PDF looks damaged, so it can't be read here. Open it in the dashboard.") from None
    parts, total, truncated = [], 0, False
    for number in range(count):
        if clock() > deadline:
            truncated = True
            break
        try:
            text = (pages[number].extract_text() or "").strip()
        except Exception:                                      # one bad page does not lose the others
            text = ""
        parts.append(f"--- Page {number + 1} ---\n{text}")
        total += len(parts[-1]) + 2
        if total > MAX_TEXT_CHARS:
            truncated = True
            break
    if not any(p.split("\n", 1)[1] for p in parts):
        return "", count, truncated
    text, cut = _cap("\n\n".join(parts))
    return text, count, truncated or cut


def image(data: bytes) -> Tuple[bytes, str, int, int, bool]:
    """(bytes, mime, width, height, downscaled): as it is when small enough, else at most MAX_IMAGE_SIDE px."""
    try:
        img = Image.open(io.BytesIO(data))
        fmt, (width, height) = img.format, img.size
    except Exception:
        raise Unreadable("This file is not a readable image. Open it in the dashboard.") from None
    if fmt not in IMAGE_FORMATS:
        raise Unreadable("Only PNG, JPEG, GIF and WebP images can be read here. Open it in the dashboard.")
    if width * height > MAX_IMAGE_PIXELS:
        raise Unreadable("This image is too large to read here. Open it in the dashboard.")
    if max(width, height) <= MAX_IMAGE_SIDE and len(data) <= MAX_IMAGE_BYTES:
        return data, IMAGE_FORMATS[fmt], width, height, False
    try:
        img.seek(0)
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
        out = _encode(img.convert("RGBA"), "PNG") if alpha else b""
        if not out or len(out) > MAX_IMAGE_BYTES:
            flat = img.convert("RGBA")
            background = Image.new("RGB", flat.size, (255, 255, 255))
            background.paste(flat, mask=flat.getchannel("A"))
            out, fmt = _encode(background, "JPEG", quality=85), "JPEG"
            if len(out) > MAX_IMAGE_BYTES:
                out = _encode(background, "JPEG", quality=60)
        else:
            fmt = "PNG"
    except Unreadable:
        raise
    except Exception:
        raise Unreadable("This image could not be read. Open it in the dashboard.") from None
    return out, IMAGE_FORMATS[fmt], width, height, True


def _encode(img, fmt: str, **options) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, optimize=True, **options)
    return buf.getvalue()


def plain_text(data: bytes) -> Tuple[str, bool]:
    """UTF-8 (BOM or not; UTF-16 with its BOM), else GB18030; capped."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = data.decode("utf-16", errors="replace")
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = data.decode("gb18030")
            except UnicodeDecodeError:
                text = data.decode("utf-8", errors="replace")
    return _cap(text.replace("\r\n", "\n"))


# ------------------------------------------------------- online documents
def _line_prefix(attrs: dict, numbers: List[int]) -> str:
    indent = attrs.get("indent") if isinstance(attrs.get("indent"), int) else 0
    pad = "  " * max(0, min(indent, 8))
    header, kind = attrs.get("header"), attrs.get("list")
    if kind != "ordered":
        numbers.clear()
    if isinstance(header, int) and 1 <= header <= 6:
        return "#" * header + " "
    if kind == "ordered":
        del numbers[indent + 1:]
        while len(numbers) <= indent:
            numbers.append(0)
        numbers[indent] += 1
        return f"{pad}{numbers[indent]}. "
    if kind == "bullet":
        return f"{pad}- "
    if kind in ("checked", "unchecked"):
        return f"{pad}[{'x' if kind == 'checked' else ' '}] "
    if attrs.get("blockquote"):
        return "> "
    if attrs.get("code-block"):
        return "    "
    return pad


def online_text(content: str) -> Tuple[str, bool]:
    """A Quill delta (JSON) -> (plain text, truncated): headings "# ", list items "- " / "1. ", links
    "(url)", embeds "[image]". Content that is no delta is taken as text."""
    return _cap(_delta(content))


def delta_text(content: str) -> str:
    return online_text(content)[0]


def _delta(content: str) -> str:
    try:
        doc = json.loads(content) if content else {}
    except ValueError:
        return content.strip()
    ops = doc.get("ops") if isinstance(doc, dict) else doc
    if not isinstance(ops, list):
        return ""
    lines, line, numbers = [], [], []
    for op in ops:
        if not isinstance(op, dict):
            continue
        insert = op.get("insert")
        attrs = op.get("attributes") if isinstance(op.get("attributes"), dict) else {}
        if isinstance(insert, dict):
            line.append(f"[{next(iter(insert), 'embed')}]")
            continue
        if not isinstance(insert, str):
            continue
        for i, piece in enumerate(insert.split("\n")):
            if i:
                lines.append(_line_prefix(attrs, numbers) + "".join(line))
                line = []
            if piece:
                link = attrs.get("link")
                line.append(piece + (f" ({link})" if isinstance(link, str) and link.startswith(("http://", "https://"))
                                     else ""))
    if line:
        lines.append("".join(line))
    return "\n".join(lines).strip()


def deadline_from_now() -> float:
    return clock() + DOWNLOAD_TIMEOUT_SECONDS
