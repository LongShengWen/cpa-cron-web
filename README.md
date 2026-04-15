# cpa-cron-web

`cpa-cron-web` 是一个运行在 Cloudflare Workers 上的 CPA 账号运维面板，用于扫描账号状态、清理失效账号、处理限额账号、恢复可用账号，并通过仪表盘、任务记录和活动日志展示整个维护过程。

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
- 支持本地开发与 Cloudflare Workers 部署

## 技术栈

- Cloudflare Workers
- Hono
- Cloudflare D1
- Cloudflare KV
- TypeScript

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
│   └── views/
│       ├── layout.ts         # HTML 布局 + 全局样式
│       └── pages.ts          # 各页面 HTML + JS
├── migrations/
│   └── 0001_init.sql         # D1 数据库 Schema
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

## 配置说明

### 环境变量

- `JWT_SECRET`: 用于签发登录令牌，生产环境必须设置
- `CPA_BASE_URL`: 可选，CPA 管理接口默认地址，可作为系统配置页 `base_url` 的兜底值
- `CPA_TOKEN`: 可选，CPA 管理接口默认 token，可作为系统配置页 `token` 的兜底值
- `ADMIN_USERNAME`: 可选，首个管理员用户名，默认值为 `admin`
- `ADMIN_PASSWORD`: 推荐，首个管理员密码
- `ADMIN_PASSWORD_HASH`: 可选，管理员密码哈希；如果提供则优先使用

说明：

- 系统不会再自动创建固定默认密码管理员
- 只有在提供 `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH` 时，才会自动初始化首个管理员
- 数据库未保存 `base_url` / `token` 时，可回退到 `CPA_BASE_URL` / `CPA_TOKEN`

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

## 本地验证 Cron

本地 `wrangler dev` 不会自动执行定时任务，可以手动触发：

```bash
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled"
```

然后检查：

- `/api/dashboard`
- `/api/tasks`
- `/api/activity`

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
```

## 许可证

本项目使用 `MIT` 许可证。详见 `LICENSE`。
