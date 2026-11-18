# Radio Join Protocol v1

状态：草案
协议版本：`radio-join/1`
适用范围：Station、Directory、Web Listener、Join App

## 1. 设计原则

1. **统一入口只负责解析，不默认代理音频。**
2. **邀请码是加入能力，不是管理员凭证。**
3. **管理员 token 不经过 Directory。**
4. **网页端只能加入，不能创建电台。**
5. **P2P 配置由 Station 下发，Directory 不参与媒体转发。**
6. **没有 Directory 时，仍可使用直接邀请链接加入可达电台。**

## 2. 地址

### 2.1 统一入口

```text
https://join.radio.example/
```

`join.radio.example` 是协议占位地址。正式部署可以替换为任何公共 Directory。

### 2.2 邀请链接

```text
https://join.radio.example/j#<CODE>
```

邀请码放在 URL fragment，不会发送给 HTTP 服务器，也不会出现在常规访问日志和 Referer 中。

前端读取 fragment 后，通过 POST body 发送给 Directory：

```http
POST /v1/resolve
Content-Type: application/json

{"code": "7K4M9Q2XJ8R5T3WA"}
```

### 2.3 QR

QR 内容：

```text
https://join.radio.example/j#<CODE>
```

APP 也可以只显示 CODE。

### 2.4 直接邀请链接

Station 可以生成不经过 Directory 的链接：

```text
https://station.example/join#<CODE>
```

这种链接只对可达 Station 有效，不提供“任意网络统一入口”。

## 3. 电台身份

```json
{
  "station_id": "st_7f5c2c1e",
  "name": "猫娘电台",
  "public_key": "ed25519:base64url...",
  "created_at": "2026-11-18T00:00:00Z"
}
```

- `station_id` 是稳定标识，不等于地址。
- `public_key` 用于 Station descriptor 签名。
- 私钥只保存在 Station 本地数据目录。
- owner 可以导出恢复密钥。

## 4. 邀请码

### 4.1 字符集

Crockford Base32：

```text
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

归一化：

- 转大写
- 去空格
- 去 `-`
- `I`/`L` 转 `1`
- `O` 转 `0`
- `U` 转 `V`

### 4.2 格式

推荐 16 位：

```text
7K4M9Q2XJ8R5T3WA
```

正则：

```regex
^[0-9A-HJKMNP-TV-Z]{16}$
```

16 位约 80 bit，配合服务端限速足够。

### 4.3 存储

- 统一计算：

```text
code_hash = SHA-256("radio-invite/1:" + normalized_code)
```

- Station 本地只保存 `code_hash`。
- Directory 只保存同样的 `code_hash`，不保存明文。
- 不使用站点私有 pepper，否则 Directory 无法在不知道站点的情况下按邀请码反查。
- 16 位 Base32 邀请码约 80 bit，配合限速足以抵抗枚举。
- 日志不记录明文邀请码。
- 支持：

```text
expires_at
max_uses
used_count
revoked_at
role = listener
```

### 4.4 限制

- 邀请码不能授予 `owner`/`admin`。
- 管理员加入必须使用 admin token 或独立的 admin invite。
- Directory 解析失败要限速。
- Station 加入失败也要限速。

## 5. Station descriptor

Station 对外发布：

```json
{
  "protocol": "radio-station/1",
  "station_id": "st_7f5c2c1e",
  "name": "猫娘电台",
  "public_key": "ed25519:base64url...",
  "description": "",
  "capabilities": [
    "join",
    "mesh",
    "p2p",
    "local-library",
    "plugins"
  ],
  "connectivity": ["direct"],
  "endpoints": [
    {
      "kind": "direct",
      "url": "https://station.example"
    }
  ],
  "issued_at": "2026-11-18T00:00:00Z",
  "signature": "ed25519:base64url..."
}
```

签名覆盖除 `signature` 外的规范化 JSON。客户端必须验证签名。

### 5.1 connectivity

```text
direct  客户端直连 endpoint
relay   客户端必须经 Relay
both    优先 direct，失败后 relay
```

## 6. Directory API

Base：

```text
https://join.radio.example/v1
```

### 6.1 注册

```http
POST /v1/stations
Content-Type: application/json

{
  "station": { ...Station descriptor... },
  "invite_hashes": [
    "sha256:base64url...",
    "sha256:base64url..."
  ],
  "directory_token": "optional"
}
```

响应：

```json
{
  "ok": true,
  "station_id": "st_7f5c2c1e",
  "registered_at": "2026-11-18T00:00:00Z"
}
```

要求：

- Station descriptor 签名有效
- `directory_token` 可由公共 Directory 签发，也可以要求账号
- 注册限速
- 不允许 Directory 返回明文邀请码
- 一个 Station 可注册多个 `invite_hash`

### 6.2 心跳

```http
POST /v1/stations/st_7f5c2c1e/heartbeat
Content-Type: application/json

{
  "endpoints": [
    {"kind": "direct", "url": "https://station.example"}
  ],
  "connectivity": ["direct"],
  "expires_at": "2026-11-18T00:05:00Z",
  "signature": "ed25519:base64url..."
}
```

心跳失败超过 TTL，Directory 将 Station 标记为不可用。

### 6.3 解析邀请码

```http
POST /v1/resolve
Content-Type: application/json

{"code": "7K4M9Q2XJ8R5T3WA"}
```

响应：

```json
{
  "protocol": "radio-directory/1",
  "station": { ...Station descriptor... },
  "join": {
    "url": "https://station.example/api/v1/join",
    "relay_url": null,
    "relay_ticket": null
  },
  "expires_at": "2026-11-18T00:05:00Z"
}
```

错误：

```json
{"error": "invalid_code", "message": "邀请码无效"}
```

- Directory 收到 code 后先归一化，再计算 `code_hash`，按哈希查找 Station。
- 不返回所有电台列表。
- 同一个邀请码只返回对应 Station。
- 多次失败进行 IP/设备限速。
- 不记录明文 code。

### 6.4 健康检查

```http
GET /v1/health
```

```json
{"ok": true, "protocol": "radio-directory/1"}
```

## 7. Station API

Base：

```text
https://station.example/api/v1
```

### 7.1 descriptor

```http
GET /.well-known/radio-station
```

返回 Station descriptor。

### 7.2 加入

```http
POST /api/v1/join
Content-Type: application/json

{
  "code": "7K4M9Q2XJ8R5T3WA",
  "client": {
    "platform": "web",
    "name": "Chrome",
    "p2p": true
  }
}
```

响应：

```json
{
  "protocol": "radio-join/1",
  "session": "base64url...",
  "role": "listener",
  "station": { ...Station descriptor... },
  "expires_at": "2026-11-19T00:00:00Z",
  "mesh": {
    "enabled": true,
    "ws_url": "/ws",
    "manifest_url": "/source/manifest",
    "chunk_url": "/source/chunk",
    "stun": ["stun:stun.example.org:3478"]
  }
}
```

- `session` 是短期 listener token。
- `session` 不能用于管理 API。
- Station 必须自己校验邀请码哈希和用量。
- 不信任 Directory 的“已校验”声明。

### 7.3 管理员登录

```http
POST /api/v1/admin/login
Content-Type: application/json

{"token": "..."}
```

响应：

```json
{
  "role": "admin",
  "session": "base64url...",
  "expires_at": "2026-11-18T02:00:00Z"
}
```

- 管理员 token 不经过 Directory。
- 登录失败限速。
- 支持 session 轮换。
- 本机 loopback 可以保留恢复入口。

### 7.4 邀请码管理

Admin only：

```text
POST /api/v1/admin/invites
GET  /api/v1/admin/invites
POST /api/v1/admin/invites/{id}/revoke
```

创建时只在响应中返回一次明文 code：

```json
{
  "id": "inv_...",
  "code": "7K4M9Q2XJ8R5T3WA",
  "role": "listener",
  "expires_at": "2026-11-25T00:00:00Z",
  "max_uses": 50
}
```

数据库只存哈希。

## 8. 加入时序

### 8.1 Direct

```text
Web/App
  -> POST join.radio.example/v1/resolve {code}
  <- station descriptor + join.url
  -> GET station/.well-known/radio-station
  -> POST station/api/v1/join {code}
  <- session + mesh
  -> WebSocket /ws + /source
  -> P2P
```

### 8.2 Relay

```text
Station
  -> WSS join.radio.example/v1/relay/station
  <- relay room ticket

Web/App
  -> resolve
  <- connectivity=relay, relay_url, room ticket
  -> WSS relay/client
  -> relayed HTTP/WS
  -> P2P 仍可协商
```

Relay 只解决可达性，不强制替代 P2P。

### 8.3 LAN fallback

Directory 不可达时：

- APP 可用 mDNS 发现 `_radio-on-stick._tcp.local`
- 用户输入邀请码
- 直接访问 Station endpoint
- 网页只能使用直接邀请链接

mDNS TXT 不包含邀请码。

## 9. 错误码

| code | HTTP | 含义 |
|---|---:|---|
| `invalid_code` | 404/400 | 邀请码无效或已过期 |
| `code_expired` | 410 | 邀请码过期 |
| `code_exhausted` | 410 | 邀请码次数用尽 |
| `station_unavailable` | 503 | 电台离线 |
| `station_unreachable` | 502 | Directory 无法确认可达性 |
| `join_rate_limited` | 429 | 加入尝试过多 |
| `admin_rate_limited` | 429 | 管理员登录过多 |
| `invalid_session` | 401 | session 失效 |
| `protocol_unsupported` | 400 | 协议版本不支持 |
| `relay_required` | 409 | 需要 Relay 加入 |

## 10. 版本协商

请求头：

```http
Accept-Version: radio-join/1
```

响应：

```http
Radio-Protocol: radio-join/1
```

不支持时：

```json
{"error": "protocol_unsupported"}
```

## 11. 安全要求

- 所有非 loopback 连接必须 HTTPS/WSS。
- 邀请码高熵、可撤销、可轮换。
- 邀请码只存哈希。
- 管理 token 不进 Directory、不进邀请码、不进 URL。
- Directory 返回的 Station descriptor 必须验签。
- Station 必须自行校验邀请码，不信任 Directory。
- 登录/加入限速。
- session 短期有效。
- 不在日志中记录邀请码和管理 token。
- Relay 必须使用短期 room ticket，不能使用长期密钥。
- 公网管理端建议额外启用 Cloudflare Access 或等价访问控制。

## 12. 隐私

- Directory 不提供公开电台列表。
- 只有持有邀请码才能解析 Station。
- Directory 只保存：

```text
station_id
public_key
endpoint
connectivity
invite_hash
created_at
last_seen_at
```

- 不保存 nickname、留言、播放历史、音频。
- Directory 运营方需要明确日志保留策略。

## 13. 兼容性

v1 必须保留：

- `/source/manifest`
- `/source/chunk`
- `/ws`
- `/native/<track_id>`
- `/mesh.json`

新增加入协议不能破坏现有网页播放器和 P2P。

## 14. 协议文件

```text
protocol/v1/station.json
protocol/v1/directory-resolve.request.json
protocol/v1/directory-resolve.response.json
protocol/v1/join.request.json
protocol/v1/join.response.json
protocol/v1/register.request.json
protocol/v1/plugin-manifest.json
```
