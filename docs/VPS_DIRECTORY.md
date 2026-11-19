# VPS Directory 部署

Directory 只做统一加入入口：

- 电台注册
- 心跳
- 邀请码哈希解析
- 静态加入页

不保存音频、留言、管理员 token 或 Station 数据库。

## 组件

```text
Caddy       公共 HTTPS，反代 127.0.0.1:8787
radio-directory  Go 服务
systemd     守护进程
```

## 安装目录

```text
/opt/radio-directory/       二进制和 web
/var/lib/radio-directory/   stations.json
/etc/radio-directory.env    注册 token
```

## 环境文件

```text
RADIO_DIRECTORY_ADDR=127.0.0.1:8787
RADIO_DIRECTORY_DATA=/var/lib/radio-directory/stations.json
RADIO_DIRECTORY_WEB=/opt/radio-directory/web
RADIO_DIRECTORY_PUBLIC_URL=https://join.example.com
RADIO_DIRECTORY_REGISTER_TOKEN=<long-random-token>
```

`/etc/radio-directory.env` 必须 root:radio-directory 0640。

## Caddy

```caddyfile
join.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
```

Caddy 自动申请公共证书。DNS 使用 A/AAAA 记录，第一阶段建议 DNS only。

## 验证

```bash
curl https://join.example.com/v1/health
curl -H 'Content-Type: application/json' \
  -d '{"code":"7K4M9Q2XJ8R5T3WA"}' \
  https://join.example.com/v1/resolve
```

## 注册示例

邀请码哈希：

```text
sha256:base64url(SHA256("radio-invite/1:" + normalized_code))
```

注册：

```bash
curl -X POST https://join.example.com/v1/stations \
  -H "Authorization: Bearer $RADIO_DIRECTORY_REGISTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "station": {
      "protocol": "radio-station/1",
      "station_id": "st_example",
      "name": "Example Radio",
      "public_key": "ed25519:...",
      "capabilities": ["join", "mesh"],
      "connectivity": ["direct"],
      "endpoints": [{"kind": "direct", "url": "https://station.example"}],
      "issued_at": "2026-11-20T00:00:00Z"
    },
    "invite_hashes": ["sha256:..."]
  }'
```

## 当前限制

- 没有 Relay
- 没有自动 Station 注册
- 没有强制 Ed25519 descriptor 验签
- 单节点，无高可用
- `sslip.io` 只适合过渡，正式使用自定义域名

## Station 接入

Station 环境文件增加：

```text
RADIO_DIRECTORY_URL=https://join.example.com
RADIO_DIRECTORY_REGISTER_TOKEN=<directory register token>
RADIO_DIRECTORY_PUBLIC_URL=https://station.example
RADIO_DIRECTORY_HEARTBEAT=300
```

Station 启动后会：

1. 生成稳定的 `station_id`
2. 生成邀请码
3. 把邀请码哈希注册到 Directory
4. 每 5 分钟心跳

管理员可在管理端「电台目录」复制或轮换邀请码。

注意：这是 Directory 接入 MVP。邀请码在 Directory 层负责定位电台；Station 端强制凭邀请码建立 session 仍属于下一步。
