# 任务模式开发状态与后续计划

更新时间：2026-07-17

当前状态：**按用户要求暂停开发，保留工作区现状，等待后续继续。**

> 重要：任务模式主体和“任务产物按账号隔离”代码均已接入，当前工作区已通过全量单测、TypeScript 和生产构建。但资产隔离仍缺少专门的双账号 API 权限测试及登录后的人工验收，因此暂不标记为完全发布就绪。

## 1. 已完成的主体功能

### 产品与界面

- 顶栏新增“任务模式”一级工作区。
- 实现纵向线性流程编辑器，首版最多 12 个步骤。
- 支持五类步骤：
  - 任务输入
  - 视觉反推
  - 提示词组合
  - 图片生成
  - 任务输出
- 支持新增、插入、复制、删除、拖动排序、上移和下移步骤。
- 支持流程新建、保存、切换、复制和删除。
- 支持 `text`、`image`、`image[]` 类型化绑定，并只展示兼容的前序输出。
- 支持实时校验并定位错误步骤。
- 支持运行前输入弹窗、运行到指定步骤、停止后续步骤、失败重试、运行记录和结果回看。
- 任务结果可下载、设为单图画布，并在历史生成中显示“任务”来源标记。
- 已完成 390px 小屏适配：左右栏改为抽屉，工具栏分行，运行弹窗固定到视口。
- 已补步骤键盘选择、弹窗焦点圈闭、Esc 关闭、焦点恢复及触屏结果操作。

### 前端状态与账号隔离

- `taskStore` 按当前登录账号重置，避免 A 账号的流程、运行结果或输入图在 B 账号出现。
- 退出登录前会提示未保存的任务草稿。
- 切换流程、新建流程和账号变化时会停止旧轮询。
- 轮询对 401/403/404 和终态停止，网络错误采用退避。
- 已修复旧运行的迟到响应取消新运行轮询的问题。
- 保存使用 revision、draft key 和请求序号，保存期间继续编辑不会被旧响应覆盖。
- 刷新或关闭页面时，未保存任务草稿会触发离开提示。
- 运行输入读图使用 owner、draft、dialog session 和字段 request token，旧异步读图不会写入新流程。

### 服务端执行器

- 流程定义和运行记录按认证 UID 哈希目录隔离。
- 使用独立服务端执行器顺序运行步骤，不依赖前端模拟点击。
- 每次运行保存流程快照，之后编辑流程不会影响已启动运行。
- 支持刷新恢复、停止后续步骤、运行到指定步骤和失败重试。
- 图片生成支持部分成功记录；重试时复用已成功的付费上游任务。
- 上游提交使用稳定 `Idempotency-Key`，进程恢复复用相同 attempt/slot key。
- JSON 写入使用跨进程目录互斥锁。
- 执行器使用持久 lease、30 秒心跳、5 分钟过期和 token CAS。
- lease guard 覆盖“校验 token + 写 run/summary”完整临界区。
- 异常状态在释放 lease 前落盘，避免旧执行器覆盖新执行器。
- 同一用户只允许一个活跃流程运行。
- 删除流程会删除其终态运行；存在活跃运行时返回 409。
- 每个用户最多保留最近 100 条运行记录，活跃运行不会被清理。

### 输入安全

- 浏览器提交的工作流图片输入只接受受支持的 `data:image`。
- 拒绝用户直接提交远程 URL 和全局 `/api/media` 路径。
- 远程结果读取已增加：
  - DNS/IP 私网及保留网段阻断
  - 重定向逐跳复核
  - 固定已校验的解析 IP，降低 DNS rebinding 风险
  - 图片 Content-Type 白名单
  - Content-Length 与流式字节上限
  - 总超时和 socket 超时
- 本地图片读取使用文件句柄、文件类型检查和大小上限。

## 2. 最后接入、仍待专项验收的工作

最终只读审查发现：流程定义和运行记录已按账号隔离，但任务生成图片仍复用应用原有的全局 `output/` 历史机制。若不修复，另一个已登录账号可能枚举、读取或删除其他账号的任务图片。

为修复该问题，工作区中已接入以下改动：

- 新增 `src/lib/workflowAssets.server.ts`：
  - SHA-256 UID scope
  - `tvwf-<owner-scope>-<task-id>` 文件名前缀
  - task ID 编码/解码
  - scoped asset 所有权判断
- `workflowRunner.server.ts` 已开始使用 scoped 文件名保存任务结果。
- `workflowStore.server.ts` 已开始复用相同 owner scope。
- `historyMeta.ts` 已开始从 scoped 文件名还原原始 task ID。
- `/api/history` 已加入任务文件列表和删除权限过滤。
- `/api/media/[name]` 已加入任务文件读取和 PUT 权限校验。

这些代码已经通过 TypeScript 和生产构建，但尚未完成双账号登录态下的 API 权限验证，也缺少针对 scoped asset helper 的专门单元测试。下次继续时仍应优先审查这些文件。

## 3. 已完成的验证快照

以下结果已在当前最终工作区重新执行：

- `npm run test:unit`：**88/88 通过**。
- `npx tsc --noEmit --pretty false`：通过。
- `git diff --check`：通过。
- `npm run build`：通过。
- Next.js 生产构建已包含全部 workflow API 路由。
- 未登录访问 `/api/workflows` 和 `/api/workflow-runs` 正确返回 401。
- 本地页面控制台未发现 error/warn。
- 曾启动 `http://127.0.0.1:3001/` 做验收，当前已停止。
- 原 `3000` 本地服务也已停止。

构建根目录问题已通过 `next.config.mjs` 的 `outputFileTracingRoot` 修复。此前 Next.js 会错误选择 `C:\Users\Jony.li` 为根目录并报 `readlink EPERM`。

## 4. 尚未完成或尚未验证

- [x] 接入任务产物账号隔离补丁。
- [ ] 为 scoped asset 增加并跑完单元测试。
- [ ] 在最新工作区重新运行 TypeScript、全量单测、diff check 和生产构建。
- [ ] 登录后完成真实 UI 点击验收。
- [ ] 验证桌面、1024px 和 390px 三种视口。
- [ ] 验证创建、配置、保存、刷新恢复、运行到步骤、运行记录和删除流程。
- [ ] 检查浏览器控制台和网络请求错误。
- [ ] 验证任务图片只对所属账号可见、可读、可删。
- [ ] 决定是否迁移此前可能存在的未加 scope 的旧任务图片。
- [ ] 更新 README 中的任务模式使用说明。
- [ ] 将原设计文档 `PLAN-TASK-MODE.md` 的状态从“等待确认”更新为实际开发状态。

未执行真实 o1key 付费出图测试，避免产生费用。登录后的无计费验收可以使用“运行到提示词组合步骤”，在图片生成步骤之前停止。

## 5. 下次继续开发的推荐顺序

### 第一步：保护现有工作区

1. 运行 `git status --short`。
2. 不要回滚与任务模式无关的批量、视频、Seedance、局部重绘等并行改动。
3. 重点检查以下半完成文件的 diff：
   - `src/lib/workflowAssets.server.ts`
   - `src/lib/workflowRunner.server.ts`
   - `src/lib/workflowStore.server.ts`
   - `src/lib/historyMeta.ts`
   - `src/app/api/history/route.ts`
   - `src/app/api/media/[name]/route.ts`

### 第二步：完成任务产物账号隔离

1. 确认任务图片统一保存为 `tvwf-<owner-scope>-<encoded-task-id>[--imgN].ext`。
2. 确认重试与恢复使用相同 scoped stem，避免重复保存或找不到旧结果。
3. 确认 `jobIdForFile` 能还原普通 task ID、base64url task ID 和多图后缀。
4. 确认 `/api/history`：
   - 普通旧文件保持原行为。
   - scoped 任务文件只对 owner 可见。
   - DELETE 对非 owner 返回 404。
5. 确认 `/api/media/[name]`：
   - GET 和 PUT 都校验 owner。
   - scoped 文件使用 `Cache-Control: private`，避免共享缓存泄露。
6. 对 malformed `tvwf-` 文件采取拒绝访问策略。
7. 增加测试：
   - 两个 owner 的 scope 不同。
   - owner A 不能访问 owner B 文件。
   - malformed scoped 文件不可访问。
   - 普通 legacy 文件仍可访问。
   - task ID 编码/解码可往返。
   - `--imgN` 文件可映射回原 job ID。

### 第三步：重新跑自动验证

```bash
npx tsc --noEmit --pretty false
npm run test:unit
git diff --check
npm run build
```

若任一命令失败，先判断是否来自任务模式文件，避免覆盖并行开发内容。

### 第四步：登录后的无计费 UI 验收

1. 启动 `npm run dev`。
2. 登录应用并进入“任务模式”。
3. 创建一个仅文本输入的流程。
4. 配置提示词组合、图片生成和任务输出，使流程整体校验通过。
5. 选择“运行到提示词组合步骤”，确保在付费图片生成前停止。
6. 验证保存、切换、刷新恢复、运行状态、运行记录和移动端抽屉。
7. 保存桌面和 390px 截图并检查控制台。

### 第五步：可选的付费链路验收

只有在明确允许产生费用后，才运行一次最小张数的真实流程：

1. 原图视觉反推。
2. 反推词与自定义词组合。
3. 使用新参考图生成 1 张图。
4. 确认最终图片进入历史，并能追溯 workflow/run/node。
5. 使用第二账号验证不可见、不可读、不可删。

## 6. 主要文件索引

### 新增

- `src/components/TaskWorkshop.tsx`
- `src/lib/taskStore.ts`
- `src/lib/workflowTypes.ts`
- `src/lib/workflowStore.server.ts`
- `src/lib/workflowRunner.server.ts`
- `src/lib/workflowAssets.server.ts`（已接入，待双账号专项验收）
- `src/app/api/workflows/**`
- `src/app/api/workflow-runs/**`
- `src/lib/__tests__/workflowTypes.test.ts`
- `src/lib/__tests__/workflowStore.test.ts`
- `src/lib/__tests__/workflowSecurity.test.ts`

### 集成修改

- `src/components/Studio.tsx`
- `src/components/AuthGate.tsx`
- `src/components/UserChip.tsx`
- `src/components/HistoryPage.tsx`
- `src/lib/store.ts`
- `src/lib/types.ts`
- `src/lib/historyMeta.ts`
- `src/lib/vision.ts`
- `src/lib/o1key.ts`
- `src/app/api/history/route.ts`（已接入 owner 过滤，待双账号专项验收）
- `src/app/api/media/[name]/route.ts`（已接入 owner 校验，待双账号专项验收）
- `next.config.mjs`

## 7. 工作区注意事项

- 当前工作区是 dirty 状态。
- 同时存在不属于任务模式的批量、视频、Seedance、局部重绘等修改和未跟踪文件。
- 后续开发不得使用 `git reset --hard`、`git checkout --` 或批量删除来“清理”工作区。
- 应按文件和 diff 精确继续，保留用户及其他并行任务的改动。
- 本次未提交 Git commit，也未暂存文件。
