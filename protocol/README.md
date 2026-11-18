# Protocol v1

当前协议草案：

```text
docs/ARCHITECTURE.md
docs/JOIN_PROTOCOL.md
docs/PLUGIN_PROTOCOL.md
docs/RELAY_PROTOCOL.md
```

JSON 示例只描述结构，不包含真实密钥、邀请码或服务器地址。

## 统一入口的硬前提

要实现“任意网络环境统一地址 + 邀请码加入”，必须有一个公共可达的 Directory：

```text
https://join.radio.example/
```

Directory 负责：

- 保存 `invite_hash -> station_id`
- 返回 Station descriptor
- 记录 endpoint / connectivity
- 为 NAT 后的 Station 提供 Relay 会合

Directory 不做：

- 保存音频
- 保存管理员 token
- 公开列出所有电台
- 默认代理音频

没有 Directory 时：

- 直接邀请链接只能加入可达 Station
- 局域网 APP 可以 mDNS 发现
- 网页端只能使用直接邀请链接
- 不存在跨网络统一入口

## 示例

```text
protocol/v1/station.json
protocol/v1/directory-resolve.request.json
protocol/v1/directory-resolve.response.json
protocol/v1/join.request.json
protocol/v1/join.response.json
protocol/v1/register.request.json
protocol/v1/plugin-manifest.json
```

## 下一步

1. 实现 Go Directory MVP
2. 实现 Station 注册/心跳/邀请码解析
3. 实现 Relay room
4. Go 核心接入 join API
5. Web 统一入口页面
