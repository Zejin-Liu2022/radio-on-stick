# Radio on Stick

运行在小内存 Debian 设备上的轻量 web 电台。服务器是唯一音频源：服务器从第三方音频链接取流，两个种子设备经 HTTP 取块，再通过 WebRTC DataChannel 网状转发给其他听众；浏览器不会直连第三方音频地址。所有音频默认由 ffmpeg 转为低码率 MP3 再分发（`RADIO_TRANSCODE_MP3=0` 可让 MP3 直通），不使用 Icecast/Liquidsoap/Docker。第三方音频不落盘；用户主动上传的本地音频临时保存在 `data/uploads/`（可随时清空），这是唯一的音频存储例外。

## 功能

- Python 标准库 + SQLite（WAL），无 pip 依赖；转码使用系统 ffmpeg
- 网易云 / TXQQ / meting 字段聚合，搜索源可扩展
- 播放列表顺序播放，队列优先，播完即停，不循环
- `/now.json` 伪同步：封面、时长、进度、歌词
- 音频经 `/source` 共享会话 + 浏览器 DataChannel 网状分发；服务器只读上游字节，第三方音频不落盘
- 支持 MP3 / AAC(ADTS) / M4A / OGG / Opus / WebM / WAV / FLAC；MSE 不支持该容器时自动退回浏览器原生 `<audio>` 直连
- 没有 WebRTC 的浏览器自动使用 HTTP 直连叶子（仍从 `/source` 共享流读取，不伪装成 P2P 子节点）
- 两个种子设备双活；子节点最多 2 个上游、每个节点最多 4 个下游；`(stream_id, seq)` 去重
- 音频帧带媒体时间戳和服务端时间戳，设备用本地时钟偏移做近似同步；保留约 1.6-3 秒提前量
- 音频转发先于 MSE 解析：中继节点原样转发帧，再交给 `<audio>` 播放
- 所有音频默认由服务器 ffmpeg 转成低码率 MP3 后走网状/MSE；转码失败才用服务器 `/native` 兜底；`RADIO_TRANSCODE_MP3=0` 可让 MP3 直通
- 点歌与留言分离；搜索结果/历史行右侧直接 + 点歌，也支持上传本地音频点歌（最大 64MB）
- 点歌历史由服务器全局维护；重复点歌只保留最新一条；待播放/历史记录可切换并重新点歌
- 昵称保存在浏览器 localStorage
- 一起听人数、50% 切歌投票、队列置顶
- 留言区独立为第二页：上滑/滚轮或聊天键进入，发送键固定在底部，列表上下滑动并带上下虚化；默认保留最近 200 条、显示最近 100 条
- 移动端后台降低轮询频率；支持 Media Session，在系统状态栏/锁屏显示当前曲目
- `/admin` 独立管理页：切歌、暂停/恢复、进度、队列、页面文字、背景上传与轮换
- 竖屏：封面—歌名/歌手/专辑—当前句歌词；点封面切到完整歌词，再点歌词区恢复
- 横屏：左侧大封面与曲目信息，右侧完整歌词；播放控件横竖屏逻辑一致
- 控件无边框，使用虚化/加深分层；按钮优先图标，曲目行右侧直接 +/X/图钉
- 播放控件固定底部：左聊天、中播列表/播放/切歌、右音量；进度条贯穿屏幕且无圆角
- 点歌/待播放/历史收进二级抽屉：竖屏底部弹出，横屏左侧弹出，搜索在抽屉顶部
- 当前播放封面自动虚化为背景；没有封面时使用管理员背景/轮换图
- 主题默认跟随系统，顶部按钮可手动切换深浅色；播放控件在两种主题下保持深色高对比
- 直连模式下客户端提前预载下一首；网状模式下停用直连预载，减少第三方和服务器压力
- 歌词跟随实际播放进度，不再强行对齐服务器
- Nginx 提供 HTTP/HTTPS（自签名证书，可替换）
- PWA 清单与 Service Worker，为打包 WebView/Tauri/Capacitor/BeeWare APP 预留；客户端默认可作为 WebRTC 中继/种子；详见 `docs/APP.md`
- 公网开放检查清单见 `docs/PUBLIC.md`
- 产品架构、统一加入入口与邀请码协议见 `docs/ARCHITECTURE.md`、`docs/JOIN_PROTOCOL.md`
- 插件协议（本地库/开放平台/商业平台）见 `docs/PLUGIN_PROTOCOL.md`
- NAT 后电台的统一入口 Relay 协议见 `docs/RELAY_PROTOCOL.md`
- 协议 JSON 示例见 `protocol/v1/`
- 校园网络、证书、隧道等私人部署说明见 `docs/PRIVATE_CONFIG.md`
- `/admin` 复用客户端完整播放/歌词/聊天/点歌布局，并额外提供任意曲目删除、MP3 策略、最大听众/功能开关和留言管理；网络 IP 准入统一由 Nginx 白名单负责
- 网络准入参考 [Pigman02/radio-on-stick](https://github.com/Pigman02/radio-on-stick)：Nginx 白名单放行本机、Tailscale 和 RFC1918 私网；白名单文件独立保存，升级不覆盖

## 快速开始

Python 3.11+，不需要安装 pip 包。

```powershell
cd radio-on-stick
$env:RADIO_ADMIN_TOKEN = "dev-token"
$env:RADIO_IP_SALT = "dev-salt"
python -m app
```

```bash
# Linux / macOS
RADIO_ADMIN_TOKEN=dev-token RADIO_IP_SALT=dev-salt python3 -m app
```

首次运行或部署前可以自动检测/安装 ffmpeg：

```bash
python3 deploy/ensure_ffmpeg.py --check
# Linux 需要 root；macOS 通常用当前用户
sudo python3 deploy/ensure_ffmpeg.py --install
```

脚本支持 Debian/Ubuntu（apt）、Fedora/RHEL（dnf/yum）、Arch（pacman）、Alpine（apk）、openSUSE（zypper）、macOS（Homebrew/MacPorts）以及 Windows（winget/Chocolatey/Scoop）。`/healthz` 也会返回 ffmpeg 是否可用；服务启动日志会提示缺失。

打开 <http://127.0.0.1:8080>，管理页 <http://127.0.0.1:8080/admin>。

首次进入设置昵称；点歌先搜索再确认。也可以直接用 CLI：

```bash
python tools/radioctl.py --token dev-token add "Iron Lotus Mili"
python tools/radioctl.py now
```

## 音频网状传输

```text
第三方音频 URL
      │  /source/manifest + /source/chunk（只读字节，内存环形缓冲）
      ▼
  Python 服务 ── WebSocket /ws（只传 SDP/ICE/拓扑）
      │
   ┌──┴──┐
  种子 A  种子 B        ← 1 个用户时 1 个种子；2 个及以上用户固定 2 个种子
   │  ╲  │
  子节点  子节点  ...     ← 每个子节点最多 2 个父节点，每个节点最多 4 个下游
```

- `/source/manifest` 以 `(seq, track id, audio_rev, audio URL)` 为键复用会话；两个种子拿到同一个 `stream_id` 和最新块号。
- `/source/chunk` 返回 40 字节头 + 原始音频字节：`magic/stream_id/seq/payload_len/start_ms/duration_ms/server_ms/fnv1a/format`（RAD4，大端；format 1=MP3、2=AAC、3=M4A、4=OGG、5=WebM、6=WAV、7=FLAC）。MP3 切在完整帧边界；其他容器按字节和估算时间戳切块，绝不重新编码。
- 每个节点收到 DataChannel 帧后，先按 `(stream_id, seq)` 去重，再把**原始字节**转发给下游，最后才把音频字节追加到 MediaSource。
- 双父节点同时到达时，重复帧只计数、丢弃；缺块只记录，不重排。节点断开时服务端自动重挂父/子，种子失效时提升一个子节点。
- 稳定拓扑中每个用户要么是服务器直连种子，要么同时拥有 **2 个**中继父节点；只有父节点切换的短窗口允许保留 1 个父节点。9 秒内仍凑不齐 2 个父节点时，客户端转为 HTTP 直连叶子，避免长期只有单中继。
- 服务器直连种子最多 2 个。新节点显式请求种子角色（`?role=seed`）且两个种子槽已满时，会优先替换一个已有种子；被替换的节点降为子节点并保留自己的下游，但仍补齐双父。
- 不能中继的接收端可用 `?role=leaf` 或 `?relay=0` 标记；服务端不会把它选为种子或父节点，只会把它放在叶子并分配父节点。
- 客户端用帧里的 `server_ms` 与本地时钟的偏移估算服务端时间，配合约 1.6 秒的启动提前量和 3 秒左右的缓冲追赶直播进度；保留双父去重和缺块诊断。
- `/mesh.json` 是只读拓扑诊断接口，不包含音频内容。

网状传输是可选增强：`MediaSource` 不支持当前容器、WebSocket/DataChannel 失败或 9 秒内没有可用父节点时，播放器会自动回到 HTTP 直连叶子或服务器 `/native/<track_id>` 原生流；第三方音频 URL 不进入浏览器。原有 API 路径和字段不变。浏览器没有 `RTCPeerConnection` 时不会成为真正的 DataChannel 子节点，而是显示 `HTTP 直连 · 无 WebRTC`。这条路径由服务器直接把 `/source` 块发给该浏览器，不占用 P2P 上行，但仍消耗服务器出口带宽；它保证可用性，不等同于网状节点。

## 带宽有限时

- **所有音频都由服务器取得并转发**：第三方音频不暴露给浏览器。所有输入默认先由服务器 ffmpeg 转成低码率 MP3，再走同一 `/source`/网状链路；转码失败才用服务器 `/native` 原生流兜底。`RADIO_TRANSCODE_MP3=0` 可节省 MP3 的 CPU，但服务器出口保持原码率。
- 无 WebRTC 的 HTTP 叶子通过 `RADIO_HTTP_LEAF_MAX` 限制同时活跃的客户端 IP 数（默认 4）；设为 `0` 可关闭叶子。叶子租约默认 20 秒，`RADIO_HTTP_LEAF_TTL` 可调。
- 上传文件无论走 `/source` 还是 `/native`/`/media`，服务器都要发送字节；带宽很紧时优先降低 `RADIO_UPLOAD_MAX_BYTES`，少用上传，或用 Nginx 对 `/source/`、`/media/uploads/` 设置 `limit_rate`/`limit_conn`（按连接限速，需结合总带宽评估）。
- 服务器上行受限时，转码到低码率 MP3 降低每个种子/叶子的出口；代价是当前曲目一个 ffmpeg 进程。MP3 是否重编码由 `RADIO_TRANSCODE_MP3` 控制；弱 CPU 可降低码率或关闭 MP3 重编码。

## 配置

配置通过环境变量。最少设置：

```bash
RADIO_ADMIN_TOKEN=你的管理token
RADIO_IP_SALT=随机字符串
```

页面文字、背景和轮换间隔可在 `/admin` 覆盖。完整示例见 `deploy/radio.env.example`，默认值见 `app/config.py`。

## 行为

- 点歌提交服务端生成的 `candidate_id`，不信任客户端音频 URL。
- 播放列表播完后进入待机；再次添加新曲目会继续播放。
- 播放优先使用网状音频；`/source` 不支持、WebRTC 失败或没有父节点时自动退回 HTTP 叶子；不会直连第三方。
- 所有音频默认由服务器 ffmpeg 转成 MP3 后走 MSE/网状；`RADIO_TRANSCODE_MP3=0` 时 MP3 直通；转码失败才用 `/native` 服务器原生流。

- 种子设备从 `/source` 取共享会话的块，所以两个种子看到完全相同的 `stream_id`、`seq`、字节和时间戳；服务器对同一条流只打开一个上游连接。
- 直连模式下播放器会在当前曲目剩余约 45 秒时预载下一首；网状模式下停用该预载。
- 歌词高亮和进度条使用本地 `audio.currentTime`，音画以实际播放为准。
- 一起听人数按唯一 IP 统计；投票达到在线人数 50% 自动切歌。
- 队列置顶每人每首一次，顶数越多越靠前。
- 待播放的点歌会显示“取消”按钮，只有本人可以取消；别人的请求和正在播放的曲目不能通过该接口取消。
- 新增音源：实现 `name`、`display_name`、`search(keyword, limit)`，再调用 `aggregator.register_source(...)`。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/now.json` | 当前曲目、进度、音频、下一首、队列、投票 |
| GET | `/api/config` | 页面文字、背景、轮换间隔 |
| GET | `/api/state` | 状态 + 队列 + 留言 + 点歌历史 |
| GET | `/api/search?q=` | 搜索候选 |
| GET | `/api/lyrics/<track_id>` | 歌词与翻译 |
| GET | `/api/messages` | 最近留言 |
| POST | `/api/messages` | 发送留言 |
| POST | `/api/request` | 点歌（`candidate_id`、`query` 或历史 `track_id`） |
| POST | `/api/vote-skip` | 投票切歌 |
| POST | `/api/queue/pin` | 队列置顶 |
| POST | `/api/queue/cancel` | 取消自己尚未播放的点歌（不能取消别人的） |
| POST | `/api/report` | `ended` / `error` / `stalled` 上报 |
| POST | `/api/upload` | 上传本地音频并加入点歌队列（≤64MB，仅白名单扩展名） |
| GET | `/media/uploads/<id>` | 读取上传音频，支持 `Range` |
| GET | `/native/<track_id>` | 服务器原生音频兜底：当前/下一首，支持 `Range` 转发 |
| GET | `/source/manifest?seq=` | 当前音频流的共享会话、格式和块范围 |
| GET | `/source/chunk?stream_id=&seq=` | 一个带时间戳和格式码的完整音频帧 |
| GET | `/ws` | WebRTC 信令/拓扑控制（RFC6455） |
| GET | `/mesh.json` | 只读网状拓扑诊断 |
| GET | `/healthz` | 健康检查 |
| GET | `/api/admin/state` | 管理状态 |
| GET | `/api/admin/queue` | 管理队列 |
| POST | `/api/admin/skip` | 切歌 |
| POST | `/api/admin/pause` | 暂停 |
| POST | `/api/admin/resume` | 恢复 |
| POST | `/api/admin/track` | 加入播放列表 |
| POST | `/api/admin/clear-queue` | 清空队列 |
| POST | `/api/admin/settings` | 修改页面文字 |
| POST | `/api/admin/hide-message` | 隐藏留言 |
| POST | `/api/admin/background` | 上传背景 |
| POST | `/api/admin/background/delete` | 删除本地上传背景 |
| POST | `/api/admin/background/url` | 添加网络图床背景 |
| POST | `/api/admin/background/url/delete` | 删除网络背景 |

上传接口使用原始请求体，不解析 multipart；文件名、昵称、标题和时长分别放在
`X-Filename`、`X-Nickname`、`X-Title`、`X-Duration-Ms` 头（文件名/昵称/标题用
`encodeURIComponent` 编码）。服务端按扩展名白名单和文件魔数双重校验，保存到
`data/uploads/` 后创建 `source=upload` 曲目并加入队列；播放时由 ffmpeg 转成低码率 MP3（`RADIO_TRANSCODE_MP3=0` 时 MP3 直通），原始文件不被覆盖。上传者身份只保存为加盐哈希；一次性上传不会因历史重新点歌而加入永久轮播。

清理策略：

- 曲目已经结束、上传者超过 listener TTL 未再出现，再等 `RADIO_UPLOAD_OFFLINE_GRACE_SEC`（默认 60 秒）后清理；
- 任何上传超过 `RADIO_UPLOAD_RETENTION_SEC`（默认 86400 秒）后清理，包括未被播放的遗漏文件；
- 正在播放的曲目、当前播放文件和排队中的曲目不会被普通清理删除；硬保留期到期时可以删除仍在排队但未播放的项；
- 清理会同时删除曲目的点歌历史；每 `RADIO_UPLOAD_CLEANUP_INTERVAL` 秒检查一次，启动时也会检查。

管理接口需要 `Authorization: Bearer <RADIO_ADMIN_TOKEN>`。

## 结构

```text
app/            # 服务端与前端资源
deploy/         # Nginx、systemd、安装、TLS、打包
docs/           # 路线图
tests/          # unittest 与可选浏览器 E2E
tools/          # radioctl CLI
.github/        # GitHub Actions
AGENTS.md       # 后续开发约定
data/           # 运行时数据（gitignore）
```

## 测试

```bash
python -m unittest discover -s tests -t . -v
```

非 MP3/上传转码测试需要系统 `ffmpeg`。可选的真实浏览器端到端测试（需要 Node 22+、Chrome 和 ffmpeg，不依赖 npm 包）：

```bash
python3 tests/e2e/server.py --port 8795
# 另一个终端
node tests/e2e/mesh.js
node tests/e2e/http_leaf.js
```

`mesh.js` 打开独立 Chrome 进程验证双种子、双父节点、去重、时间同步，以及种子掉线后的提升和继续播放；`http_leaf.js` 在页面加载前删除 `RTCPeerConnection`，验证无 WebRTC 时以 `HTTP 直连 · 无 WebRTC` 正常使用 `/source` 播放，而不是伪装成 P2P 子节点；音频在上传/播放时会经过服务器 ffmpeg 转成 MP3；转码失败时脚本接受服务器 `/native` 兜底。服务端拓扑测试还覆盖双父、显式种子替换、不可中继叶子，以及父节点切换时保留存活父节点。

## 部署

```bash
bash deploy/package.sh
# 目标机
tar -xzf radio-on-stick-*.tar.gz
cd radio-on-stick-*
sudo bash deploy/install.sh
```

安装脚本会安装 Nginx、创建 `radio` 用户、部署到 `/opt/radio-on-stick`、数据放 `/var/lib/radio-on-stick`，生成自签名 TLS 证书并启动 systemd 服务。详细说明见 `deploy/README.md`。

- HTTP：`http://<设备IP>/`
- HTTPS：`https://<设备IP>/`（自签名，首次需手动信任）
- 替换 `/etc/radio-on-stick/tls/fullchain.pem` 和 `privkey.pem` 后执行 `sudo systemctl reload nginx` 即可换成正式证书。

## 说明

- 音频链接来自第三方，时效和可用性不受本项目控制。
- 第三方音频不落盘；`/source` 只在内存里保留最近约 20 个块（约 1MB 上限），进程退出即消失。本地上传是显式例外，存放于 `data/uploads/`，会按播放结束 + 上传者离线或硬保留期自动清理，不会提交到 git。
- 所有音频默认用 ffmpeg 转成低码率 MP3，再按 MP3 帧切块分发；`RADIO_TRANSCODE_MP3=0` 可关闭 MP3 重编码；转码失败才由 HTTP 叶子或 `/native` 兜底。
- WebRTC 在私网/Tailscale 内通常可直接建立；跨公网时设置 `RADIO_MESH_STUN`（例如 `stun:stun.l.google.com:19302`），否则可能在 9 秒后转为 HTTP 叶子。
- 第三方音源请自行确认合规性。
