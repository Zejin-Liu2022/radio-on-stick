# Radio on Stick 架构

## 目标

- APP 可以加入他人电台，也可以主动发起电台。
- 网页端只能加入他人电台，不能发起。
- 通过统一地址和邀请码加入任意已注册电台。
- 不破坏网页听众和 P2P 网状分发。
- 本地资料库、开放平台、商业平台分别作为独立能力接入。

## 角色

```text
Station        电台服务器（Go 核心）
Host App       带 Go 核心的桌面应用，可发起电台
Join App       加入他人电台的桌面/移动应用
Web Listener   网页听众，只能加入
Directory      公共统一入口，邀请码解析、注册、心跳
Relay          可选。为 NAT 后的电台提供会合/转发
Plugin         本地库/开放平台/商业平台能力
```

## 总体结构

```text
                         https://join.radio.example/
                                  |
                                  | 邀请码解析
                                  v
+----------------+        +----------------+        +----------------+
|   Web Listener | -----> |   Directory    | <----- |   Host App     |
|   / Join App   |        |  (public)      |        |   Station      |
+----------------+        +----------------+        +----------------+
        |                         |                         |
        |                         | 注册/心跳/relay ticket   |
        |                         v                         |
        |                 +----------------+                |
        +---------------> |   Station      | <--------------+
           join / mesh    |  HTTP + WS     |
                          +----------------+
                                  |
                                  v
                          Local library / plugins
```

## 统一地址

公共入口只做“加入”，不转发默认音频：

```text
https://join.radio.example/
```

用户输入邀请码后：

```text
Portal -> Directory resolve -> Station join -> Web Listener
```

电台可能是：

1. **直接可达**：公网 HTTPS / 域名 / Cloudflare Tunnel。
2. **仅局域网**：同一网络内可通过邀请链接或 mDNS 加入。
3. **NAT 后**：电台主动连接 Relay，客户端经 Relay 加入。

“任何网络都能访问”依赖第 1 或第 3 种。

## 电台核心

Go 核心负责：

- HTTP/HTTPS
- WebSocket / P2P signaling
- SQLite
- 播放队列与状态
- 邀请码校验
- 管理员权限
- 本地资料库
- 流媒体 `/source`、`/native`
- 静态网页/PWA
- 目录注册与心跳
- 插件生命周期

不负责：

- 平台登录绕过
- DRM
- 公共目录的运营

## 本地资料库

管理员配置多个根目录：

```text
library/
  Album/
  Artist/
```

扫描后写入 SQLite FTS5：

- 标题、歌手、专辑
- 时长、格式、码率
- 封面
- `.lrc` 歌词
- 文件指纹

安全约束：

- 只扫描管理员明确配置的目录
- 拒绝 symlink 逃逸
- 不把绝对路径暴露给客户端
- 单文件/单目录/总量限制
- 增量扫描，不做全量阻塞

## 插件

插件分三类：

```text
local      本地资料库，核心内置
open       开放平台搜索，核心内置或插件
commercial B站/网易云/QQ，可选插件
```

商业平台不建议写进核心：

- API/签名变化快
- 登录/风控策略变化快
- 法律和平台条款风险
- 插件崩溃不应影响电台

插件协议见 [PLUGIN_PROTOCOL.md](PLUGIN_PROTOCOL.md)。
NAT 后电台的 Relay 协议见 [RELAY_PROTOCOL.md](RELAY_PROTOCOL.md)。

## P2P

保留现有网页听众的网状链路：

```text
/source/manifest
/source/chunk
/ws
/native/<track_id>
```

APP 听众继续使用 WebView 加载同一套 listener 前端，保留：

- 种子/中继
- DataChannel
- MSE
- HTTP 叶子 fallback
- 服务器 `/native` fallback

Relay 只作为 NAT/失败兜底，不替代 P2P。

## APP 端

### Host App

```text
Wails / Tauri 原生外壳
  -> 启动 Go 核心
  -> 管理员页面作为主界面
  -> 托盘/菜单/通知
  -> ffmpeg sidecar
```

首次启动：

1. 选择数据目录
2. 创建 owner
3. 配置监听地址
4. 选择本地资料库目录
5. 创建邀请码
6. 可选注册到 Directory
7. 可选 Cloudflare Tunnel / Relay

### Join App

- 输入邀请码/邀请链接/扫码
- 通过 Directory 解析
- 进入 listener
- 管理员 token 可提升为 admin
- 不启动本地 Go 核心

### Web Listener

- 只能加入
- 通过统一入口或邀请链接
- 保留 P2P
- 不提供 host/管理员创建能力

## 管理员模型

```text
owner       创建者，自动获得
admin       通过 admin token 或 admin invite 加入
moderator   管理留言/队列
listener    播放/点歌/留言
```

- 创建者自动成为 owner。
- admin token 只在电台本地校验，不存 Directory。
- 邀请码只授予 listener，不能授予 owner/admin。
- owner 可生成一次性 admin invite。
- 本机 loopback 永远保留，防锁死。

## 网络模式

```text
local   127.0.0.1
lan     0.0.0.0 + 局域网 CIDR
public  0.0.0.0 + TLS
relay   仅出站连接到 Relay
```

公网必须：

- HTTPS
- 管理员 token
- 登录限速
- 邀请码/访问控制
- 可选 Directory 注册

## 阶段

### Phase 0：协议

- 本文件
- [JOIN_PROTOCOL.md](JOIN_PROTOCOL.md)
- [PLUGIN_PROTOCOL.md](PLUGIN_PROTOCOL.md)
- `protocol/v1/*.json`

### Phase 1：Go 核心 MVP

- 本地库
- 邀请码
- 加入
- owner/admin
- 队列/播放
- `/source`、`/native`
- WebSocket
- 网页 listener

### Phase 2：Directory + Relay

- 注册、心跳、解析
- NAT 后 relay
- 统一入口

### Phase 3：插件

- B站 Go 插件
- 网易云/QQ sidecar

### Phase 4：桌面 App

- Wails/Tauri
- 管理端主界面
- 安装包

### Phase 5：移动端

- 只加入
- 不做长期 hosting

## 非目标

- 没有 Directory 也能全球统一地址
- 绕过商业平台付费/DRM
- 在 iOS 后台长期运行服务器
- 用一套网页完全复刻三平台原生 HIG
