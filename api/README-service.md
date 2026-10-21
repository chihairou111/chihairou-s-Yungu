# Yungu LMS API service

FastAPI app in `service/`, listening on `127.0.0.1:8100` only. State lives in `YUNGU_STATE_DIR`
(default `/var/lib/yungu-lms`, dirs 0700, files 0600):

    credentials.json   the owner's saved Yungu login (automatic re-login)
    owner.json         {userId, loginId} of the owner: fixed by the first sign-in, never cleared
    tokens.json        hashes of the owner's dashboard tokens
    users/<userId>/submitted-files.json   each account's hand-in record

## Accounts
Any Yungu student account can sign in. The **owner** (owner.json) keeps today's behaviour: password saved,
automatic single-flight re-login with the lockout guard and back-off, survives restarts; sign-out deletes
the password and the owner's tokens. **Every other account** has no password stored anywhere (not on disk,
dropped from memory once its login is done): its Yungu session and its tokens (hashed) live in memory only,
so when Yungu ends that session, or the service restarts, its requests answer 401 "Sign in again." and no
login is attempted. Each token maps to one userId; Yungu calls, the read cache, the hand-in record, the
Mark-as-submitted lock and every lock around a login are per account. A state dir from the single-owner
service (with `submitted-files.json` at the top) is moved into `users/<owner>/` on load.

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
