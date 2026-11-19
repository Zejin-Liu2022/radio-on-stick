# Radio Directory MVP

统一加入入口的 Go 服务。只负责：

- 电台注册
- 心跳
- 邀请码哈希解析
- 静态加入页

不保存音频、留言、管理员 token 或电台数据库。

## 环境变量

```text
RADIO_DIRECTORY_ADDR=127.0.0.1:8787
RADIO_DIRECTORY_DATA=/var/lib/radio-directory/stations.json
RADIO_DIRECTORY_WEB=/opt/radio-directory/web
RADIO_DIRECTORY_PUBLIC_URL=https://join.example.com
RADIO_DIRECTORY_REGISTER_TOKEN=<long-random-token>
```

## API

```text
GET  /v1/health
POST /v1/stations
POST /v1/stations/{station_id}/heartbeat
POST /v1/resolve
GET  /j
GET  /
```

注册和心跳需要：

```http
Authorization: Bearer <RADIO_DIRECTORY_REGISTER_TOKEN>
```

解析邀请码是公开接口，按 IP 限速。

## 构建

```bash
cd directory
go test ./...
go build -trimpath -ldflags="-s -w" -o radio-directory .
```

## 邀请码

16 位 Crockford Base32。

哈希：

```text
sha256:base64url(SHA256("radio-invite/1:" + normalized_code))
```

Directory 只保存哈希，不保存明文。

## 当前范围

这是 Directory MVP。

尚未包含：

- Relay
- Station 自动注册
- 管理员删除/封禁
- 多节点高可用
- Ed25519 descriptor 强制验签

这些属于下一步。
