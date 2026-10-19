# Yungu LMS API service

FastAPI app in `service/`, listening on `127.0.0.1:8100` only. State (saved login, owner, token hashes)
lives in `YUNGU_STATE_DIR` (default `/var/lib/yungu-lms`, dir 0700, files 0600).

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
