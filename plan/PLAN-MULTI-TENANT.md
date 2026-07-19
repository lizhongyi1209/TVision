# PLAN-MULTI-TENANT：改造为多租户在线应用

目标：部署为公开在线网站。**登录功能暂时停用（代码保留）**，用户自己粘贴 o1key 令牌即可使用；**令牌即身份**——所有数据按令牌哈希（uid）隔离，互不可见。元数据迁 SQLite，生成图片直接上 S3 兼容对象存储（R2/OSS）。

已确认的现状（探索结论）：
- 30/32 条 API 路由已有 `requireAuth` 门禁，且 workflow 子系统（workflowStore/workflowAssets/runner）**已经全程按 `auth.uid` 隔离**（哈希目录、租约、owner 资产前缀）——这是现成的样板，改造就是把其余子系统拉齐到这个水平。
- 全局共享的坏点：`data/settings.json`（一把全站共用的 apiKey）、`history-meta.json`、`video-meta.json`、`agent-chats/`（无属主，任何人可按 id 读写）、`templates.json`、扁平的 `output/`（canvas 图和视频无属主，`/api/history` 对所有人列出全部）。
- 已知安全洞：`video/save` 无 SSRF 防护；`batch/export` 无资产 ACL；`jobs/[id]` 凭 taskId 即可轮询并落盘他人任务；`settings` 路由任何登录用户可改/探测全局 key；cookie 无 `secure`。

---

## 阶段 1：租户身份 —— 令牌即账号

**新增 `src/lib/db.server.ts`**：better-sqlite3 单例，库文件 `<DATA_DIR>/tvision.db`（`DATA_DIR` 环境变量，默认 `process.cwd()/data`，WAL 模式）。建表见各阶段。

**新增 `src/lib/tenant.server.ts`**：
- `uid = sha256(apiKey).hex.slice(0, 32)` —— 与 workflowAssets 的 owner scope 算法一致，天然兼容现有 workflow 数据。
- 表 `tenants(uid PK, token_enc, created_at, last_seen, defaults_json)`；令牌用 `APP_SECRET`（环境变量）AES-256-GCM 加密落库——后台 workflow runner 需要在无请求上下文时按 ownerId 取回 key（见阶段 4）。
- Cookie `tv_tenant` = `uid.HMAC(uid, APP_SECRET)`，httpOnly + `secure: true` + sameSite lax，30 天。Cookie 不存令牌本体。
- `getTenant(): Promise<TenantSession|null>`（验签 + 查库）；`createTenant(apiKey)`（先打上游连通性探测验证令牌，复用 `settings/test` 的探测逻辑，通过才建租户 + 发 cookie）。

**改 `src/lib/auth.ts`**（登录代码保留，不删）：
- 加 `AUTH_MODE = process.env.AUTH_MODE || "token"`。`getAuth()/requireAuth()` 在 token 模式下委托给 `tenant.server.ts`，返回 `{ uid, username: 令牌掩码, session: "" }`——**30 个路由和 workflow 子系统的 `auth.uid` 接线全部原样复用，零改动**。
- `COOKIE_OPTS` 加 `secure: process.env.NODE_ENV === "production"`（两种模式都加）。

**改 settings 路由为"进门即绑定"**：
- `POST /api/settings`（免登录门禁）：收 `{ apiKey }` → 验证 → `createTenant` → 种 cookie。即新的"进门"动作。`clearApiKey` = 登出（清 cookie，租户数据保留，重贴同一令牌即恢复）。
- `GET /api/settings`：返回当前租户的掩码 key + defaults（per-tenant，不再全局）。
- `POST /api/settings/test`：只测请求体里带的 key，不再回退到任何存储的 key（消掉预言机）。
- `src/lib/settings.ts` 的 `readSettings/writeSettings` 改为按 uid 从 tenants 表读写（保留函数名，加 `uid` 参数）。

**前端**：
- `AuthGate.tsx`/`LoginScreen.tsx`：token 模式下改为"粘贴令牌"进门屏（保留登录 UI 代码，用 AUTH_MODE 开关）；`authStore.ts` 的 `check()` 改打 `/api/settings`。
- `UserChip.tsx`：隐藏充值入口（`TopupModal` 依赖上游 session，token 模式下不可用；代码保留）。`topup/*` 路由在 token 模式下直接 501。

## 阶段 2：元数据迁 SQLite（按 uid 隔离）

建表并重写 4 个坏的全局 store（**函数签名统一加 `uid` 首参，调用点同步改**）：

| 现文件 | 新表 | 调用点改动 |
|---|---|---|
| `historyMeta.ts` | `gen_meta(uid, task_id, meta_json, created_at)`，每 uid 上限 500 条 LRU | `api/jobs/route.ts:95`、`api/jobs/[id]/route.ts:50`、`api/history/route.ts:19`、`workflowRunner.server.ts:386` |
| `videoMeta.ts` | `video_meta(uid, task_id, meta_json, created_at)`，每 uid 200 条 | `api/video/save`、`api/history` |
| `agentStore.server.ts` | `agent_chats(uid, id, title, model, updated_at, messages_json)`，读/写/删全部 `WHERE uid=?`（修掉"任何人可按 id 读他人对话"） | `api/agent/chats`、`api/agent/chats/[id]` |
| `templateStore.server.ts` | `templates(uid, id, ...)` | `api/templates` |

- 消灭 `appendQueue` 等进程内串行化——SQLite 事务天然解决并发写。
- 新增 `jobs(uid, task_id, kind, created_at)` 任务归属表：`POST /api/jobs`、`POST /api/video/jobs` 提交成功时登记；`GET /api/jobs/[id]`、`GET /api/video/jobs/[taskId]` 先查归属，不是自己的 404（堵住"知道 taskId 就能轮询他人任务"）。
- `workflowStore.server.ts` **不迁**（已按 owner 隔离且有跨进程租约），仅把 `data/` 根改为读 `DATA_DIR`。`templates/media`（手工放置的模板示例图）是公共只读资源，保持原样。

## 阶段 3：图片/视频上对象存储（S3 兼容）

**新增 `src/lib/storage.server.ts`**：`@aws-sdk/client-s3`，环境变量 `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/S3_PUBLIC_BASE?`。接口：`putObject(key, bytes, contentType)`、`getObject(key)`、`deleteObject(key)`、`presignGet(key)`。对象键：`outputs/<uid>/<filename>`（文件名沿用现有命名，`tvwf-` 前缀等逻辑不动）。

**新增 `assets` 表**：`assets(uid, name, kind(image|video), bytes, created_at)` —— 列表和 ACL 都走库，不打 S3 LIST。

重写 8 个 `output/` 触点：
1. `api/jobs/[id]/route.ts` — 下载结果（PNG 嵌 meta 逻辑保留）→ `putObject` + 登记 assets。
2. `workflowRunner.server.ts:saveResultImages` — 同上。
3. `api/video/save` — 视频落 S3 + assets；**补 SSRF 防护**（复用 `vision.ts` 的 `isPrivateOrReservedIp` + DNS pin 逻辑校验 `videoUrl`）。
4. `api/media/[name]` GET — 查 assets 归属（`WHERE uid=? AND name=?`，非本人 404）→ 302 到 presigned URL（`S3_PUBLIC_BASE` 配了则走 CDN 直链）；PUT（局部重绘回写）— 校验归属后 `putObject` 覆盖。
5. `api/history` GET/DELETE — 从 assets 表按 uid 列出/删除（删除同时删 S3 对象），不再 readdir。
6. `api/batch/export` — 逐个校验 assets 归属后从 S3 拉字节打 zip（**补上缺失的 ACL**）。
7. `vision.ts:resolveImageToDataUrl` — `/api/media/<name>` 分支加 `uid` 参数，查归属后从 S3 读（堵住猜文件名跨租户读图）；`isAllowedWorkflowImageSource` 可放开允许本人的 `/api/media/` 引用（注释里说的前置条件——输出按用户隔离——此时已成立）。
8. `api/templates/media` — 公共只读，不动（或搬进 `public/`）。

每租户配额：`assets` 表 `SUM(bytes)` 超过 `TENANT_QUOTA_BYTES`（环境变量，默认 2GB）时拒绝新生成并提示清理。

## 阶段 4：workflow runner 的凭据与路径

- `executeReverseNode`/`executeImageNode` 里的 `readSettings()`（`workflowRunner.server.ts:134,339`）改为 `getTenantApiKey(ownerId)`（tenants 表解密取 key）——runner 是后台执行，只有 ownerId 没有请求上下文，这正是令牌必须落库的原因。
- `OUTPUT_DIR` 写盘改走阶段 3 的 storage；懒恢复机制（客户端轮询触发 `ensureWorkflowRun`）与租约协议不动。

## 阶段 5：公网加固

- **限流**：新增 `src/lib/rateLimit.server.ts`（进程内滑窗，按 uid+IP）：`POST /api/settings`（进门/验令牌）与 `settings/test` 每 IP 10 次/分；生成类（jobs、video/jobs、workflow-runs、agent/chat、reverse-prompt）每 uid 30 次/分；上传每 uid 20 次/分。
- **服务端上传校验**：`api/video/upload` 已有 MIME/签名/大小校验（`mediaUpload.server.ts`），核对 `agent/extract`、`media` PUT 的大小上限，统一 25MB 硬顶。
- **并发上限**：每 uid 同时进行的生成任务数上限（查 jobs 表未完成数，默认 8）；批量工坊单次上限沿用 100 但受并发闸控制。
- 顺手修：`templateStore`/`videoMeta` 的无锁竞态（已被 SQLite 消掉）；确认所有文件名处理保持 `path.basename` + 扩展名白名单。

## 阶段 6：部署

- `Dockerfile`（`next.config.mjs` 加 `output: "standalone"`）+ `docker-compose.yml`：app 单容器，`DATA_DIR` 挂卷（SQLite + workflow 文件），S3 走外部服务。
- Caddy 反代自动 HTTPS（compose 内附带）。
- `.env.example`：`APP_SECRET`（必填，泄漏=全部令牌泄漏，注明生成方式 `openssl rand -hex 32`）、`AUTH_MODE=token`、`DATA_DIR`、`S3_*`、`TENANT_QUOTA_BYTES`。
- `README` 加部署章节；`data/` 每日备份提示（SQLite `.backup` + 卷快照）。

## 验证

1. `npm run build` + `npm run test:unit` 通过（workflowStore 现有测试不回归）。
2. 双租户冒烟：两个浏览器分别贴不同令牌 → 各自生成 → 互相看不到对方的历史/媒体/模板/Agent 对话；A 拿 B 的 taskId 轮询 `jobs/[id]` 得 404；A 直接请求 B 的 `/api/media/<name>` 得 404。
3. 清 cookie 重贴同一令牌 → 历史/设置完整恢复（令牌即身份）。
4. workflow：提交一个多步 run，中途重启容器，客户端轮询后 run 恢复并完成，产物落 S3。

## 明确不做（本期）

- 上游账号登录/2FA/充值：代码保留、`AUTH_MODE` 开关关闭，将来切回。
- 旧本地 `data/`、`output/` 数据迁移：线上是全新环境，不写迁移脚本（本地继续可用 `AUTH_MODE` 之外的旧路径跑 dev 不受影响——token 模式是唯一线上模式）。
- Postgres / 多实例横向扩展：SQLite + 单实例先跑，storage/db 层已抽象好接口。
