from __future__ import annotations

import threading
from dataclasses import dataclass

from .community import ListenerTracker, VoteTracker
from .config import Config
from .db import Database
from .directory import DirectoryClient
from .player import Player
from .ratelimit import RateLimiter
from .sources.aggregate import TrackAggregator
from .sources.meting import MetingSource
from .sources.netease import NeteaseSource
from .sources.qq import QQSource
from .upstream import HttpClient


@dataclass
class RadioApp:
    config: Config
    db: Database
    http: HttpClient
    netease: NeteaseSource
    qq: QQSource
    meting: MetingSource
    aggregator: TrackAggregator
    limiter: RateLimiter
    player: Player
    listeners: ListenerTracker
    votes: VoteTracker
    request_lock: threading.Lock
    directory: DirectoryClient | None = None


def build_app(
    config: Config | None = None,
    *,
    http: HttpClient | None = None,
    aggregator: TrackAggregator | None = None,
) -> RadioApp:
    config = config or Config.from_env()
    config.ensure_dirs()
    db = Database(config.db_path)
    db.cleanup_history()
    db.cleanup_old_data()
    db.trim_messages(config.message_keep_limit)
    http = http or HttpClient(
        timeout=config.upstream_timeout,
        retries=config.upstream_retries,
        user_agent=config.user_agent,
    )
    netease = NeteaseSource(http, config.netease_search_url, config.netease_lyric_url)
    qq = QQSource(http, config.qq_search_url)
    meting = MetingSource(http, config.meting_base_url)
    aggregator = aggregator or TrackAggregator(db, config, netease, qq, meting)
    limiter = RateLimiter(db, config)
    player = Player(db, aggregator, config)
    directory = DirectoryClient(config, db)
    app = RadioApp(
        config=config,
        db=db,
        http=http,
        netease=netease,
        qq=qq,
        meting=meting,
        aggregator=aggregator,
        limiter=limiter,
        player=player,
        listeners=ListenerTracker(config.listener_ttl_sec),
        votes=VoteTracker(),
        request_lock=threading.Lock(),
        directory=directory,
    )
    directory.start()
    return app
