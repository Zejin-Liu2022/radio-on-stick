# Radio Plugin Protocol v1

状态：草案
协议版本：`radio-plugin/1`

## 目标

- 本地资料库由核心内置。
- 开放平台可以由核心内置或插件提供。
- 商业平台（B站、网易云、QQ）作为可选插件。
- 插件崩溃、超时、升级不影响核心电台。
- 插件不需要和核心使用同一种语言。

## 为什么不用 Go `plugin` 包

不使用：

```go
plugin.Open(...)
```

原因：

- Windows 支持差
- Go 版本和构建参数必须严格一致
- 跨平台打包困难
- 插件 panic 可能拖垮主进程
- 插件升级必须重新编译

## 推荐进程模型

```text
Go 核心
  <-> JSON-RPC / stdio
插件进程
  - bilibili
  - netease
  - qq
  - open-provider
```

可选：

```text
Go 核心
  <-> localhost HTTP/JSON-RPC
插件进程
```

stdio 更适合桌面应用；localhost 更适合独立部署。

## 插件 manifest

```json
{
  "protocol": "radio-plugin/1",
  "id": "bilibili",
  "name": "哔哩哔哩",
  "version": "1.0.0",
  "kind": "commercial",
  "entry": {
    "command": "./radio-plugin-bilibili",
    "args": ["--stdio"]
  },
  "capabilities": ["search", "resolve", "lyrics"],
  "permissions": ["network"],
  "public_only": true,
  "signature": "ed25519:base64url..."
}
```

`kind`：

```text
open
commercial
local-helper
```

## 方法

### initialize

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocol":"radio-plugin/1","locale":"zh-CN"}}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "bilibili",
    "version": "1.0.0",
    "capabilities": ["search", "resolve", "lyrics"]
  }
}
```

### search

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "search",
  "params": {
    "query": "BV12w426rEcW",
    "limit": 10
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "items": [
      {
        "source": "bilibili",
        "source_id": "BV12w426rEcW",
        "title": "标题",
        "artist": "UP主",
        "album": "哔哩哔哩",
        "duration_ms": 213000,
        "cover_url": "https://..."
      }
    ]
  }
}
```

### resolve

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resolve",
  "params": {
    "source_id": "BV12w426rEcW"
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stream_url": "https://...",
    "headers": {
      "Referer": "https://www.bilibili.com/"
    },
    "expires_at": "2026-11-18T01:00:00Z",
    "audio_only": true
  }
}
```

约束：

- `stream_url` 只允许 http/https。
- 核心负责代理和转码。
- 浏览器永远拿不到 `stream_url`。
- 核心必须校验 host 和重定向。
- 插件不得返回本地文件路径、内网地址或任意协议。

### lyrics

```json
{"jsonrpc":"2.0","id":4,"method":"lyrics","params":{"source_id":"..."}}
```

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "lrc": "[00:00.00]...",
    "translation": ""
  }
}
```

## 错误

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32001,
    "message": "public_only",
    "data": {"detail": "该内容不是公开视频"}
  }
}
```

建议错误码：

```text
-32001 public_only
-32002 login_required
-32003 drm
-32004 region_restricted
-32005 upstream_timeout
-32006 invalid_source
-32007 rate_limited
```

## 生命周期

```text
核心启动
  -> 扫描插件目录
  -> 验证 manifest 签名
  -> 启动插件进程
  -> initialize
  -> 健康检查

运行
  -> 请求超时 15s
  -> 连续失败 3 次 -> 标记不可用
  -> 可单独重启
  -> 不影响其他插件

退出
  -> shutdown / terminate
```

## 超时和资源

- 搜索：15s
- 解析：20s
- 歌词：10s
- 单插件并发：2
- 插件日志上限：10MB 滚动
- 插件崩溃不重启超过 3 次/分钟
- 不将管理 token、用户 session 传给插件

## 商业平台边界

### 允许

- 公开视频/公开音频
- 公开 API
- 用户配置的合法 Cookie（仅本地加密保存）
- 只取音频流

### 不允许

- 绕过付费
- 绕过会员
- 绕过 DRM
- 绕过地区限制
- 把商业平台内容重新分发为公开曲库
- 把管理员 token 或用户凭证上传到第三方

## 本地资料库

本地资料库不走插件：

```text
Go 核心
  -> 扫描目录
  -> ffprobe
  -> SQLite FTS5
  -> 直接提供播放
```

原因：

- 文件系统权限
- 路径安全
- 索引性能
- 不需要进程隔离

## 开放平台

开放平台可以内置，也可以插件化：

```text
kind = open
```

要求：

- 允许公开搜索
- 允许合法音频流
- 明确许可证/来源
- 不抓取禁止自动访问的站点

## B站插件

推荐用 Go 写成可选插件或核心内置：

```text
公共视频 URL / BV / av / b23
公开 API
DASH audio
音频刷新
```

仍然只允许公开内容。

## 网易云 / QQ 插件

建议独立进程：

- 签名/风控变化快
- 可能需要 Cookie
- 平台条款风险
- 独立升级
- 崩溃隔离

可以继续使用现有 Python 实现作为 sidecar，后续再决定是否迁移 Go。

## 签名

发布插件必须：

- manifest 签名
- 二进制校验和
- 官方源/用户手动安装
- 插件权限声明
- 禁止插件读取核心数据目录以外的文件

## 插件目录

```text
data/plugins/
  bilibili/
    manifest.json
    radio-plugin-bilibili
  netease/
    manifest.json
    radio-plugin-netease
```

核心只从受信任目录启动插件。
