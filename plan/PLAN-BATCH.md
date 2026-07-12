# 开发设计 · 批量工坊（PLAN-BATCH）

> 需求：① 批量模式——1 个模特并发批量穿上传的服装图（最多 50 件），逐张换装的批量版，所有上传图完整显示在画布上；② 全匹配模式——多个模特 × 多件服装，每人穿每件。
> 草图已于 2026-07-12 经用户确认两项关键取舍：**统一工坊**（模特数量决定 1×N 批量 / M×N 全匹配，不做两个独立入口）、**服装墙全部同屏**（格子随数量自适应缩小，永不滚动）。
> 本文档为定稿设计，按此实施；任务打勾在 [DEV-PLAN.md](../DEV-PLAN.md)（F4），踩坑记 [DEV-ERRORS.md](../DEV-ERRORS.md)。

## 〇、定稿草图（已确认）

```
顶栏:  ◆ TVision   [ ● 单图创作 | 批量工坊 ]   ▤ ◉ ⚙     ← 模式切换，两边状态独立

批量模式（1 模特）:                          全匹配（≥2 模特自动切矩阵）:
┌────────┬─────────────────────┐    ┌─────────┬───────┬───────┬╌╌╌╌╌┐
│ 模特1   │ 服装·50件 [＋添加][清空]│    │服装＼模特 │[模特1] │[模特2] │＋模特 ╎
│ (完整   │ ┌─┐┌─┐┌─┐…10列×5行    │    ├─────────┼───────┼───────┼╌╌╌╌╌┤
│  显示)  │ └─┘└─┘└─┘ 全部同屏     │    │ [服装1]  │ 结果   │ 72%   │     ╎
│┌╌╌╌╌╌┐ │ 每格完整显示不裁切      │    │ [服装2]  │ 结果   │ ⚠重生成│     ╎
│╎＋加模特╎│ hover:更换/删除        │    │ ┆＋服装┆ │ 行列头吸附·超屏纵向滚动 │
└────────┴─────────────────────┘    └─────────┴───────┴───────┴╌╌╌╌╌┘

卡片状态循环:  服装图 → 服装暗+百分比 → 结果图(出一张亮一张) / ⚠重生成
底部批量生成栏: 类型[智能识别▾]·「M 位模特 × N 件服装」· 提示词模板(可改) ·
               [模型][分辨率][比例][计费] · ⚡生成 N 张
运行中: ███░░ 已完成 x/N · y 张未成功 [■停止]；完成: [↻重试未成功][⬇打包下载]
点击结果卡 → 前后对比弹框(模特原图↔结果·服装角标·下载/重生成/设为画布·上一张/下一张)
```

## 一、现状事实（已核实，直接采信）

- `POST /api/jobs` 一次请求 = 同一 submitBody 提交 `count` 份（`src/app/api/jobs/route.ts:75-77`），每个 id 写历史侧车 `appendMeta`。批量的「不同图对」无法用 count 表达 → **每个组合一次独立 POST**（count=1），服务端生成链路零改动即可复用（校验、20MB 拦截、落盘、历史全在）。
- `GET /api/jobs/[id]` 幂等轮询 + 成功即下载到 `output/`（`src/app/api/jobs/[id]/route.ts`）→ 批量轮询直接复用，出一张下载一张，天然「出一张亮一张」。
- 单图模式的轮询/假进度引擎在 `Studio.tsx` 的 effect 里，与 `useStudio.phase/jobIds/results` 深度耦合 → 批量**不复用**该引擎，自建独立引擎。
- 高频状态独立建 store 已有先例：`logStore.ts` 注释明确「避免高频写入触发主 store 订阅者重渲」→ 批量 50 格的高频进度更新同理，新建 `batchStore`。
- 提示词模板即数据（`actions.ts`），换上衣/换裤子模板已被验证有效；多图顺序约定「第一张=人物、第二张=参考」与 `/api/jobs` 组装顺序一致（`route.ts:56-60`）。
- 参考图统一 1400px/0.92 降采样、主图提交前 1800px/0.94（`RefSlot.tsx:77`、`GenerateBar.tsx:236`）；请求体上限 20MB（`o1key.ts:16`）。模特(1800)+服装(1400) 单请求约 1-3MB，余量充足。
- `Stage.tsx` 的全局粘贴监听挂在组件 effect 里（`Stage.tsx:112-130`），批量模式下 Stage 不挂载即自动解除，粘贴通道可安全让给工坊。
- 测试基建已有：`npm run test:unit`（node --test + strip-types，`src/lib/__tests__/`）。
- 现有 UI 布局约定：卡片贴合图片真实比例、只设上限不强制外框（FreeRefList/PresetRefBox/ResultSlot 一致）；数量上限属交互规则可见，压缩/轮询等实现细节不进文案。

## 二、设计决策（定稿，勿重新论证）

- **D1 统一工坊，模式涌现**：一个「批量工坊」，模特栏 + 服装墙。1 模特=批量模式（网格视图），≥2 模特=全匹配（矩阵视图，行=服装、列=模特）。芯片实时显示「M 位模特 × N 件服装 → 生成 M×N 张」。（用户已确认）
- **D2 双工作区独立**：工坊状态放新建 `batchStore`（zustand 独立 store，理由同 logStore），与单图创作互不干扰、切换不丢；批量运行引擎为 store 层普通异步循环（不挂在组件生命周期上），切回单图创作不中断。
- **D3 每组合一次 POST /api/jobs**：count=1、baseImage=模特 i、refImages=[服装 j]、共用一条提示词。提交限流 3 并发；轮询单循环限 8 并发、按「最久未轮询优先」调度（50 任务约每 4-6s 轮到一次）。数字是引擎内部常量（`batchStore.ts`），不是共享交互规则，不进 `limits.ts`。
- **D4 上限常量**（`limits.ts`，客户端/服务端共用）：`MAX_BATCH_GARMENTS = 50`、`MAX_BATCH_MODELS = 6`（矩阵列宽可读极限）、`MAX_BATCH_TASKS = 100`（单次提交上限，超出禁生成并提示分批）。张数固定每组合 1 张，选择器隐藏。
- **D5 换装类型 = 模板选择**（新建 `src/lib/batchPrompts.ts`）：`智能识别`（默认，模型自判上装/下装/连衣裙替换对应部位）/ `上装` / `下装` / `连衣裙·套装`。上装/下装直接复用 `actions.ts` 里 swap-top/swap-pants 的已验证模板（import 引用，不复制文本防漂移）；智能/套装按同一套「只改一处、锁死其余」风格新写。切换类型整段重写提示词；手改后选择器显示「自定义」，再切类型则覆盖。
- **D6 服装墙全部同屏**：自适应网格——给定容器宽高与瓦片数（服装数+1 个添加入口），枚举列数取「最小格边长最大」的方案；格内图片完整显示（contain + 贴合真实比例），角标显示文件名（截断）。少图自动变大格。永不滚动。（用户已确认）矩阵视图例外：组合超屏时纵向滚动、行列头吸附（草图已注明并确认）。
- **D7 状态机与就地重试**：格子五态 `idle(未开始)/waiting(等待…)/running(百分比)/success(结果图)/failed(⚠重生成)`。失败就地单格重试；「停止」只把 waiting 退回 idle，已提交的继续轮询到收尾（钱已花，图要回）。运行期间锁定增删改模特/服装（按钮禁用 + toast 引导先停止）。
- **D8 结果去向**：结果即 `/api/media` 本地文件，全部自动进历史（复用现有 appendMeta + output/ 落盘）；`GenMeta` 增加可选 `note?: string`（「服装文件名 · 模特N」，record-only，同 refCount 模式不进 GenParams）。下载/打包命名 `服装文件名-模特N.png`。
- **D9 画布主图接力**：首次进工坊且模特栏为空时，单图创作画布的主图自动带入为模特 1（可删可换）；弹框「设为画布」反向把结果送回单图创作并切换模式。
- **D10 打包下载零依赖**：新建 `src/lib/zip.ts`——STORE 方式（不压缩，PNG/JPEG 本身已压缩）手写 ZIP（本地文件头 + 中央目录 + EOCD + CRC32，~150 行），文件名走 UTF-8 标志位（bit 11）保证中文名在 Windows 资源管理器正确显示；配单元测试。新路由 `POST /api/batch/export`。
- **D11 运行提醒**：批量运行中 `beforeunload` 挽留提醒（effect 挂 `Studio.tsx`——它常驻，工坊组件切走会卸载所以不能挂那里）；顶栏「批量工坊」标签在运行中带小进度环。
- **D12 会话不持久化（v1）**：刷新页面丢失批量看板（已轮询到的结果仍在 output/历史里）；「批量会话续跑」进待办池，不在本轮。

## 三、实施规格（T1–T8）

### T1 常量·类型·模板
- `src/lib/limits.ts`：追加 D4 三个常量（含 doc 注释，说明谁在用）。
- `src/lib/types.ts`：`GenMeta` 增加 `note?: string`（注释对齐 refCount：record-only，历史侧车向后兼容）。
- 新建 `src/lib/batchPrompts.ts`（零依赖，客户端/服务端共用）：`WearType { id: "auto"|"top"|"bottom"|"outfit"; label; buildPrompt() }`、`WEAR_TYPES`、`getWearType(id)`。top/bottom 用 `getAction("swap-top"/"swap-pants")!.buildPrompt()` 引用；auto/outfit 新写英文模板（第二张图为服装、只换对应部位/整套、锁脸型发型姿势背景光影、电商摄影收尾）。

### T2 批量 store 与引擎：`src/lib/batchStore.ts`（新建）
- 状态：`models: string[]`（≤6，入栏即 1800/0.94 降采样）、`garments: {src,name}[]`（≤50，1400/0.92）、`wearTypeId`、`prompt`、`promptEdited`、`params {model,resolution,aspectRatio,billing}`（首次进工坊从 `useStudio.settings.defaults` 初始化）、`cells: BatchCell[]`、`runState: "idle"|"running"|"done"`、`runId`。
- `BatchCell { key, modelIndex, garmentIndex, status, jobId?, resultUrl?, progress, startedAt?, lastPolledAt?, error? }`。
- 动作：模特/服装的 add/remove/replace（超限 toast 引用常量）；`setWearType`（重写 prompt）/`setPrompt`（置 edited）/`updateParams`；`startRun`（笛卡尔积建格，服装序优先，runId++，启动双循环）/`stopRun`/`retryCell`/`retryFailed`。
- 提交循环：3 并发取 waiting → `POST /api/jobs`（count:1、baseImage、refImages、prompt、params、`note`）；成功→running+jobId，失败→failed+错误文案；首个失败 diag error（来源「批量工坊」）。
- 轮询循环：每轮取 ≤8 个「最久未轮询」的 running → `GET /api/jobs/{id}`；success→resultUrl=images[0]；failed→error；网络错沿用 Studio 惯例按连续次数节流记 diag；轮间 sleep ~1.2s；双循环都以 `getState().runId === myRunId` 为存活条件（停止/重开即失效）。
- 收尾：无 waiting 且无 running → `runState:"done"`，toast「批量完成：x 张成功 · y 张未成功」，diag 记耗时。
- 每格显示进度 = max(真实 progress, 按 startedAt 走 `fakeProgressCurve`)，由 UI 层共享一个 500ms ticker 计算（不放 store，避免高频 set）。

### T3 模式切换：`store.ts` + `Studio.tsx`
- `useStudio` 增加 `workMode: "single"|"batch"` + `setWorkMode`（低频状态，留在主 store）。
- 顶栏 Logo 与右侧按钮组之间加居中双段切换（玻璃胶囊，选中态 accent；批量运行中「批量工坊」段带小进度环/圆点）。
- `<main>` 按 workMode 渲染：single → 现有 `Stage/GenerateBar/ResultView` 原样；batch → `BatchWorkshop/BatchBar`。切换不清任何状态。
- 切到 batch 时若 `batch.models` 为空且单图画布有主图：降采样后自动作为模特 1（异步，失败静默跳过）。
- `beforeunload` effect（依赖 batch runState）挂本组件。

### T4 工坊主体：`src/components/BatchWorkshop.tsx`（新建）
- **网格视图（1 模特）**：左列模特卡（完整显示，hover 更换/删除）+「＋添加模特」虚线块 +「加第 2 位即变全匹配」小字；右侧服装墙：ResizeObserver 量容器 → D6 算法定列数/格尺寸；格内自适应比例卡（沿用 w-fit + contain 语言）、文件名角标、hover 更换/删除。
- **矩阵视图（≥2 模特）**：CSS grid，首行=左上角空格+模特列头+「＋模特」，每行=服装行头+M 个格子；容器 `overflow-y-auto`，行头 `sticky left-0`、列头 `sticky top-0`（补底色防透视）；行头 hover「整行重生成/下载整行」。
- 两视图共用 `BatchCellView`（内部组件）：五态渲染 + 结果 crossfade（motion）+ hover 动作（对比/下载/重生成/设为画布；矩阵窄格只留对比/重生成，其余进弹框）。
- 上传：多选 input / 拖拽（服装墙区、模特栏区各自 onDrop + stopPropagation，遵循 RefSlot 挡冒泡惯例）/ 全局粘贴→加为服装；空态大虚线框文案对齐现有 Dropzone 语言（「拖入或点击添加服装 · 支持一次 50 张」）。
- 运行中锁编辑（D7）。

### T5 批量生成栏：`src/components/BatchBar.tsx`（新建，视觉同 GenerateBar 玻璃面板）
- 芯片行：「批量换装」+ 类型 Select（值=edited?"自定义":类型）+「M 位模特 × N 件服装」计数；运行中换成进度条 +「已完成 x/N · y 张未成功」+「■ 停止」；完成态「✓ 摘要 + ↻重试未成功 + ⬇打包下载 N 张」。
- 提示词 textarea + 参数行（复用 ui.Select，`resolutionsFor/comboError` 同款校验）+ 主按钮「⚡ 生成 N 张」（禁用条件：无模特/无服装/无提示词/组合非法/超 `MAX_BATCH_TASKS`/运行中；超限时琥珀色行内提示「单次最多 100 张，请分批」）。
- 令牌缺失同 GenerateBar：toast + openSettings。提交摘要 diag（模特数/服装数/类型/参数，不含 base64）。

### T6 对比弹框：`src/components/BatchLightbox.tsx`（新建，复用 ResultView 的壳与 CompareSlider）
- before=对应模特原图、after=结果；左下角服装缩略角标 + 文件名；动作：下载（`服装名-模特N.png`）/重生成/设为画布（`useStudio.setImage` + `setWorkMode("single")` + toast）；success 格间 上一张/下一张（含 ←/→ 键），Esc/遮罩关闭。

### T7 服务端：note 透传 + 打包导出
- `/api/jobs/route.ts`：解析可选 `note`（string、trim、截 120 字）→ `appendMeta` 带上。
- 新建 `src/lib/zip.ts`（server-only，D10）+ `src/lib/__tests__/zip.test.ts`（≥3 用例：单文件签名/多文件中央目录计数/中文名 UTF-8 位）。
- 新建 `src/app/api/batch/export/route.ts`（POST `{files:[{file,name}]}`）：`file` 校验 basename 格式并 resolve 限制在 `output/` 内（对齐 `/api/media/[name]` 的防穿越写法，实施前先读该文件）、`name` 去路径分隔符 + 重名加序号；读文件 → zip → `application/zip` attachment `tvision-batch-<ts>.zip`。客户端 fetch→blob→objectURL 下载。

### T8 验收与文档
- 验收清单见「五」；`HANDOFF.md` 追加当日条目、`README.md` 补「批量工坊」用法段、`DEV-PLAN.md` F3 打勾、踩坑当场记 `DEV-ERRORS.md`。

## 四、顺手核对（默认零改动，改前确认）
- `Stage/RefSlot/RadialMenu/ResultSlot/CropPanel/BrushPanel/actions.ts/o1key.ts`：批量不触碰单图链路，全部零改动。
- `Studio.tsx` 既有轮询/假进度 effect：只认 `useStudio.phase/jobIds`，批量引擎完全旁路，不受影响。
- `HistoryRail.tsx`：`note` 只记录不还原（`pick()` 按字段名显式列举，确认不会漏进 `updateParams`）。
- `historyMeta.ts`：500 条上限对 50 张/批足够，不动。

## 五、验收清单
1. `npx tsc --noEmit`、`npm run build`、`npm run test:unit` 全过。
2. 模式切换：两边工作区状态互不影响；单图全链路（预设操作/自由多参考/裁剪/画笔/视觉反推/历史还原）零回归。
3. 批量 1×50：一次拖 50 张全部上墙、同屏无滚动、每张完整显示；生成后出一张亮一张；总进度/停止/单格重试/重试全部未成功各自正确。
4. 全匹配 2×3：6 格「模特-服装」配对正确（逐格对照）；行列头吸附；≥2 模特自动切矩阵、删到 1 位自动回网格。
5. 上限：第 51 件服装 / 第 7 位模特被拒且 toast 正确；6×20=120 超 100 禁生成并提示分批。
6. 弹框：对比滑块、上一张/下一张、下载命名 `服装名-模特N.png`、设为画布跳回单图创作。
7. 打包下载：zip 内文件齐全、中文名在 Windows 资源管理器正常。
8. 历史：批量结果全部入库，侧车含 note；运行中刷新页面有挽留提示。
9. 真实令牌端到端（50 张实跑、费用与上游并发承受度）按惯例留用户本机验证。

## 六、风险与待实测
- **上游对快速连发 50 个任务的限流未实测**：若实测 429/拒收，降提交并发或加间隔，结论回填 DEV-ERRORS（同「各模型多图上限」待实测条目的处理方式）。
- 50 张 dataURL 缩略图驻留内存约 15-40MB，桌面 Chrome 可接受；如卡顿再做缩略图二次降采样（预留，不预做）。
- 打包导出一次性读 50 张 2K PNG（~100-200MB 缓冲）本地可接受；异常大时报错提示分批下载。
- 刷新丢批量看板（D12）为已知限制，文档写明。

## 七、明确不做（v1）
- 批量会话持久化/断点续跑（进待办池）。
- 每件服装独立类型/独立提示词；模特命名（固定 模特1/2/…）。
- 生成前二次确认弹窗（按钮上的张数即告知）；队列暂停/恢复（只有停止）；上游任务取消（接口无此能力）。
- 矩阵 CSV/表格导出；历史面板按批次分组展示。

## 通用要求
- 动手前完整读取每个待改文件；注释密度、中文文案、命名与现有代码一致。
- 用户可见文案不出现压缩/体积上限/并发数/轮询/重试等实现细节字眼（数量上限与「等待中/未成功」等状态属交互规则，允许；重试按钮文案用「重生成」）。
- 新图标先用 ESM 动态 import 验证存在（HANDOFF 惯例）；不新增依赖；不改任何 .bat；不 git commit（除非用户明确要求）。
