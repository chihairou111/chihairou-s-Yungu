# yungu_task — task.yungu.org API client

Pure-HTTP (no browser). Needs `requests` and `cryptography`. Credentials come from your code / env vars; nothing is hard-coded.

```python
import os
from yungu_task import *
c = YunguTask(os.environ["YUNGU_ID"], os.environ["YUNGU_PASSWORD"]); c.login()

for t in c.iter_tasks(TODO):                       # also SUBMITTED, ARCHIVED (semester_id=491)
    print(t["title"], t["courseName"], t["deadline"], t["doTaskStatus"], t["taskPublishId"])

c.attachments(94194)                               # teacher's files
c.download_file(file_id, "out.pdf")                # original file; c.file_url(id) = preview (PDF)

# submit files (first time or re-submit/edit - picks the right endpoint itself)
c.set_files_and_submit(93251, ["a.txt", "b.png"])  # upload + draft + submit, replaces existing files
# or step by step:
a = c.achievement(93251); f = c.upload_file("a.txt")
c.save_draft(a["taskUserRelationId"], [f.file_id]); c.submit(93251, [f.file_id])
c.save_draft(a["taskUserRelationId"], [])          # = delete all draft files (UI delete does exactly this)

c.calendar_week(date(2026,10,18))                  # 7 lists Mon..Sun; events have name, startTime, playground (room)
```

## Login (solved)
`RSA_PKCS1v15(server public key, {"password": md5(pw), "timestamp": ms, "nonce": uuid4})` → `POST /cas/loginForLoginId`
→ `redirectUrl?ticket=` → cookies. (My first attempt encrypted the raw password; that is why it was rejected.)

## What was verified live (`python3 test_live.py 3`: 80 checks, 3 write cycles, all passed)
login ×2, wrong-password error, todo/submitted lists + pagination (83 submitted items, no dups), counts == list length,
attachment download size equals `fileSizeByte`, preview URL, calendar window math identical to the browser's numbers,
event counts per day equal to the browser's, next/prev week events inside window, and on assignment 93251:
upload→draft visible→submit→re-fetch, delete (empty draft)→upload other→update, multi-file incl. Chinese+space filenames and
binary content (round-trips byte-exact), `set_files_and_submit`; request bodies have exactly the key order the browser sends.

## NOT verified (be careful)
- **First-ever submit** (`submitAchievementSendMessage`) from this client: the test assignment was already submitted, so only
  `updateAchievementAndSendMessage` ran live. The first-submit body is built from the browser capture (same keys, minus `achievementId`).
- Submitting with **zero files** (draft emptied then confirm), **group tasks** (`teamId`/`teamList` — browser sent `teamId:null`
  in getAchievementDetail and `teamList:null` for a personal task), tasks that require text/online-document answers (`textStatus`),
  files > ~5 GB (client uses a single OSS PUT; the web app may use multipart for big files), the "Delay" filter (no delayed task left to observe).
- `FileType` for unknown extensions falls back to `application/octet-stream` (browser uses its own MIME table).
- Overdue tasks accept submissions (93251 was past deadline) — the server did not block it.
