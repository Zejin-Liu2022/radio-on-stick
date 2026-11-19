from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .config import Config
from .db import Database


logger = logging.getLogger(__name__)

_PROTOCOL = "radio-station/1"
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_KEY_STATION_ID = "directory.station_id"
_KEY_PUBLIC_KEY = "directory.public_key"
_KEY_INVITE_CODE = "directory.invite_code"


def normalize_code(raw: str) -> str:
    result: list[str] = []
    for char in str(raw or "").upper().strip():
        if char in {" ", "\t", "\r", "\n", "-", "_"}:
            continue
        if char in {"I", "L"}:
            char = "1"
        elif char == "O":
            char = "0"
        elif char == "U":
            char = "V"
        result.append(char)
    return "".join(result)


def code_hash(code: str) -> str:
    digest = hashlib.sha256(("radio-invite/1:" + normalize_code(code)).encode()).digest()
    return "sha256:" + base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def new_invite_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(16))


class DirectoryClient:
    """Register this Station with a public Directory and keep it alive."""

    def __init__(self, config: Config, db: Database) -> None:
        self.config = config
        self.db = db
        self.enabled = bool(
            config.directory_url
            and config.directory_register_token
            and config.directory_public_url
        )
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._registered = False
        self._last_error = ""
        self._last_success = 0.0
        self._station_id = self._setting(_KEY_STATION_ID) or self._new_station_id()
        self._public_key = self._setting(_KEY_PUBLIC_KEY) or self._new_public_key()
        self._invite_code = self._setting(_KEY_INVITE_CODE) or new_invite_code()
        self._save_identity()

    def _setting(self, key: str) -> str:
        return str(self.db.get_setting(key) or "").strip()

    def _save_identity(self) -> None:
        self.db.set_settings(
            {
                _KEY_STATION_ID: self._station_id,
                _KEY_PUBLIC_KEY: self._public_key,
                _KEY_INVITE_CODE: self._invite_code,
            }
        )

    @staticmethod
    def _new_station_id() -> str:
        return "st_" + secrets.token_hex(6)

    @staticmethod
    def _new_public_key() -> str:
        return "ed25519:" + base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()

    def _station_name(self) -> str:
        try:
            from .settings import KEY_STATION_NAME, load_ui_settings

            return str(
                load_ui_settings(self.db, self.config).get(KEY_STATION_NAME)
                or self.config.station_name
            )
        except Exception:
            return self.config.station_name

    def _status_locked(self, include_code: bool) -> dict[str, Any]:
        result: dict[str, Any] = {
            "enabled": self.enabled,
            "registered": self._registered,
            "station_id": self._station_id,
            "public_url": self.config.directory_public_url,
            "last_error": self._last_error,
            "last_success": self._last_success,
        }
        if include_code:
            result["invite_code"] = self._invite_code
        return result

    def status(self, *, include_code: bool = False) -> dict[str, Any]:
        with self._lock:
            return self._status_locked(include_code)

    def _request(self, path: str, payload: dict[str, Any], method: str = "POST") -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.config.directory_url + path,
            data=body,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.config.directory_register_token}",
                "User-Agent": "radio-on-stick-directory/1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                raw = response.read(64 * 1024)
                return json.loads(raw.decode("utf-8", "replace")) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read(2048).decode("utf-8", "replace")
            except OSError:
                pass
            raise RuntimeError(f"directory HTTP {exc.code}: {detail[:160]}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise RuntimeError(f"directory request failed: {exc}") from exc

    def _descriptor(self) -> dict[str, Any]:
        return {
            "protocol": _PROTOCOL,
            "station_id": self._station_id,
            "name": self._station_name(),
            "public_key": self._public_key,
            "description": "",
            "capabilities": ["join", "mesh", "local-library"],
            "connectivity": ["direct"],
            "endpoints": [
                {"kind": "direct", "url": self.config.directory_public_url}
            ],
            "issued_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

    def refresh(self) -> dict[str, Any]:
        if not self.enabled:
            return self.status()
        with self._lock:
            if not self._registered:
                self._request(
                    "/v1/stations",
                    {
                        "station": self._descriptor(),
                        "invite_hashes": [code_hash(self._invite_code)],
                    },
                )
                self._registered = True
            else:
                self._request(
                    f"/v1/stations/{urllib.parse.quote(self._station_id, safe='')}/heartbeat",
                    {
                        "endpoints": [
                            {"kind": "direct", "url": self.config.directory_public_url}
                        ],
                        "connectivity": ["direct"],
                    },
                )
            self._last_success = time.time()
            self._last_error = ""
            return self._status_locked(include_code=True)

    def rotate_invite(self) -> dict[str, Any]:
        with self._lock:
            self._invite_code = new_invite_code()
            self.db.set_setting(_KEY_INVITE_CODE, self._invite_code)
            self._registered = False
        return self.refresh()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.refresh()
            except Exception as exc:
                with self._lock:
                    self._last_error = str(exc)
                logger.warning("directory refresh failed: %s", exc)
            self._stop.wait(max(30, int(self.config.directory_heartbeat_sec)))

    def start(self) -> None:
        if not self.enabled or self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._loop, name="radio-directory", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
