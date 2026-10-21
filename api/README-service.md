# Yungu LMS API service

FastAPI app in `service/`, listening on `127.0.0.1:8100` only. State lives in `YUNGU_STATE_DIR`
(default `/var/lib/yungu-lms`, dirs 0700, files 0600):

    credentials.json   the owner's saved Yungu login (automatic re-login)
    owner.json         {userId, loginId} of the owner: fixed by the first sign-in, never cleared
    tokens.json        {userId, hashes}: the owner's dashboard tokens (an old {hashes} list is bound to
                       the owner on first use)
    users/<userId>/submitted-files.json   each account's hand-in record

## Accounts
Any Yungu student account can sign in. The **owner** (owner.json) keeps today's behaviour: password saved,
automatic single-flight re-login with the lockout guard and back-off, survives restarts; sign-out deletes
the password and the owner's tokens. **Every other account** has no password stored anywhere (not on disk,
dropped from memory once its login is done): its Yungu session and its tokens (hashed) live in memory only,
so when Yungu ends that session, or the service restarts, its requests answer 401 "Sign in again." and no
login is attempted. Each token maps to one userId; Yungu calls, the read cache, the hand-in record, the
Mark-as-submitted lock and every lock around a login are per account. A state dir from the single-owner
service (with `submitted-files.json` at the top) is moved into `users/<owner>/` on the owner's first request.

- **Fails closed:** an owner.json that exists but is unreadable/invalid, or credentials.json/tokens.json with
  no owner.json, means *no owner*: no saved token counts, no password is saved, every sign-in is an ordinary
  (memory-only) account. A warning is logged. Fix the files by hand (or move them away) to recover.
- **File ids:** an account may open (`/files/<id>`), update (online docs), save to a draft or hand in only
  file ids it was shown by its own reads (assignment detail: attachments, its files, its hand-in) or made
  (uploads, new documents); any other id is a 404 with no Yungu call. Memory only, at most 5000 per account:
  after a restart, opening the assignment again makes its files usable.
- **Bounds:** each account's read cache drops expired entries and holds at most 300; an account other than
  the owner unused for 12 h is signed out and forgotten (the owner never); such an account keeps its 10
  newest tokens.
- **Sign-in throttling:** 5 refused sign-ins for one login id within 15 min → 429 "Too many attempts. Try
  again in a few minutes." with no Yungu call until the oldest is 15 min old; at most 3 sign-ins at once
  (beyond: 429 "Too many sign-ins right now. Try again in a moment."). Yungu being down does not count.

## Run by hand
    cd /root/yungu-lms/api
    .venv/bin/pip install -r requirements.txt     # venv: python3 -m venv .venv
    YUNGU_STATE_DIR=/tmp/yungu-state .venv/bin/uvicorn service.app:app --host 127.0.0.1 --port 8100

## systemd
    cp deploy/yungu-lms-api.service /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now yungu-lms-api
    journalctl -u yungu-lms-api -f

## Tests and live smoke
    .venv/bin/python -m pytest -q -W error        # offline, no network
    set -a; . /root/.config/yungu-lms/creds.env; set +a
    .venv/bin/python smoke_live.py                # read-only; saves a token in /root/.config/yungu-lms/smoke-token

The smoke never calls `DELETE /session` (it would delete the saved password) and makes no write calls.
