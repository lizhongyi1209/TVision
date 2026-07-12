# 开发设计 · 多参考图自由创作（PLAN-MULTI-REF）

> 需求：不选任何预设操作，一上来直接传多张参考图，自己写提示词与参数完成生成。
> 本文档为定稿设计，按此实施即可；任务打勾在 [DEV-PLAN.md](./DEV-PLAN.md)，踩坑记 [DEV-ERRORS.md](./DEV-ERRORS.md)。

## 执行状态（2026-07-12）

T1–T5、T7 已实施完成（代码改动见下方 T1–T7 各节涉及的文件）；T6 验收中的自动化部分（`npx tsc --noEmit` 零错误、`npm run build` 编译通过）已过，清单第 2-7 项已逐条代码走查确认调用链自洽，但需要真实浏览器交互 + 有效 o1key 令牌才能完整实跑，本轮执行环境不具备，**留待用户在本机手动验证**。实施中额外发现并修复一处不在原规格文字里的 bug（`RefSlot.tsx` 上传/追加框未挡 drop 事件冒泡，详见 [DEV-ERRORS.md](./DEV-ERRORS.md) 2026-07-12 条目）。详细任务打勾见 [DEV-PLAN.md](./DEV-PLAN.md)，当日实施记录见 [HANDOFF.md](./HANDOFF.md)。

**上线后按用户反馈迭代 3 轮（详见 DEV-ERRORS/HANDOFF 同日追加条目），以下与定稿正文不一致处以此为准：**
1. 缩略图展示：`object-cover` 裁切 → `object-contain` → 最终定稿**自适应比例卡片**（卡片贴合图片真实比例，仅设高度上限，用户草图确认）。
2. **D3 上限调整：`MAX_REF_IMAGES` 6 → 8**（用户要求含主图共 9 张）；toast 文案自动跟随常量。
3. **T3 列表布局重做为「自适应双列 · 无滚动」**（用户草图确认）：废弃正文 T3 的 `max-h + overflow-y-auto` 竖排滚动方案——≤3 张单列、≥4 张双列，每张缩略图高度按行数均分画布可用高度（`min(52vh, (100vh-380px)/行数)`），8 张 + 添加入口全部一屏可见；双列时移序按钮方向改为左/右（`CaretLeft/CaretRight`），compact（有结果图）时仅保留更换/删除（与 `PresetRefBox` compact 同规格）。
4. 风险节「各模型多图数量上限未实测」在 8 张参考（9 图/请求）下风险增大，仍待用户真实令牌实测后回填。

## 一、现状事实（已核实，直接采信）

- 上游提交体 `SubmitBody.images?: string[]` **本就是数组**，`buildSubmitBody` 原样透传（`src/lib/o1key.ts:70`、`src/lib/o1key.ts:89`）→ o1key 客户端层**零改动**。
- 服务端目前把 `baseImage` + 单个 `refImage` 拼成 `images[]`（`src/app/api/jobs/route.ts:26`、`src/app/api/jobs/route.ts:42-46`）。
- 前端单值链：`store.refImage: string | null`（`src/lib/store.ts:36`）→ `RefSlot.tsx` 单槽上传（仅 `action?.needsRef` 时显示，`src/components/Stage.tsx:73`）→ `GenerateBar.generate()` body 带单个 `refImage`（`src/components/GenerateBar.tsx:266`）。
- 未选操作时**已经**允许自由写提示词生成（画布图为唯一图），缺的只是"多参考图"的状态、UI 与入口。
- 参考图上传时统一降采样 1400px/0.92 JPEG（`src/components/RefSlot.tsx:36`）；请求体上限 20MB（`src/lib/o1key.ts:16`）。
- 提示词约定按图片顺序指代："the first image / the second image"（`src/lib/actions.ts` 头注释）。

## 二、设计决策（定稿，勿重新论证）

- **D1 主图即第 1 张图**：不做"无画布纯参考"新模式。画布图 = images[0]，参考图依次为第 2、3…张。上游本不区分主图/参考，画布只是 UI 概念；沿用可保住对比滑块、设为画布、结果布局等全部现有机制。「一上来传多图」由 D5 的多文件入口满足。
- **D2 状态改数组**：`refImage: string | null` → `refImages: string[]`，一处状态两种用法：预设 needsRef 操作限 1 张（交互文案不变），自由模式（无 action）上限 `MAX_REF_IMAGES`。
- **D3 上限常量**：`MAX_REF_IMAGES = 6`，放新建零依赖共用模块 `src/lib/limits.ts`（o1key.ts 是 server-only 不能放）。超限 toast「最多添加 6 张参考图」。数量属交互规则可见，不算暴露实现细节。
- **D4 切换即清空**：选择**任何**预设操作、开画笔局部重绘、换主图、设为画布，均清空 `refImages`（与"预设操作覆盖提示词"同一破坏性语义，也修掉现状"残留 refImage 泄漏进白底图生成"的隐患）。
- **D5 舞台多文件 = 重置**：空态/有图态一致——舞台拖入/选择/粘贴 N 张：第 1 张设为主图（全分辨率），其余按序成为参考图（1400px 降采样）。追加参考图走参考图栏自己的入口。规则统一、可预期。
- **D6 序号徽标**：每张参考图缩略图带「图 2 / 图 3…」徽标（index+2），与提示词中"第 N 张图"指代一一对应；提供上/下移序按钮（不引入拖拽排序库）。
- **D7 不留旧字段兼容**：`refImage` 字段客户端/服务端同轮直接替换为 `refImages`，无外部调用方，不留死代码。

## 三、实施规格（T1–T7，与 DEV-PLAN 打勾项对应）

### T1 状态与类型：`limits.ts`（新增）+ `types.ts` + `store.ts`
- 新增 `src/lib/limits.ts`：`export const MAX_REF_IMAGES = 6;`（客户端/服务端共用，风格对齐 `visionModels.ts` 的零依赖共享模块）。
- `src/lib/types.ts`：`GenMeta` 增加可选 `refCount?: number`（历史侧车向后兼容，旧记录无此键）。
- `src/lib/store.ts`：
  - `refImage: string | null`（36 行）→ `refImages: string[]`，初始 `[]`（141 行）。
  - `setRef` 替换为：`addRefs(dataUrls: string[])`（内部 `slice` 兜底上限）、`removeRef(index)`、`replaceRef(index, dataUrl)`、`moveRef(index, dir: -1 | 1)`（越界 no-op）。
  - 全部重置点改 `refImages: []`：`setImage`(173)、`chooseAction`(210，按 D4 一律清空，不再保留)、`cancelAction`(241)、`openBrushPanel`(196)、`useResultAsCanvas`(291)。

### T2 服务端：`/api/jobs/route.ts`（o1key.ts 零改动）
- 26 行替换为：`refImages` 解析——`Array.isArray(body.refImages)` 时过滤 `typeof x === "string" && !!x` 并 `slice(0, MAX_REF_IMAGES)`，否则 `[]`。
- 42-46 行组装：`if (!textOnly) { if (baseImage) images.push(baseImage); images.push(...refImages); }`。
- `appendMeta`(62) 增加 `refCount: refImages.length`。

### T3 参考图栏：`RefSlot.tsx` 多图化（保留文件名/导出名）
- 预设模式（`action?.needsRef`）：上限 1，现有大上传框、`refLabel/refHint`、更换/移除、取消操作按钮**全部不变**。
- 自由模式（无 action）：
  - 竖排缩略图列表（compact 卡尺寸，`max-h` + `overflow-y-auto`），每张：「图 N」徽标、hover 显示 更换/删除/上移/下移。
  - 列表末尾「＋ 添加参考图」虚线小方块（零参考时仅显示这个轻量入口，不出现大框）；`<input multiple>`；drop 支持多文件。
- `handle` 改收 `File[]` 循环处理：逐张 image/* 校验、`fileToDownscaledDataURL(file, 1400, 0.92)`；超限只 toast 一次。

### T4 舞台入口：`Stage.tsx` 多文件
- `addFile` → `addFiles(files: File[])`：非图片过滤（有则 toast 一次）；第 1 张 `fileToDataURL` 全分辨率 `setImage`，其余降采样后 `addRefs`。**顺序要求：先 `setImage` 后 `addRefs`**（setImage 会清空 refImages，见 T1）。
- 文件输入（139 行）加 `multiple`；onDrop（128 行）传全部文件；粘贴处理（96-113 行）收集**全部**图片 item（去掉首个命中即 `break`）。
- `refVisible`(73)：`!!image && (!!action?.needsRef || (!action && !inpaintMask))`。
- Dropzone 副文案（38 行）追加多图提示，如「可一次多张：第 1 张为主图，其余作参考」。

### T5 生成栏：`GenerateBar.tsx`
- 订阅改 `refImages`；`needsRefMissing`(44)：`!!action?.needsRef && refImages.length === 0`。
- 提交 body（266 行）：`refImages: refImages.length && !inpaintMask ? refImages : undefined`（局部重绘分支不带参考图，双保险）。
- chip 区（324 行）：无 action 且有参考图时，替换「未选操作…」为「自由创作 · 已附 N 张参考图（提示词可用"第 2 张图"指代）」。
- diag 提交摘要（242-252 行）JSON 增加 `refs: refImages.length`（仍不含 base64）。

### T6 回归与验收
见「五、验收清单」，全部通过后在 DEV-PLAN 打勾。

### T7 文档收尾
- `HANDOFF.md` 按惯例追加当日条目；`README.md` 补一段多参考图用法。
- DEV-PLAN 对应项打勾；实施中踩坑当场记入 DEV-ERRORS。

## 四、顺手核对（默认无需改动，改前确认）
- `HistoryRail.tsx` 参数还原路径：新增的 `refCount` 只作记录，**不得**混入 `updateParams`/`GenParams`。
- `ResultSlot.tsx`/`CompareSlider.tsx`/`ImageNode.tsx`：不感知参考图，应零改动。
- 视觉反推（textToImage）：不带任何图的行为不变（服务端 `textOnly` 分支已保证）。

## 五、验收清单
1. `npx tsc --noEmit` 与 `npm run build` 零错误。
2. 空画布一次拖入 3 张 → 主图 + 「图 2」「图 3」，序号正确。
3. 不选操作：3 张参考 + 自写提示词（引用第 2/3 张图）→ 生成成功；诊断台提交摘要含 `refs: 3`；`data/history-meta.json` 对应记录含 `refCount: 3`。
4. 上限拦截：第 7 张被拒且 toast 文案正确。
5. 删除中间一张/移序后，序号立即连续刷新。
6. 预设回归：换上衣仍是单张参考流程；选任一预设操作后自由参考图被清空；白底图/裁剪/画笔局部重绘/视觉反推全不回归。
7. 罕见兜底：超大图 ×6 提交若超 20MB，服务端拦截错误在诊断台可见。

## 六、风险与待实测
- **各模型多图数量上限未实测**（旧款 nano-banana 可能仅支持少量输入图）：首次实测结论记入 DEV-ERRORS；若上游报错，再按模型收紧数量或提示，本轮不预设未证实的限制。
- 体积估算：6 × 1400px JPEG ≈ 2–4MB，远低于 20MB，无需调降采样参数。
- 多图语义混乱（模型分不清哪张是哪张）属提示词问题，靠序号徽标 + 指代提示缓解，不做代码层兜底。

## 七、明确不做
- 参考图持久化 / 历史还原参考图（现状也不存，行为一致）。
- 拖拽排序（按钮移序够用，不加依赖）。
- 无主图的纯参考图模式（D1 已覆盖需求）。
- 预设操作支持多参考（保持"第二张图"提示词语义）。
- 参考图用途标签。

## 通用要求
- 动手前完整读取每个待改文件；注释密度、中文文案、命名与现有代码一致。
- 用户可见文案不出现压缩/体积上限/轮询/重试等实现细节字眼（数量上限 toast 属交互规则，允许）。
- 不新增依赖；不改任何 .bat；不 git commit（除非用户明确要求）。
