# cpa-cron-web

`cpa-cron-web` 是一个 CPA 账号运维面板，用于扫描账号状态、清理失效账号、处理限额账号、恢复可用账号，并通过仪表盘、任务记录和活动日志展示整个维护过程。

> 当前版本：**v1.2.0**

当前版本同时支持两种运行方式：

- **Cloudflare Workers 部署**
- **Docker / Node.js 部署**

它适合已经拥有 CPA 管理接口的场景，不是通用的账号管理系统。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuyifan666888/cpa-warden-web)

## 特性

- 扫描远端账号库存并同步到本地缓存
- 探测账号可用性、识别 `401`、限额和可恢复状态
- 支持删除 `401` 账号、禁用或删除限额账号、恢复已恢复账号
- 账号状态支持悬浮查看原因，异常与禁用原因会优先显示中文说明
- 支持手动上传账号文件与补充账号池
- 提供仪表盘、账号列表、任务队列、扫描历史、活动日志
- 支持 Cloudflare Cron 定时执行维护
- 支持 Docker / Node.js 本地或服务器部署
- Docker 模式下使用本地 SQLite + 本地 KV 仿真层，不受 Cloudflare Worker 单次 invocation subrequests 限制
- 扫描 / 维护已内置轮转探测，避免单次任务把远端探测请求打满

## 技术栈

- Hono
- TypeScript
- Cloudflare Workers + D1 + KV
- Docker / Node.js + SQLite 本地适配层

## 项目结构

```
cpa-cron-web/
├── src/
│   ├── index.ts              # Worker 入口 + Cron scheduled handler
│   ├── types.ts              # 类型定义
│   ├── core/
│   │   ├── config.ts         # 配置读写 + Cron/Cache 元数据
│   │   ├── cpa-client.ts     # CPA Management API 客户端 + 账号分类
│   │   ├── db.ts             # D1 数据库操作
│   │   └── engine.ts         # 扫描/维护/上传/补充引擎
│   ├── middleware/
│   │   └── auth.ts           # JWT 认证 + 管理员初始化
│   ├── routes/
│   │   ├── api.ts            # REST API 路由
│   │   └── pages.ts          # 页面路由
│   ├── runtime/
│   │   ├── local-platform.ts # Docker/Node 下的 SQLite + KV 兼容层
│   │   └── node-server.ts    # Docker/Node HTTP 服务入口 + 定时调度
│   └── views/
│       ├── layout.ts         # HTML 布局 + 全局样式
│       └── pages.ts          # 各页面 HTML + JS
├── migrations/
│   └── 0001_init.sql         # D1 数据库 Schema
├── Dockerfile
├── docker-compose.yml.example
├── wrangler.toml             # Cloudflare Workers 配置
├── tsconfig.json
└── package.json
```

## 依赖接口

项目依赖 CPA 服务提供以下管理接口：

- `GET /v0/management/auth-files`
- `POST /v0/management/api-call`
- `DELETE /v0/management/auth-files?name=...`
- `PATCH /v0/management/auth-files/status`
- `POST /v0/management/auth-files`

如果这些接口不可用，页面仍可访问，但扫描、维护、上传和定时任务无法正常工作。

## 快速开始

### 方案 A：Cloudflare Workers

安装依赖：

```bash
npm install
```

初始化本地 D1：

```bash
npm run db:migrate
```

创建本地环境变量文件：

```bash
cp .dev.vars.example .dev.vars
```

启动本地开发：

```bash
npm run dev
```

### 方案 B：Docker / Node.js

要求：

- Node.js **20+**
- Docker（如果使用容器部署）

直接用 Node.js 启动：

```bash
npm install
JWT_SECRET=please-change-me ADMIN_PASSWORD=admin123 npm run docker:start
```

默认行为：

- 监听 `0.0.0.0:18787`
- SQLite 数据库文件在 `/data/cpa-cron-web.db`
- 会自动执行 `migrations/*.sql`
- 会自动启动“每分钟 tick 一次”的本地调度器，再由系统配置中的 `cron_expression` 决定是否真正执行维护

也可以用 Docker 启动：

```bash
docker build -t cpa-cron-web .
docker run -d \
  --name cpa-cron-web \
  -p 18787:18787 \
  -e JWT_SECRET=please-change-me \
  -e ADMIN_PASSWORD=admin123 \
  -e CPA_BASE_URL=http://192.168.2.1 \
  -e CPA_TOKEN=your-token \
  -v $(pwd)/data:/data \
  cpa-cron-web
```

如果更习惯 Compose：

```bash
cp docker-compose.yml.example docker-compose.yml
docker compose up -d --build
```

首次启动后可通过以下地址确认服务是否正常：

- 面板首页：`http://127.0.0.1:18787`
- 健康检查：`http://127.0.0.1:18787/healthz`

## 部署模式对比

| 维度 | Cloudflare Workers | Docker / Node.js |
|---|---|---|
| 运行时 | Cloudflare Worker | Node.js 20+ |
| 数据存储 | D1 + KV | SQLite + 本地 KV 仿真 |
| 定时任务 | Cloudflare Cron Trigger | 进程内每分钟 tick + `cron_expression` |
| 子请求限制 | 受 Worker invocation subrequests 限制 | 不受 Worker subrequests 限制 |
| 部署方式 | `wrangler deploy` | `docker run` / `docker compose up -d` |
| 适合场景 | 已在 Cloudflare 体系内 | 自建服务器 / NAS / 本地常驻 |

如果你的账号量较大、维护任务较密，或者经常遇到 Cloudflare Worker 的：

```text
Too many subrequests by single Worker invocation
```

那么更建议使用 **Docker / Node.js 部署**。

## 配置说明

### 环境变量

- `JWT_SECRET`: 用于签发登录令牌，生产环境必须设置
- `CPA_BASE_URL`: 可选，CPA 管理接口默认地址，可作为系统配置页 `base_url` 的兜底值
- `CPA_TOKEN`: 可选，CPA 管理接口默认 token，可作为系统配置页 `token` 的兜底值
- `ADMIN_USERNAME`: 可选，首个管理员用户名，默认值为 `admin`
- `ADMIN_PASSWORD`: 推荐，首个管理员密码
- `ADMIN_PASSWORD_HASH`: 可选，管理员密码哈希；如果提供则优先使用
- `SQLITE_PATH`: 仅 Docker / Node.js 模式使用，本地 SQLite 数据库文件路径，默认 `/data/cpa-cron-web.db`
- `HOST`: 仅 Docker / Node.js 模式使用，默认 `0.0.0.0`
- `PORT`: 仅 Docker / Node.js 模式使用，默认 `18787`
- `ENABLE_CRON`: 仅 Docker / Node.js 模式使用，默认 `true`

说明：

- 系统不会再自动创建固定默认密码管理员
- 只有在提供 `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH` 时，才会自动初始化首个管理员
- 数据库未保存 `base_url` / `token` 时，可回退到 `CPA_BASE_URL` / `CPA_TOKEN`
- Docker / Node.js 模式下，`JWT_SECRET` 同样必须设置，否则登录鉴权无法工作
- Docker / Node.js 模式建议显式挂载 `/data`，否则容器重建后 SQLite 数据会丢失

### 面板配置

部署完成后，需要在系统配置页面填写：

- `base_url`
- `token`
- `target_type`
- `provider`（可选）
- `cron_expression`（可选，UTC Cron 表达式，用于控制实际维护执行频率）

这些配置决定扫描、维护和上传时如何连接你的 CPA 管理接口。

### 执行频率配置

当前版本的定时维护分成两层：

1. **Cloudflare 基础 Trigger**
   - `wrangler.toml` 中固定为每分钟触发一次
2. **系统配置中的 `cron_expression`**
   - Worker 会在每次触发时读取该表达式
   - 只有匹配到当前时间时，才真正执行维护流程

默认表达式：

```text
*/30 * * * *
```

表示：

- 每 30 分钟执行一次

注意：

- `cron_expression` 按 **UTC** 解释
- 页面里提供了几个快捷选项，例如“每10分钟”“每30分钟”“每小时”“每天 02:00 UTC”
- 修改 `cron_expression` 后，需要重新部署一次，让 Cloudflare 侧基础 Trigger 使用最新 Worker 代码：

```bash
npm run deploy
```

常用示例：

- `*/10 * * * *`：每 10 分钟
- `*/30 * * * *`：每 30 分钟
- `0 * * * *`：每小时
- `0 2 * * *`：每天 02:00 UTC

### 轮转探测说明

为避免单次任务中过多远端探测请求，当前版本已将探测改为**轮转分批执行**：

- 手动扫描：单次最多探测 `25` 个候选账号
- 手动维护：单次最多探测 `6` 个候选账号
- 自动 Cron 维护：单次最多探测 `10` 个候选账号

系统会在 `app_config` 中记录游标：

- `scan_probe_cursor`
- `maintain_probe_cursor`

下一次任务会自动从上次游标后继续探测，因此不是永远只扫前面一批账号。

> 说明：  
> 这层轮转探测在 Cloudflare Workers 和 Docker / Node.js 两种模式下都会生效。  
> 其中 Docker / Node.js 模式不再受 Cloudflare Worker 的 subrequests 限制，但仍建议保留轮转策略，避免一次任务对 CPA 管理接口打出过高瞬时压力。

### 账号状态原因说明

账号管理页中的状态标签支持鼠标悬浮查看详细原因，优先级如下：

1. 最近一次动作失败原因 `last_action_error`
2. 探测异常原因 `probe_error_text`
3. 管理原因 `managed_reason`
4. 兜底中文状态说明

其中常见原因会自动转成更易懂的中文，例如：

- `missing_auth_index` → 账号缺少 `auth_index`，无法发起探测
- `management_api_http_429` → 管理接口触发限流，请稍后重试
- `timeout` → 探测超时，请检查网络或目标服务响应速度
- `quota_disabled` → 系统因限额自动禁用
- `manual_disabled` → 账号被手动禁用

### 历史保留策略

当前版本默认**仅保留最近 1 天历史数据**，包含：

- 扫描历史 `scan_runs`
- 操作日志 `activity_log`
- 已完成 / 失败任务记录 `task_queue`

说明：

- 运行中的任务不会被自动删除
- 自动清理是在系统写入新历史时顺带执行，不是单独起一个清理 Worker
- 页面中的“保留天数”输入框用于手动清理历史，默认值也是 `1`

#### 如何修改保留天数

当前版本的保留天数**不是通过 Cloudflare Dashboard / `wrangler.toml` 变量配置**，而是写在代码里。

位置：

- `src/core/db.ts`

当前默认值：

```ts
const HISTORY_RETENTION_DAYS = 1;
const ACTIVITY_LOG_RETENTION_DAYS = 1;
```

如果你想改成保留 7 天，可以改为：

```ts
const HISTORY_RETENTION_DAYS = 7;
const ACTIVITY_LOG_RETENTION_DAYS = 7;
```

修改后重新部署：

```bash
npm run deploy
```

#### 如果想改成 Cloudflare 可配置

当前项目还没有把历史保留天数接到 CF 环境变量。  
如果后续需要支持在 Cloudflare Dashboard 中直接修改，可以再把它扩展为 `vars` 或 Secret 读取模式。

## Cloudflare 部署

### 1. 创建资源

创建 D1 和 KV：

```bash
wrangler d1 create cpa-warden-db
wrangler kv namespace create KV
```

将返回的资源 ID 填入 `wrangler.toml`。

### 2. 配置 Secret

```bash
wrangler secret put JWT_SECRET
wrangler secret put ADMIN_PASSWORD
wrangler secret put CPA_TOKEN
```

如果你不想直接写明文密码，也可以改用 `ADMIN_PASSWORD_HASH`。

`CPA_BASE_URL` 可以作为普通环境变量配置；`CPA_TOKEN` 建议以 secret 形式写入。

### 3. 远端初始化数据库

```bash
npm run db:migrate:remote
```

### 4. 部署 Worker

```bash
npm run deploy
```

`npm run deploy` 会先执行远端 migration，再执行 `wrangler deploy`。

## Cron

项目默认启用 Cloudflare Cron 基础触发：

```toml
[triggers]
crons = ["* * * * *"]
```

基础 Trigger 每分钟触发一次，但**真正执行频率**由系统配置页中的 `cron_expression` 决定，默认仍为：

```text
*/30 * * * *
```

也就是默认每 30 分钟执行一次维护流程。

维护流程包含：

- 扫描账号状态
- 清理 `401` 账号
- 处理限额账号
- 恢复已恢复账号
- 写入任务记录、扫描历史和活动日志

Cron 执行前会通过 KV 获取分布式锁（`cron:maintain:lock`，TTL 5 分钟），防止任务重叠执行。如果上一次 Cron 仍在运行，新的触发会自动跳过并记录日志。

## Docker / Node.js 部署

### 运行原理

Docker 模式下不会走 Cloudflare Worker 运行时，而是：

- 使用 `@hono/node-server` 启动 HTTP 服务
- 使用 `better-sqlite3` 承担本地数据库
- 通过 `src/runtime/local-platform.ts` 模拟 D1 / KV 所需的最小接口
- 通过本地每分钟 tick 调用同一套 `runScheduledMaintain(...)` 逻辑

因此：

- 页面、API、扫描、维护、上传逻辑与 Worker 版本保持一致
- 不再受 Worker 单次 invocation 的 subrequests 限制
- 但仍然会受到你自己的机器资源、网络质量，以及 CPA 管理端本身限流策略影响

### 数据持久化

Docker 模式下，数据库默认写入：

```text
/data/cpa-cron-web.db
```

因此建议始终挂载宿主机目录：

```bash
-v $(pwd)/data:/data
```

否则：

- 容器删除后，账号缓存、活动日志、任务记录、系统配置都会一起丢失

### 升级方式

如果你使用 Docker 部署，升级到新版本时建议：

```bash
docker compose down
docker compose up -d --build
```

或：

```bash
docker build -t cpa-cron-web .
docker rm -f cpa-cron-web
docker run -d ... cpa-cron-web
```

只要 `/data` 做了持久化挂载，SQLite 数据会保留。

### Docker 环境变量示例

```bash
JWT_SECRET=please-change-me
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123456
CPA_BASE_URL=http://192.168.2.1
CPA_TOKEN=replace-me
PORT=18787
HOST=0.0.0.0
SQLITE_PATH=/data/cpa-cron-web.db
ENABLE_CRON=true
```

### 健康检查

Docker / Node.js 模式可直接访问：

```text
GET /healthz
```

返回：

```json
{"ok":true}
```

## 本地验证 Cron

本地 `wrangler dev` 不会自动执行定时任务，可以手动触发：

```bash
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled"
```

然后检查：

- `/api/dashboard`
- `/api/tasks`
- `/api/activity`

Docker / Node.js 模式下不需要这个特殊触发地址，进程启动后会自动每分钟 tick 一次。  
如果只是想验证服务是否活着，可以直接访问：

```bash
curl http://127.0.0.1:18787/healthz
```

## 安全说明

- 生产环境必须配置 `JWT_SECRET`（建议 `openssl rand -hex 32` 生成）
- 建议首次部署时通过 `wrangler secret put ADMIN_PASSWORD` 设置管理员密码
- 不要提交 `.dev.vars`（已在 `.gitignore` 中排除）
- 部署前务必将 `wrangler.toml` 中的 `<YOUR_D1_DATABASE_ID>` 和 `<YOUR_KV_NAMESPACE_ID>` 替换为你自己的资源 ID
- 不要在公开仓库中提交真实 Cloudflare 资源 ID、Token 或私有接口地址

## 开发命令

```bash
npm install
npm run db:migrate
npx tsc --noEmit
npm run dev
npm run docker:start
```

## 许可证

本项目使用 `MIT` 许可证。详见 `LICENSE`。
