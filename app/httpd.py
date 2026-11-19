from __future__ import annotations

import hmac
import ipaddress
import json
import logging
import mimetypes
import re
import shutil
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .app import RadioApp
from .community import LeafAdmission
from .db import now_ms
from .ffmpeg import ffmpeg_status
from .mesh import MeshHub, accept_websocket
from .media_meta import probe_uploaded_audio
from .policy import PolicyError, load_policy, save_policy
from .uploads import cleanup_uploads, is_safe_upload_name
from .ratelimit import make_ip_key
from .stream import (
    detect_audio_format,
    StreamEnded,
    StreamError,
    StreamGone,
    StreamHub,
    StreamStale,
    StreamTimeout,
    StreamUnavailable,
    StreamUnsupported,
    open_transcoded_source,
)
from .sources.bilibili import BilibiliError, is_bilibili_url
from .settings import (
    SettingsError,
    add_background_url,
    admin_settings,
    load_background_urls,
    load_ui_settings,
    public_settings,
    remove_background_url,
    save_ui_settings,
)


logger = logging.getLogger(__name__)

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_BACKGROUND_NAME = re.compile(r"^[a-f0-9]{32}\.(jpg|png|webp)$")
_ALLOWED_REPORT_EVENTS = {"ended", "error", "stalled"}
_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
_UPLOAD_EXTENSIONS = {
    ".mp3",
    ".aac",
    ".m4a",
    ".mp4",
    ".ogg",
    ".oga",
    ".opus",
    ".webm",
    ".wav",
    ".flac",
}
_UPLOAD_SUFFIXES = {
    "mp3": {".mp3"},
    "aac": {".aac"},
    "m4a": {".m4a", ".mp4"},
    "ogg": {".ogg", ".oga", ".opus"},
    "webm": {".webm"},
    "wav": {".wav"},
    "flac": {".flac"},
}


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        retry_after: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = int(status)
        self.code = code
        self.message = message
        self.retry_after = retry_after
        self.extra = extra or {}


def _clean_text(value: Any, max_len: int, *, single_line: bool = True) -> str:
    text = str(value or "")
    if single_line:
        text = text.replace("\r", " ").replace("\n", " ")
    text = _CONTROL.sub("", text)
    text = " ".join(text.split()) if single_line else text.strip()
    if len(text) > max_len:
        raise ApiError(400, "too_long", f"文本超过 {max_len} 字")
    return text


def _summary(track: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": track.get("id"),
        "source": track.get("source"),
        "title": track.get("title"),
        "artist": track.get("artist"),
        "album": track.get("album"),
        "duration_ms": track.get("duration_ms"),
        "duration_estimated": bool(track.get("duration_estimated")),
        "cover_url": track.get("cover_url") or "",
    }


def _image_extension(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


class RadioServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    max_workers = 48

    def __init__(self, server_address: tuple[str, int], app: RadioApp) -> None:
        self.app = app
        self.stream = StreamHub(app.config, lambda: load_policy(app.db))
        self.mesh = MeshHub()
        self.leaves = LeafAdmission(
            max_active=app.config.http_leaf_max,
            ttl_sec=app.config.http_leaf_ttl_sec,
        )
        self._workers = threading.BoundedSemaphore(self.max_workers)
        super().__init__(server_address, RadioHandler)
        self._upload_stop = threading.Event()
        self._upload_thread = threading.Thread(
            target=self._upload_cleanup_loop,
            name="radio-upload-cleanup",
            daemon=True,
        )
        self._upload_thread.start()

    def _upload_cleanup_loop(self) -> None:
        interval = max(5, int(self.app.config.upload_cleanup_interval_sec))
        if getattr(self.app.config, "upload_delete_after_play", True):
            interval = min(interval, 10)
        while not self._upload_stop.is_set():
            try:
                cleanup_uploads(self.app)
            except Exception:
                logger.exception("periodic upload cleanup failed")
            self._upload_stop.wait(interval)

    def server_close(self) -> None:
        if self.app.directory is not None:
            self.app.directory.stop()
        self._upload_stop.set()
        if self._upload_thread.is_alive():
            self._upload_thread.join(timeout=3.0)
        try:
            self.stream.close()
        finally:
            try:
                self.mesh.shutdown()
            finally:
                super().server_close()

    def handle_error(self, request, client_address) -> None:
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionResetError, TimeoutError)):
            return
        super().handle_error(request, client_address)

    def process_request(self, request, client_address) -> None:
        if not self._workers.acquire(blocking=False):
            try:
                request.close()
            except OSError:
                pass
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._workers.release()
            raise

    def process_request_thread(self, request, client_address) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._workers.release()


class RadioHandler(BaseHTTPRequestHandler):
    server_version = "Radio/0.10"
    protocol_version = "HTTP/1.1"
    timeout = 15

    @property
    def app(self) -> RadioApp:
        return self.server.app  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:
        logger.debug("%s - %s", self.address_string(), fmt % args)

    def _send_json(
        self,
        status: int,
        payload: dict[str, Any],
        *,
        headers: dict[str, str] | None = None,
        cache: str = "no-store",
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(
        self,
        status: int,
        code: str,
        message: str,
        retry_after: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        payload = {"ok": False, "error": code, "message": message}
        if extra:
            payload.update(extra)
        headers = {"Retry-After": str(retry_after)} if retry_after else None
        self._send_json(status, payload, headers=headers)

    def _send_frame(self, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def _send_file(self, path: Path, *, cache_sec: int = 0) -> None:
        try:
            size = path.stat().st_size
            handle = path.open("rb")
        except OSError:
            self._send_error_json(404, "not_found", "文件不存在")
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif path.suffix in {".css", ".svg", ".html"}:
            content_type = f"{content_type}; charset=utf-8"
        try:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(size))
            self.send_header(
                "Cache-Control",
                f"public, max-age={cache_sec}" if cache_sec else "no-cache",
            )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "SAMEORIGIN")
            self.send_header("Connection", "close")
            self.end_headers()
            with handle:
                shutil.copyfileobj(handle, self.wfile, length=64 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            if not handle.closed:
                handle.close()

    def _static_path(self, url_path: str) -> Path | None:
        relative = url_path.lstrip("/") or "index.html"
        candidate = (self.app.config.static_dir / relative).resolve()
        try:
            candidate.relative_to(self.app.config.static_dir.resolve())
        except ValueError:
            return None
        return candidate

    def _client_ip(self) -> str:
        peer = self.client_address[0]
        try:
            is_loopback = ipaddress.ip_address(peer).is_loopback
        except ValueError:
            is_loopback = False
        if is_loopback:
            forwarded = self.headers.get("X-Real-IP") or ""
            if not forwarded:
                chain = self.headers.get("X-Forwarded-For") or ""
                forwarded = chain.split(",")[0].strip()
            if forwarded:
                try:
                    return str(ipaddress.ip_address(forwarded))
                except ValueError:
                    pass
        return peer

    def _ip_key(self) -> str:
        return make_ip_key(self._client_ip(), self.app.config.ip_hash_salt)

    def _enforce_client_access(self, path: str) -> None:
        if path == "/healthz" or path in {"/admin", "/admin/"}:
            return
        if path.startswith("/api/admin/") or path.startswith("/backgrounds/"):
            return
        # Static shell assets are harmless and are needed by the admin console
        # even when the admin network is outside the listener allow-list.
        if path in {
            "/style.css",
            "/admin.css",
            "/app.js",
            "/admin.js",
            "/mesh.js",
            "/placeholder.svg",
            "/manifest.webmanifest",
            "/sw.js",
        }:
            return
        policy = load_policy(self.app.db)
        # IP admission is deliberately owned by the Nginx allow-list
        # (/etc/nginx/snippets/radio-allow.conf), matching Pigman02's design.
        # The app-level setting remains for compatibility but is not exposed
        # in the admin console, so there is only one network gate.
        limit = int(policy.get("max_listeners") or 0)
        if limit > 0 and path in {"/", "/index.html", "/now.json", "/api/state"}:
            key = f"ip:{self._ip_key()}"
            if (
                not self.app.listeners.is_active(key)
                and self.app.listeners.count() >= limit
            ):
                raise ApiError(
                    503,
                    "access_full",
                    "当前听众人数已满，请稍后再试",
                    retry_after=15,
                )

    def _policy(self) -> dict:
        return load_policy(self.app.db)

    def _voter_key(self, value: Any = None) -> str:
        # One listener/voter per network address. This avoids counting
        # multiple tabs on the same device as different listeners.
        return f"ip:{self._ip_key()}"

    def _query_listener(self, query_string: str) -> str:
        key = f"ip:{self._ip_key()}"
        params = urllib.parse.parse_qs(query_string)
        nickname = _clean_text(
            (params.get("nickname") or [""])[0],
            self.app.config.nickname_max_len,
        )
        self.app.listeners.touch(key, nickname=nickname)
        return key

    def _decorate_snapshot(
        self, now: dict[str, Any], voter: str | None = None
    ) -> dict[str, Any]:
        listeners = self.app.listeners.count()
        seq = int(now.get("seq") or 0)
        now["listeners"] = listeners
        now["vote"] = self.app.votes.stats(seq, listeners, voter)
        now["mesh"] = {
            "enabled": True,
            "ws_url": "/ws",
            "manifest_url": "/source/manifest",
            "chunk_url": "/source/chunk",
            "stun": self.app.config.mesh_stun,
        }
        # The upstream URL is only for the server-side producer.  Browsers
        # must use /native/<track_id>, never the third-party URL.
        for item in (now, now.get("next")):
            if isinstance(item, dict):
                audio = item.get("audio")
                if isinstance(audio, dict):
                    audio.pop("upstream", None)
        return now

    def _read_json(self) -> dict[str, Any]:
        length_header = self.headers.get("Content-Length")
        if not length_header:
            return {}
        try:
            length = int(length_header)
        except ValueError as exc:
            raise ApiError(400, "bad_request", "无效的 Content-Length") from exc
        if length <= 0:
            return {}
        if length > self.app.config.max_body_bytes:
            raise ApiError(413, "body_too_large", "请求体过大")
        body = self.rfile.read(length)
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type and content_type != "application/json":
            raise ApiError(415, "unsupported_media_type", "只接受 application/json")
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise ApiError(400, "bad_json", "JSON 格式错误") from exc
        if not isinstance(data, dict):
            raise ApiError(400, "bad_json", "JSON 必须是对象")
        return data

    def _read_raw(self, max_bytes: int) -> bytes:
        length_header = self.headers.get("Content-Length")
        if not length_header:
            raise ApiError(411, "length_required", "缺少 Content-Length")
        try:
            length = int(length_header)
        except ValueError as exc:
            raise ApiError(400, "bad_request", "无效的 Content-Length") from exc
        if length <= 0:
            raise ApiError(400, "bad_request", "空文件")
        if length > max_bytes:
            raise ApiError(413, "body_too_large", "文件过大")
        return self.rfile.read(length)

    def _require_admin(self) -> None:
        token = self.app.config.admin_token
        if not token:
            raise ApiError(503, "admin_disabled", "未配置管理 token")
        header = self.headers.get("Authorization") or ""
        prefix = "Bearer "
        supplied = header[len(prefix) :] if header.startswith(prefix) else ""
        if not supplied or not hmac.compare_digest(supplied, token):
            raise ApiError(401, "unauthorized", "管理 token 无效")

    def _backgrounds(self) -> list[dict[str, Any]]:
        root = self.app.config.backgrounds_dir
        items: list[dict[str, Any]] = []
        if root.is_dir():
            for path in root.iterdir():
                if not path.is_file() or not _BACKGROUND_NAME.match(path.name):
                    continue
                try:
                    modified = int(path.stat().st_mtime)
                except OSError:
                    continue
                items.append(
                    {
                        "name": path.name,
                        "url": f"/backgrounds/{path.name}",
                        "type": "local",
                        "mtime": modified,
                    }
                )
            items.sort(key=lambda item: item["mtime"], reverse=True)
        for url in load_background_urls(self.app.db):
            items.append(
                {
                    "name": url,
                    "url": url,
                    "type": "network",
                    "mtime": 0,
                }
            )
        return items

    def _public_config(self) -> dict[str, Any]:
        settings = public_settings(load_ui_settings(self.app.db, self.app.config))
        settings["backgrounds"] = self._backgrounds()
        return settings

    def _form_guard(self, data: dict[str, Any]) -> None:
        if str(data.get("website") or "").strip():
            raise ApiError(400, "bad_request", "请求无效")
        timestamp = data.get("ts")
        if timestamp is None:
            return
        try:
            timestamp = int(timestamp)
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "bad_request", "无效的时间戳") from exc
        current = now_ms()
        if current - timestamp < self.app.config.min_form_ms:
            raise ApiError(429, "too_fast", "提交太快，请稍后再试", retry_after=2)
        if timestamp > current + 300_000:
            raise ApiError(400, "bad_request", "时间戳异常")

    def _check_banned(self, *texts: str) -> None:
        folded = "\n".join(texts).casefold()
        for word in self.app.config.banned_words:
            if word and word.casefold() in folded:
                raise ApiError(400, "blocked_word", "内容包含不允许的词语")

    def do_GET(self) -> None:
        parsed_path = urllib.parse.urlsplit(self.path).path
        if parsed_path == "/ws":
            try:
                self._enforce_client_access(parsed_path)
                self._handle_websocket()
            except ApiError as exc:
                self._send_error_json(exc.status, exc.code, exc.message, exc.retry_after, exc.extra)
            return
        try:
            self._enforce_client_access(parsed_path)
            self._dispatch_get()
        except ApiError as exc:
            self._send_error_json(exc.status, exc.code, exc.message, exc.retry_after, exc.extra)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            logger.exception("GET %s failed", self.path)
            self._send_error_json(500, "internal_error", "服务内部错误")

    def do_POST(self) -> None:
        try:
            self._enforce_client_access(urllib.parse.urlsplit(self.path).path)
            self._dispatch_post()
        except ApiError as exc:
            self._send_error_json(exc.status, exc.code, exc.message, exc.retry_after, exc.extra)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            logger.exception("POST %s failed", self.path)
            self._send_error_json(500, "internal_error", "服务内部错误")

    def _handle_websocket(self) -> None:
        try:
            ws = accept_websocket(self)
        except (ValueError, OSError) as exc:
            try:
                self._send_error_json(400, "bad_websocket", f"WebSocket 握手失败: {exc}")
            except OSError:
                pass
            return
        node = self.server.mesh.new_node(ws)
        self.server.mesh.serve(node)

    def _source_is_leaf(self) -> bool:
        return (
            self.headers.get("X-Radio-Source-Role", "").strip().lower() == "http"
        )

    def _admit_http_leaf(self) -> None:
        if not self._source_is_leaf():
            return
        if not self.server.leaves.allow(self._ip_key()):
            raise ApiError(
                429,
                "http_leaf_busy",
                "HTTP 直连叶子已达到上限，请稍后重试",
                retry_after=10,
            )

    def _dispatch_get(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path

        if path == "/now.json":
            voter = self._query_listener(parsed.query)
            now = self.app.player.snapshot()
            self._send_json(200, self._decorate_snapshot(now, voter))
            return
        if path == "/api/listeners":
            self._query_listener(parsed.query)
            items = self.app.listeners.items()
            self._send_json(
                200,
                {"ok": True, "listeners": len(items), "items": items},
            )
            return
        if path == "/api/config":
            self._send_json(200, self._public_config())
            return
        if path == "/api/state":
            now = self._decorate_snapshot(self.app.player.snapshot(), None)
            self._send_json(
                200,
                {
                    "now": now,
                    "upcoming": self.app.player.upcoming(40, self._ip_key()),
                    "queue": self.app.db.list_queue(20),
                    "messages": self.app.db.list_messages(
                        self.app.config.message_display_limit
                    ),
                    "history": self.app.db.list_request_history(100),
                    "listeners": now["listeners"],
                },
            )
            return
        if path == "/api/messages":
            self._send_json(
                200,
                {
                    "messages": self.app.db.list_messages(
                        self.app.config.message_display_limit
                    )
                },
            )
            return
        if path == "/api/search":
            self._handle_search(parsed.query)
            return
        if path.startswith("/api/lyrics/"):
            track_id = urllib.parse.unquote(path[len("/api/lyrics/") :])
            track = self.app.db.get_track(track_id)
            if track is None:
                raise ApiError(404, "not_found", "曲目不存在")
            decision = self.app.limiter.consume_lyrics(self._ip_key())
            if not decision.allowed:
                raise ApiError(
                    429,
                    decision.reason,
                    "歌词请求过于频繁，请稍后再试",
                    retry_after=decision.retry_after,
                )
            lrc, translation = self.app.aggregator.ensure_lyrics(track)
            self._send_json(
                200,
                {"track_id": track_id, "lrc": lrc, "translation": translation},
                cache="public, max-age=3600" if lrc else "no-store",
            )
            return
        if path == "/source/manifest":
            self._handle_source_manifest(parsed.query)
            return
        if path == "/source/chunk":
            self._handle_source_chunk(parsed.query)
            return
        if path == "/mesh.json":
            self._send_json(200, self.server.mesh.status())
            return
        if path == "/healthz":
            ok = self.app.db.health()
            self._send_json(
                200 if ok else 503,
                {
                    "ok": ok,
                    "db": ok,
                    "seq": self.app.player.snapshot(ensure=False).get("seq"),
                    "time_ms": now_ms(),
                    "ffmpeg": ffmpeg_status(self.app.config.ffmpeg_path),
                    "sources": [
                        getattr(s, "name", "")
                        for s in getattr(self.app.aggregator, "search_sources", [])
                    ],
                },
            )
            return
        if path == "/api/admin/state":
            self._require_admin()
            self._send_json(
                200,
                {
                    "now": self.app.player.snapshot(),
                    "queue": self.app.db.list_queue(50),
                    "messages": self.app.db.list_messages(
                        self.app.config.message_keep_limit
                    ),
                    "settings": admin_settings(
                        load_ui_settings(self.app.db, self.app.config)
                    ),
                    "backgrounds": self._backgrounds(),
                    "policy": load_policy(self.app.db),
                    "directory": self.app.directory.status(include_code=True)
                    if self.app.directory is not None
                    else {"enabled": False},
                    "tracks": self.app.db.list_all_tracks(200),
                },
            )
            return
        if path == "/api/admin/directory":
            self._require_admin()
            if self.app.directory is None:
                self._send_json(200, {"ok": False, "enabled": False})
            else:
                self._send_json(
                    200,
                    {"ok": True, "directory": self.app.directory.status(include_code=True)},
                )
            return
        if path == "/api/admin/queue":
            self._require_admin()
            self._send_json(
                200,
                {"queue": self.app.db.list_queue(50), "pending": self.app.db.count_pending()},
            )
            return
        if path.startswith("/backgrounds/"):
            name = urllib.parse.unquote(path[len("/backgrounds/") :])
            if not _BACKGROUND_NAME.match(name):
                raise ApiError(404, "not_found", "背景不存在")
            file_path = self.app.config.backgrounds_dir / name
            if not file_path.is_file():
                raise ApiError(404, "not_found", "背景不存在")
            self._send_file(file_path, cache_sec=86_400)
            return
        if path.startswith("/native/"):
            name = urllib.parse.unquote(path[len("/native/") :])
            self._handle_native_audio(name)
            return
        if path.startswith("/media/uploads/"):
            name = urllib.parse.unquote(path[len("/media/uploads/") :])
            if not name or "/" in name or "\\" in name or name in {".", ".."}:
                raise ApiError(404, "not_found", "音频不存在")
            file_path = self.app.config.uploads_dir / name
            if not file_path.is_file():
                raise ApiError(404, "not_found", "音频不存在")
            self._send_media_file(file_path)
            return
        if path in {"/admin", "/admin/"}:
            admin_page = self.app.config.static_dir / "index.html"
            if not admin_page.is_file():
                raise ApiError(404, "not_found", "管理页面不存在")
            self._send_file(admin_page, cache_sec=0)
            return

        static = self._static_path(urllib.parse.unquote(path))
        if static is not None and static.is_file():
            cache_sec = 0 if static.name == "index.html" else self.app.config.static_cache_sec
            self._send_file(static, cache_sec=cache_sec)
            return
        raise ApiError(404, "not_found", "路径不存在")

    def _dispatch_post(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/admin/directory/rotate":
            self._require_admin()
            if self.app.directory is None or not self.app.directory.enabled:
                raise ApiError(503, "directory_disabled", "Directory 未配置")
            try:
                status = self.app.directory.rotate_invite()
            except Exception as exc:
                raise ApiError(502, "directory_error", str(exc)) from exc
            self._send_json(200, {"ok": True, "directory": status})
            return
        if path == "/api/admin/directory/refresh":
            self._require_admin()
            if self.app.directory is None or not self.app.directory.enabled:
                raise ApiError(503, "directory_disabled", "Directory 未配置")
            try:
                status = self.app.directory.refresh()
            except Exception as exc:
                raise ApiError(502, "directory_error", str(exc)) from exc
            self._send_json(200, {"ok": True, "directory": status})
            return
        if path == "/api/messages":
            self._handle_message()
            return
        if path == "/api/request":
            self._handle_request()
            return
        if path == "/api/queue/cancel":
            self._handle_queue_cancel()
            return
        if path == "/api/upload":
            self._handle_upload()
            return
        if path == "/api/report":
            self._handle_report()
            return
        if path == "/api/vote-skip":
            self._handle_vote_skip()
            return
        if path == "/api/queue/pin":
            self._handle_queue_pin()
            return
        if path.startswith("/api/admin/"):
            self._require_admin()
            self._handle_admin(path)
            return
        raise ApiError(404, "not_found", "路径不存在")

    def _handle_source_manifest(self, query_string: str) -> None:
        self._admit_http_leaf()
        params = urllib.parse.parse_qs(query_string)
        requested = None
        raw_seq = (params.get("seq") or [""])[0]
        if raw_seq:
            try:
                requested = int(raw_seq)
            except (TypeError, ValueError) as exc:
                raise ApiError(400, "bad_seq", "无效的 seq") from exc
        now = self.app.player.snapshot(ensure=False)
        try:
            manifest = self.server.stream.manifest(now, requested)
        except StreamStale as exc:
            raise ApiError(409, "stale_stream", str(exc)) from exc
        except StreamUnsupported as exc:
            raise ApiError(415, "unsupported_audio", str(exc)) from exc
        except StreamTimeout as exc:
            raise ApiError(504, "source_timeout", str(exc)) from exc
        except (StreamUnavailable, StreamEnded) as exc:
            raise ApiError(503, "source_unavailable", str(exc)) from exc
        except StreamError as exc:
            raise ApiError(502, "source_error", str(exc)) from exc
        self._send_json(200, manifest)

    def _handle_source_chunk(self, query_string: str) -> None:
        self._admit_http_leaf()
        params = urllib.parse.parse_qs(query_string)
        raw_stream = (params.get("stream_id") or [""])[0]
        raw_seq = (params.get("seq") or [""])[0]
        try:
            stream_id = int(raw_stream)
            seq = int(raw_seq)
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "bad_chunk", "无效的 stream_id 或 seq") from exc
        if stream_id < 0 or stream_id > 0xFFFFFFFF or seq < 0:
            raise ApiError(400, "bad_chunk", "无效的 stream_id 或 seq")
        try:
            chunk = self.server.stream.get_chunk(stream_id, seq)
        except StreamGone as exc:
            raise ApiError(410, "chunk_gone", str(exc)) from exc
        except StreamUnsupported as exc:
            raise ApiError(415, "unsupported_audio", str(exc)) from exc
        except StreamTimeout as exc:
            raise ApiError(504, "chunk_timeout", str(exc)) from exc
        except (StreamUnavailable, StreamEnded) as exc:
            raise ApiError(503, "chunk_unavailable", str(exc)) from exc
        except StreamError as exc:
            raise ApiError(502, "chunk_error", str(exc)) from exc
        frame = chunk.frame(stream_id)
        self._send_frame(
            frame,
            {
                "X-Stream-Id": str(stream_id),
                "X-Seq": str(chunk.seq),
                "X-Start-Ms": str(chunk.start_ms),
                "X-Duration-Ms": str(chunk.duration_ms),
                "X-Server-Ms": str(int(chunk.server_ms)),
                "X-Chunk-Bytes": str(len(chunk.payload)),
            },
        )

    def _handle_search(self, query_string: str) -> None:
        params = urllib.parse.parse_qs(query_string)
        query = _clean_text((params.get("q") or [""])[0], 500)
        if not query:
            raise ApiError(400, "missing_query", "请输入歌名")
        if query.lower().startswith(("http://", "https://")) and not is_bilibili_url(query):
            raise ApiError(
                400,
                "unsupported_url",
                "只支持哔哩哔哩公开视频链接",
            )
        try:
            limit = int((params.get("limit") or [""])[0] or self.app.config.search_results_limit)
        except ValueError:
            limit = self.app.config.search_results_limit
        ip_key = self._ip_key()
        decision = self.app.limiter.consume_search(ip_key)
        if not decision.allowed:
            raise ApiError(
                429,
                decision.reason,
                "搜索过于频繁，请稍后再试",
                retry_after=decision.retry_after,
            )
        if is_bilibili_url(query):
            try:
                results = self.app.aggregator.search_url(query)
            except BilibiliError as exc:
                raise ApiError(422, "bilibili_resolve_failed", str(exc)) from exc
        else:
            results = self.app.aggregator.search(query, limit=limit)
        now = self.app.player.snapshot(ensure=False)
        active_ids = {
            str(item.get("track_id") or "")
            for item in self.app.db.list_queue(200)
            if item.get("track_id")
        }
        current = now.get("track")
        if isinstance(current, dict) and current.get("id"):
            active_ids.add(str(current["id"]))
        for result in results:
            track = self.app.db.find_track_by_source(
                str(result.get("source") or ""),
                str(result.get("source_id") or ""),
            )
            if track is None:
                track = self.app.db.find_track_by_title_artist(
                    str(result.get("title") or ""),
                    str(result.get("artist") or ""),
                )
            if track is not None:
                result["track_id"] = track["id"]
                result["queued"] = str(track["id"]) in active_ids
        self._send_json(200, {"ok": True, "query": query, "results": results})

    def _handle_message(self) -> None:
        if not self._policy()["messages_enabled"]:
            raise ApiError(403, "messages_disabled", "管理员已关闭留言")
        data = self._read_json()
        self._form_guard(data)
        nickname = _clean_text(data.get("nickname"), self.app.config.nickname_max_len) or "匿名"
        body = _clean_text(
            data.get("body"), self.app.config.message_max_len, single_line=False
        )
        if not body:
            raise ApiError(400, "missing_body", "请输入留言")
        self._check_banned(nickname, body)
        ip_key = self._ip_key()
        decision = self.app.limiter.consume_message(ip_key)
        if not decision.allowed:
            reason = f"1 分钟内最多留言 {self.app.config.message_per_min} 条，请稍后再试"
            raise ApiError(429, decision.reason, reason, retry_after=decision.retry_after)
        created_at = now_ms()
        message_id = self.app.db.insert_message(ip_key, nickname, body, None, created_at)
        self.app.db.trim_messages(self.app.config.message_keep_limit)
        logger.info("message %s by %s", message_id, nickname)
        self._send_json(
            201,
            {
                "ok": True,
                "message": {
                    "id": message_id,
                    "nickname": nickname,
                    "body": body,
                    "created_at": created_at,
                },
            },
        )

    def _send_media_file(self, path: Path) -> None:
        try:
            size = path.stat().st_size
            handle = path.open("rb")
        except OSError:
            raise ApiError(404, "not_found", "音频不存在")
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        content_type = {
            ".mp3": "audio/mpeg",
            ".aac": "audio/aac",
            ".m4a": "audio/mp4",
            ".mp4": "audio/mp4",
            ".ogg": "audio/ogg",
            ".oga": "audio/ogg",
            ".opus": "audio/ogg",
            ".webm": "audio/webm",
            ".wav": "audio/wav",
            ".flac": "audio/flac",
        }.get(path.suffix, content_type)
        start = 0
        end = size - 1
        status = 200
        range_header = self.headers.get("Range") or ""
        if range_header.startswith("bytes="):
            raw = range_header[6:].split(",", 1)[0].strip()
            try:
                left, _, right = raw.partition("-")
                if left:
                    start = int(left)
                    end = int(right) if right else size - 1
                elif right:
                    start = max(0, size - int(right))
                    end = size - 1
                else:
                    raise ValueError
            except ValueError:
                handle.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if start < 0 or end < start or start >= size:
                handle.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            end = min(end, size - 1)
            status = 206
        length = max(0, end - start + 1)
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Connection", "close")
            self.end_headers()
            handle.seek(start)
            remaining = length
            while remaining > 0:
                block = handle.read(min(64 * 1024, remaining))
                if not block:
                    break
                self.wfile.write(block)
                remaining -= len(block)
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            handle.close()

    def _handle_native_audio(self, track_id: str) -> None:
        """Serve the current/next track from this server only.

        This is the fallback for browsers or containers that cannot consume
        the RAD4 chunk/MSE path.  It never proxies the browser to a third-party
        URL: the server fetches the upstream and forwards the bytes.
        """
        if not track_id or "/" in track_id or "\\" in track_id or track_id in {".", ".."}:
            raise ApiError(404, "not_found", "音频不存在")
        now = self.app.player.snapshot(ensure=False)
        allowed = set()
        current = now.get("track")
        if isinstance(current, dict) and current.get("id"):
            allowed.add(str(current["id"]))
        next_track = now.get("next")
        if isinstance(next_track, dict) and next_track.get("id"):
            allowed.add(str(next_track["id"]))
        track = self.app.db.get_track(track_id)
        if track is None or str(track.get("id")) not in allowed:
            raise ApiError(404, "not_found", "当前没有这首歌")

        if track.get("source") == "upload":
            name = str(track.get("source_id") or "")
            if not name:
                url = str(track.get("audio_primary") or "")
                prefix = "/media/uploads/"
                if url.startswith(prefix):
                    name = url[len(prefix) :]
            if not name or "/" in name or "\\" in name or name in {".", ".."}:
                raise ApiError(404, "not_found", "上传音频不存在")
            file_path = self.app.config.uploads_dir / name
            if not file_path.is_file():
                raise ApiError(404, "not_found", "上传音频不存在")
            self._send_media_file(file_path)
            return

        url = str(track.get("audio_primary") or "").strip()
        try:
            parts = urllib.parse.urlsplit(url)
        except ValueError:
            raise ApiError(404, "not_found", "音频地址无效")
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            raise ApiError(404, "not_found", "音频地址无效")

        if str(track.get("source") or "") == "bilibili":
            # The Bilibili DASH CDN can take tens of seconds to deliver the
            # first raw bytes; ffmpeg opens the same URL much faster.  Stream
            # a transcoded MP3 so Safari's native fallback is not silent.
            position_ms = int(now.get("position_ms") or 0)
            if str(track.get("id")) != str((current or {}).get("id")):
                position_ms = 0
            try:
                source = open_transcoded_source(
                    url,
                    position_ms=position_ms,
                    track=track,
                    user_agent=self.app.config.user_agent,
                    ffmpeg_path=self.app.config.ffmpeg_path,
                    bitrate_kbps=self.app.config.transcode_bitrate_kbps,
                )
            except StreamUnsupported as exc:
                raise ApiError(415, "unsupported_audio", str(exc)) from exc
            except (StreamUnavailable, StreamError) as exc:
                raise ApiError(502, "native_upstream", str(exc)) from exc
            try:
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Connection", "close")
                self.end_headers()
                while True:
                    block = source.read(64 * 1024)
                    if not block:
                        break
                    self.wfile.write(block)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            finally:
                source.close()
            return

        headers = {
            "User-Agent": self.app.config.user_agent,
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Connection": "close",
        }
        source_name = str(track.get("source") or "")
        if source_name == "qq":
            headers["Referer"] = "https://music.qq.com/"
            headers["Origin"] = "https://music.qq.com"
        elif source_name == "netease":
            headers["Referer"] = "https://music.163.com/"
        elif source_name == "bilibili":
            headers["Referer"] = "https://www.bilibili.com/"
            headers["Origin"] = "https://www.bilibili.com"
        range_header = self.headers.get("Range")
        if range_header:
            headers["Range"] = range_header

        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as exc:
            code = exc.code if 400 <= exc.code <= 599 else 502
            try:
                exc.close()
            except OSError:
                pass
            raise ApiError(code, "native_upstream", "上游音频不可用")
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            raise ApiError(502, "native_upstream", f"上游音频不可用: {exc}")

        status = int(getattr(response, "status", 200))
        content_type = str(response.headers.get("Content-Type") or "")
        if self._policy().get("mp3_remote_only") and str(track.get("source") or "") != "upload":
            suffix = Path(parts.path).suffix.lower()
            if suffix != ".mp3" and "mpeg" not in content_type.lower() and "mp3" not in content_type.lower():
                try:
                    response.close()
                except OSError:
                    pass
                raise ApiError(415, "mp3_only", "管理员只允许 MP3 第三方音源")
        if not content_type or content_type.lower() in {
            "application/octet-stream",
            "binary/octet-stream",
        }:
            content_type = mimetypes.guess_type(parts.path)[0] or content_type or "application/octet-stream"
        content_length = response.headers.get("Content-Length")
        content_range = response.headers.get("Content-Range")
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Connection", "close")
            if content_length:
                self.send_header("Content-Length", str(content_length))
            if content_range:
                self.send_header("Content-Range", content_range)
            self.end_headers()
            while True:
                block = response.read(64 * 1024)
                if not block:
                    break
                self.wfile.write(block)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            try:
                response.close()
            except OSError:
                pass

    def _read_upload_to_file(self, path: Path, length: int) -> bytes:
        remaining = length
        prefix = b""
        with path.open("wb") as handle:
            while remaining > 0:
                block = self.rfile.read(min(64 * 1024, remaining))
                if not block:
                    raise ApiError(400, "bad_upload", "上传内容不完整")
                if len(prefix) < 64:
                    prefix += block[: 64 - len(prefix)]
                handle.write(block)
                remaining -= len(block)
        return prefix

    def _handle_upload(self) -> None:
        if not self._policy()["uploads_enabled"]:
            raise ApiError(403, "uploads_disabled", "管理员已关闭上传点歌")
        length_header = self.headers.get("Content-Length")
        try:
            length = int(length_header or "")
        except ValueError as exc:
            raise ApiError(411, "length_required", "缺少 Content-Length") from exc
        if length <= 0:
            raise ApiError(400, "bad_upload", "空文件")
        if length > self.app.config.upload_max_bytes:
            raise ApiError(413, "upload_too_large", "音频文件过大")

        nickname = _clean_text(
            urllib.parse.unquote(self.headers.get("X-Nickname") or ""),
            self.app.config.nickname_max_len,
        ) or "匿名"
        raw_name = urllib.parse.unquote(self.headers.get("X-Filename") or "")
        filename = Path(raw_name or "audio.mp3").name
        suffix = Path(filename).suffix.lower()
        if suffix not in _UPLOAD_EXTENSIONS:
            raise ApiError(
                415,
                "unsupported_audio",
                "只支持 mp3/aac/m4a/ogg/opus/webm/wav/flac",
            )
        title = _clean_text(
            urllib.parse.unquote(self.headers.get("X-Title") or ""),
            120,
        )
        artist = _clean_text(
            urllib.parse.unquote(self.headers.get("X-Artist") or ""),
            80,
        )
        self._check_banned(nickname, title, artist)

        ip_key = self._ip_key()
        uploader_key = f"ip:{ip_key}"
        self.app.listeners.touch(uploader_key)
        precheck = self.app.limiter.precheck_request(ip_key)
        if not precheck.allowed:
            raise ApiError(
                429,
                precheck.reason,
                f"1 分钟内最多点 {self.app.config.request_per_min} 首，请稍后再试",
                retry_after=precheck.retry_after,
            )
        if self.app.db.count_pending() >= self.app.config.queue_max:
            raise ApiError(429, "queue_full", "点歌队列已满，请稍后再试", retry_after=30)

        stored = f"{uuid.uuid4().hex}{suffix}"
        target = self.app.config.uploads_dir / stored
        cover_name = ""
        try:
            # Slow mobile/Tailscale uploads can legitimately exceed the normal
            # request timeout; Nginx uses the same 300s limit for this route.
            try:
                self.connection.settimeout(300)
            except OSError:
                pass
            prefix = self._read_upload_to_file(target, length)
            content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            format_name = detect_audio_format(prefix)
            if format_name is None:
                raise ApiError(415, "unsupported_audio", "无法识别的音频格式")
            if suffix not in _UPLOAD_SUFFIXES.get(format_name, set()):
                raise ApiError(415, "unsupported_audio", "文件扩展名与音频内容不符")
            if self._policy()["mp3_upload_only"] and format_name != "mp3":
                raise ApiError(415, "mp3_only", "管理员只允许上传 MP3")
            metadata = probe_uploaded_audio(
                target,
                ffmpeg_path=self.app.config.ffmpeg_path,
                uploads_dir=self.app.config.uploads_dir,
            )
            cover_name = str(metadata.get("cover_name") or "")
            if metadata.get("title"):
                title = _clean_text(metadata["title"], 120)
            if metadata.get("artist"):
                artist = _clean_text(metadata["artist"], 80)
            album = _clean_text(metadata.get("album") or "本地上传", 80)
            self._check_banned(nickname, title, artist, album)

            try:
                duration_ms = int(metadata.get("duration_ms") or 0)
            except (TypeError, ValueError):
                duration_ms = 0
            if duration_ms <= 0:
                try:
                    duration_ms = int(self.headers.get("X-Duration-Ms") or 0)
                except ValueError:
                    duration_ms = 0
            duration_ms = max(1000, min(12 * 60 * 60 * 1000, duration_ms or 240_000))
            lyrics_lrc = str(metadata.get("lyrics") or "").strip()
            lyrics_translation = ""
            if not lyrics_lrc:
                lookup = getattr(self.app.aggregator, "lookup_lyrics", None)
                if callable(lookup):
                    try:
                        lyrics_lrc, lyrics_translation = lookup(
                            title or Path(filename).stem, artist or nickname
                        )
                    except Exception:
                        logger.exception("online lyrics lookup failed for upload")
            track = {
                "id": uuid.uuid4().hex,
                "source": "upload",
                "source_id": stored,
                "title": title or Path(filename).stem[:120] or "本地音频",
                "artist": artist or nickname,
                "album": album or "本地上传",
                "duration_ms": duration_ms,
                "duration_estimated": duration_ms == 240_000,
                "cover_url": str(metadata.get("cover_url") or ""),
                "lyrics_lrc": lyrics_lrc,
                "lyrics_translation": lyrics_translation,
                "lyrics_fetched_at": now_ms() if lyrics_lrc else None,
                "audio_primary": f"/media/uploads/{stored}",
                "audio_alternates": [],
                "audio_resolved_at": now_ms(),
                "meta_json": {
                    "original_name": filename,
                    "mime": content_type,
                    "format": format_name,
                    "upload": True,
                    "uploader_key": uploader_key,
                    "uploaded_at": now_ms(),
                    "cover_name": cover_name,
                    "embedded_title": bool(metadata.get("title")),
                    "embedded_artist": bool(metadata.get("artist")),
                    "embedded_album": bool(metadata.get("album")),
                },
                "enabled": False,
                "created_at": now_ms(),
            }
            with self.app.request_lock:
                if self.app.db.count_pending() >= self.app.config.queue_max:
                    raise ApiError(429, "queue_full", "点歌队列已满，请稍后再试", retry_after=30)
                decision = self.app.limiter.consume_request(ip_key)
                if not decision.allowed:
                    raise ApiError(
                        429,
                        decision.reason,
                        f"1 分钟内最多点 {self.app.config.request_per_min} 首，请稍后再试",
                        retry_after=decision.retry_after,
                    )
                self.app.db.insert_track(track)
                queue_id = self.app.db.enqueue(track["id"], ip_key, nickname, None)
                self.app.db.add_request_history(ip_key, track["id"], nickname)
        except Exception:
            try:
                target.unlink()
            except OSError:
                pass
            if cover_name:
                try:
                    (self.app.config.uploads_dir / cover_name).unlink(missing_ok=True)
                except OSError:
                    pass
            raise
        logger.info("uploaded request %s by %s: %s", queue_id, nickname, track["title"])
        self._send_json(
            201,
            {
                "ok": True,
                "request_id": queue_id,
                "track": _summary(track),
                "queue": {"pending": self.app.db.count_pending()},
            },
        )

    def _handle_request(self) -> None:
        if not self._policy()["requests_enabled"]:
            raise ApiError(403, "requests_disabled", "管理员已关闭点歌")
        data = self._read_json()
        self._form_guard(data)
        nickname = _clean_text(data.get("nickname"), self.app.config.nickname_max_len) or "匿名"
        candidate_id = str(data.get("candidate_id") or "").strip()
        track_id = str(data.get("track_id") or "").strip()
        query = _clean_text(data.get("query"), 80)
        if not candidate_id and not query and not track_id:
            raise ApiError(400, "missing_query", "请选择一首歌")
        if candidate_id and not re.fullmatch(r"[a-f0-9]{32}", candidate_id):
            raise ApiError(400, "bad_candidate", "无效的搜索结果")
        if track_id and len(track_id) > 64:
            raise ApiError(400, "bad_track", "无效的曲目")
        self._check_banned(nickname)

        ip_key = self._ip_key()
        precheck = self.app.limiter.precheck_request(ip_key)
        if not precheck.allowed:
            raise ApiError(
                429,
                precheck.reason,
                f"1 分钟内最多点 {self.app.config.request_per_min} 首，请稍后再试",
                retry_after=precheck.retry_after,
            )
        if self.app.db.count_pending() >= self.app.config.queue_max:
            raise ApiError(429, "queue_full", "点歌队列已满，请稍后再试", retry_after=30)

        if track_id:
            track = self.app.db.get_track(track_id)
            if track is None:
                raise ApiError(404, "not_found", "历史曲目已不存在")
            # Uploads are temporary one-shot queue items.  Re-requesting one
            # must not put it into the permanent rotation; otherwise cleanup
            # could delete a file that a later playlist turn still needs.
            if track.get("source") != "upload":
                self.app.db.update_track(track_id, {"enabled": True})
        else:
            resolve_decision = self.app.limiter.consume_search(ip_key)
            if not resolve_decision.allowed:
                raise ApiError(
                    429,
                    resolve_decision.reason,
                    "点歌请求过于频繁，请稍后再试",
                    retry_after=resolve_decision.retry_after,
                )

            if candidate_id:
                track = self.app.aggregator.resolve_candidate(candidate_id)
                if track is None:
                    raise ApiError(410, "search_expired", "搜索结果已过期，请重新搜索")
            else:
                track = self.app.aggregator.resolve(query)
                if track is None:
                    raise ApiError(404, "not_found", "没有找到这首歌，换个关键词试试")

        track_summary = _summary(track)
        duplicate_since = now_ms() - self.app.config.duplicate_window_sec * 1000
        with self.app.request_lock:
            if self.app.db.count_pending() >= self.app.config.queue_max:
                raise ApiError(
                    429, "queue_full", "点歌队列已满，请稍后再试", retry_after=30
                )
            if self.app.db.recent_track_in_queue(track["id"], duplicate_since):
                raise ApiError(409, "duplicate", "这首歌已经在队列里了")
            current = self.app.player.snapshot(ensure=False).get("track")
            if current and current.get("id") == track["id"]:
                raise ApiError(409, "duplicate", "这首歌正在播放")

            decision = self.app.limiter.consume_request(ip_key)
            if not decision.allowed:
                raise ApiError(
                    429,
                    decision.reason,
                    f"1 分钟内最多点 {self.app.config.request_per_min} 首，请稍后再试",
                    retry_after=decision.retry_after,
                )

            queue_id = self.app.db.enqueue(track["id"], ip_key, nickname, None)
            self.app.db.add_request_history(ip_key, track["id"], nickname)
        logger.info("queued request %s by %s: %s", queue_id, nickname, track.get("title"))
        self._send_json(
            201,
            {
                "ok": True,
                "request_id": queue_id,
                "track": track_summary,
                "queue": {"pending": self.app.db.count_pending()},
            },
        )

    def _handle_queue_cancel(self) -> None:
        data = self._read_json()
        self._form_guard(data)
        try:
            queue_id = int(data.get("queue_id") or 0)
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "bad_queue", "无效的点歌") from exc
        if queue_id <= 0:
            raise ApiError(400, "bad_queue", "无效的点歌")
        if not self.app.db.cancel_pending(queue_id, self._ip_key()):
            # Deliberately do not reveal whether the request belongs to
            # somebody else, is playing, or no longer exists.
            raise ApiError(404, "not_found", "没有可取消的点歌")
        self._send_json(200, {"ok": True, "queue_id": queue_id})

    def _handle_vote_skip(self) -> None:
        data = self._read_json()
        voter = self._voter_key(data.get("lid") or data.get("voter_id"))
        self.app.listeners.touch(voter)
        now = self.app.player.snapshot(ensure=False)
        if not now.get("track"):
            raise ApiError(409, "no_track", "当前没有播放")
        seq = int(now.get("seq") or 0)
        listeners = self.app.listeners.count()
        result = self.app.votes.vote(seq, voter, listeners)
        switched = False
        if (
            result["added"]
            and result["passed"]
            and self.app.votes.claim_switch(seq)
        ):
            if self.app.player.skip_async("vote", expected_seq=seq):
                now = self.app.player.snapshot()
                self.app.votes.reset(int(now.get("seq") or 0))
                switched = True
            else:
                self.app.votes.release_switch(seq)
        now = self._decorate_snapshot(now, voter)
        self._send_json(
            200,
            {
                "ok": True,
                "switched": switched,
                "vote": now["vote"],
                "now": now,
            },
        )

    def _handle_queue_pin(self) -> None:
        decision = self.app.limiter.consume_pin(self._ip_key())
        if not decision.allowed:
            raise ApiError(
                429,
                decision.reason,
                "置顶操作过于频繁，请稍后再试",
                retry_after=decision.retry_after,
            )
        data = self._read_json()
        try:
            queue_id = int(data.get("queue_id"))
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "bad_queue_id", "无效的队列项") from exc
        voter = self._voter_key(data.get("lid") or data.get("voter_id"))
        result = self.app.db.toggle_queue_pin(queue_id, voter)
        if result is None:
            raise ApiError(404, "queue_not_found", "这首歌已经不在队列里")
        self._send_json(
            200,
            {
                "ok": True,
                "queue_id": queue_id,
                "pins": result["pins"],
                "pinned": result["pinned"],
                "queue": self.app.db.list_queue(50),
            },
        )

    def _handle_report(self) -> None:
        data = self._read_json()
        event = str(data.get("event") or "").strip().lower()
        if event not in _ALLOWED_REPORT_EVENTS:
            raise ApiError(400, "bad_event", "无效的上报事件")
        try:
            seq = int(data.get("seq"))
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "bad_seq", "无效的 seq") from exc
        ip_key = self._ip_key()
        decision = self.app.limiter.consume_report(ip_key)
        if not decision.allowed:
            raise ApiError(
                429,
                decision.reason,
                "上报过于频繁",
                retry_after=decision.retry_after,
            )
        self._send_json(200, self.app.player.report(seq, event))

    def _handle_admin(self, path: str) -> None:
        if path == "/api/admin/skip":
            if not self.app.player.skip_async("admin"):
                raise ApiError(409, "busy", "切歌正在进行，请稍后重试")
            self._send_json(200, {"ok": True, "now": self.app.player.snapshot()})
            return
        if path == "/api/admin/pause":
            self.app.player.pause()
            self._send_json(200, {"ok": True, "now": self.app.player.snapshot()})
            return
        if path == "/api/admin/resume":
            self.app.player.resume()
            self._send_json(200, {"ok": True, "now": self.app.player.snapshot()})
            return
        if path == "/api/admin/policy":
            data = self._read_json()
            try:
                policy = save_policy(self.app.db, data)
            except PolicyError as exc:
                raise ApiError(400, "bad_policy", str(exc)) from exc
            self._send_json(200, {"ok": True, "policy": policy})
            return
        if path == "/api/admin/queue/delete":
            data = self._read_json()
            try:
                queue_id = int(data.get("queue_id"))
            except (TypeError, ValueError) as exc:
                raise ApiError(400, "bad_queue", "无效的队列 ID") from exc
            self.app.db.delete_queue_item(queue_id)
            self._send_json(200, {"ok": True})
            return
        if path == "/api/admin/track/delete":
            data = self._read_json()
            track_id = str(data.get("track_id") or "").strip()
            if not track_id or len(track_id) > 64:
                raise ApiError(400, "bad_track", "无效的曲目")
            current = self.app.player.snapshot(ensure=False).get("track")
            if current and str(current.get("id") or "") == track_id:
                try:
                    self.app.player.skip("admin-delete")
                except Exception:
                    logger.exception("could not skip deleted current track")
            removed = self.app.db.delete_track_admin(track_id)
            if removed is None:
                raise ApiError(404, "not_found", "曲目不存在")
            removed_file = False
            if str(removed.get("source") or "") == "upload":
                name = str(removed.get("source_id") or "")
                if is_safe_upload_name(name):
                    path = self.app.config.uploads_dir / name
                    try:
                        if path.is_file() or path.is_symlink():
                            path.unlink(missing_ok=True)
                            removed_file = True
                    except OSError as exc:
                        logger.warning("could not remove deleted upload %s: %s", name, exc)
                meta = removed.get("meta_json") or {}
                cover_name = str(meta.get("cover_name") or "") if isinstance(meta, dict) else ""
                if is_safe_upload_name(cover_name):
                    cover_path = self.app.config.uploads_dir / cover_name
                    try:
                        cover_path.unlink(missing_ok=True)
                    except OSError as exc:
                        logger.warning("could not remove deleted cover %s: %s", cover_name, exc)
            self._send_json(
                200,
                {"ok": True, "track_id": track_id, "removed_file": removed_file},
            )
            return
        if path == "/api/admin/settings":
            data = self._read_json()
            try:
                values = save_ui_settings(self.app.db, self.app.config, data)
            except SettingsError as exc:
                raise ApiError(400, "bad_settings", str(exc)) from exc
            self._send_json(200, {"ok": True, "settings": admin_settings(values)})
            return
        if path == "/api/admin/track":
            data = self._read_json()
            candidate_id = str(data.get("candidate_id") or "").strip()
            query = _clean_text(data.get("query"), 80)
            playlist_ids = {
                item["id"] for item in self.app.db.list_playlist_summaries()
            }
            if candidate_id:
                track = self.app.aggregator.resolve_candidate(candidate_id)
            elif query:
                track = self.app.aggregator.resolve(query)
            else:
                raise ApiError(400, "missing_query", "请输入歌名或选择搜索结果")
            if track is None:
                raise ApiError(404, "not_found", "没有找到这首歌")
            was_enabled = bool(track.get("enabled"))
            self.app.db.update_track(track["id"], {"enabled": True})
            queued = None
            self.app.player.notify_playlist_changed()
            with self.app.request_lock:
                current = self.app.player.snapshot(ensure=False).get("track")
                is_current = bool(current and current.get("id") == track["id"])
                already_pending = self.app.db.recent_track_in_queue(
                    track["id"],
                    now_ms() - self.app.config.duplicate_window_sec * 1000,
                )
                if (
                    not is_current
                    and not already_pending
                    and (track["id"] in playlist_ids or not was_enabled)
                    and self.app.db.count_pending() < self.app.config.queue_max
                ):
                    queued = self.app.db.enqueue(
                        track["id"], "admin", "admin", None
                    )
            self._send_json(
                201, {"ok": True, "track": _summary(track), "queued": queued}
            )
            return
        if path == "/api/admin/clear-queue":
            cleared = self.app.db.clear_pending()
            self._send_json(200, {"ok": True, "cleared": cleared})
            return
        if path == "/api/admin/hide-message":
            data = self._read_json()
            try:
                message_id = int(data.get("id"))
            except (TypeError, ValueError) as exc:
                raise ApiError(400, "bad_id", "无效的留言 ID") from exc
            self.app.db.hide_message(message_id)
            self._send_json(200, {"ok": True})
            return
        if path == "/api/admin/background":
            self._handle_background_upload()
            return
        if path == "/api/admin/background/url":
            data = self._read_json()
            try:
                add_background_url(self.app.db, data.get("url"))
            except SettingsError as exc:
                raise ApiError(400, "bad_background_url", str(exc)) from exc
            self._send_json(
                200, {"ok": True, "backgrounds": self._backgrounds()}
            )
            return
        if path == "/api/admin/background/url/delete":
            data = self._read_json()
            remove_background_url(self.app.db, data.get("url"))
            self._send_json(
                200, {"ok": True, "backgrounds": self._backgrounds()}
            )
            return
        if path == "/api/admin/background/delete":
            data = self._read_json()
            name = str(data.get("name") or "").strip()
            if not _BACKGROUND_NAME.match(name):
                raise ApiError(400, "bad_name", "无效的背景文件")
            target = self.app.config.backgrounds_dir / name
            if not target.is_file():
                raise ApiError(404, "not_found", "背景不存在")
            try:
                target.unlink()
            except OSError as exc:
                raise ApiError(500, "delete_failed", "删除失败") from exc
            self._send_json(200, {"ok": True})
            return
        raise ApiError(404, "not_found", "管理路径不存在")

    def _handle_background_upload(self) -> None:
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type and content_type not in _IMAGE_TYPES:
            raise ApiError(415, "unsupported_media_type", "只支持 JPG/PNG/WEBP")
        data = self._read_raw(self.app.config.background_max_bytes)
        extension = _image_extension(data)
        if extension is None:
            raise ApiError(400, "bad_image", "不是有效的图片文件")
        name = f"{uuid.uuid4().hex}.{extension}"
        target = self.app.config.backgrounds_dir / name
        try:
            target.write_bytes(data)
        except OSError as exc:
            raise ApiError(500, "write_failed", "保存失败") from exc
        self._send_json(
            201,
            {
                "ok": True,
                "background": {
                    "name": name,
                    "url": f"/backgrounds/{name}",
                },
            },
        )


def make_server(app: RadioApp, host: str | None = None, port: int | None = None) -> RadioServer:
    bind_host = host if host is not None else app.config.host
    bind_port = port if port is not None else app.config.port
    return RadioServer((bind_host, int(bind_port)), app)
