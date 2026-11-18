# Radio Relay Protocol v1

状态：草案
协议版本：`radio-relay/1`
目标：让没有公网入口、无法端口映射、位于 NAT/防火墙后的 Station 仍可通过统一入口加入。

## 1. 角色

```text
Station      主动向 Relay 建立出站 WSS
Relay        公共可达的 HTTPS/WSS 服务
Client       Web/App listener
Directory    解析邀请码，返回 relay room
```

## 2. 原则

- Station 不需要公网入站。
- Station 只建立**出站** WSS。
- Relay 不保存音频、消息或曲目。
- Relay 是可达性兜底，不替代 P2P。
- Relay 使用短期 room ticket。
- 所有连接必须 WSS/TLS。

## 3. 创建 room

Station 调用 Directory：

```http
POST /v1/relay/rooms
Content-Type: application/json

{
  "station_id": "st_7f5c2c1e",
  "public_key": "ed25519:base64url...",
  "signature": "ed25519:base64url..."
}
```

响应：

```json
{
  "protocol": "radio-relay/1",
  "room_id": "rm_01J...",
  "station_token": "short-lived...",
  "station_ws": "wss://join.radio.example/v1/relay/station?room=rm_01J...",
  "client_ws": "wss://join.radio.example/v1/relay/client?room=rm_01J...",
  "public_url": "https://join.radio.example/r/rm_01J.../",
  "expires_at": "2026-11-18T01:00:00Z"
}
```

- `station_token` 只用于 Station 到 Relay 的 WSS。
- `client_ws` 需要另外的 client ticket。
- `public_url` 是 Web listener 的统一入口路径。

## 4. Station 隧道

Station 建立：

```text
WSS wss://join.radio.example/v1/relay/station?room=...
Authorization: Bearer <station_token>
```

WebSocket 二进制帧承载多路流：

```text
frame := kind(1) | stream_id(4) | flags(1) | payload
```

kind：

```text
0x01 HEADERS   HTTP 请求/响应头
0x02 DATA      body / WebSocket payload
0x03 END       流结束
0x04 PING
0x05 PONG
```

- `stream_id` 由 Relay 分配，客户端不可复用。
- 单帧最大 64 KiB。
- 单 room 最大并发流由 Relay 限制。
- 不转发明文邀请码到 Relay 日志。

## 5. 客户端接入

Directory resolve 返回：

```json
{
  "join": {
    "url": "https://join.radio.example/r/rm_01J.../api/v1/join",
    "relay_url": "wss://join.radio.example/v1/relay/client?room=rm_01J..."
  },
  "relay_ticket": "short-lived..."
}
```

Web 端可以直接把整个 Station 挂在：

```text
https://join.radio.example/r/rm_01J.../
```

Relay 根据 room 把 HTTP/WS 请求转发给 Station 的出站隧道。

## 6. P2P

- Relay 不阻止 P2P。
- Station 下发的 `/ws` 和 `/source` 仍然有效。
- 如果 WebRTC DataChannel 能直连，继续走 P2P。
- 如果 DataChannel 失败，仍可经 Relay 的 HTTP 叶子或 `/native` 播放。
- P2P 的 SDP/ICE 仍然通过 Station 的 `/ws` 交换。
- Relay 只作为信令/HTTP 通路，不修改 P2P 协议。

## 7. 安全

- Room ticket 短期有效。
- Station token 与 client ticket 分离。
- Relay 不记录音频 body。
- Relay 不缓存响应。
- 限制每 room 连接数、带宽和并发流。
- 限制单 IP 新建 room 频率。
- 断开 Station 后立即撤销 room。
- Relay 不持有管理员 token。
- 管理员流量经 Relay 时仍由 Station 鉴权。

## 8. 失败与回退

```text
Station 直连可用 -> 不使用 Relay
Station 直连失败 -> Directory 返回 relay
Relay 不可用 -> 依赖直接邀请链接/LAN
```

## 9. 部署形态

Relay 可以和 Directory 同进程，也可以独立部署：

```text
join.radio.example
  /v1/resolve
  /v1/stations
  /v1/relay/...
  /r/<room>/
```

对客户端只暴露一个统一域名。
