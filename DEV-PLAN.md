# TVision 总开发计划（DEV-PLAN）

> 唯一的任务总账：所有开发任务在此登记、打勾。
> 约定：① 大功能先写独立 `PLAN-*.md` 详细设计，这里只放可打勾的任务项与链接；② 每完成一项立即打勾（`- [x]`），整个功能验收通过后把该功能标记 ✅ 并在 HANDOFF.md 追加进度条目；③ 实施中踩到的坑当场记入 [DEV-ERRORS.md](./DEV-ERRORS.md)。

---

## 进行中

### F4 批量工坊（批量换装 1×N + 全匹配 M×N）　→ 设计定稿：[PLAN-BATCH.md](./PLAN-BATCH.md) · 执行快照：[PLAN-BATCH-STATUS.md](./PLAN-BATCH-STATUS.md)

统一工坊：模特栏 + 服装墙，1 模特=批量模式（自适应网格全同屏），≥2 模特=全匹配矩阵；每组合一次独立提交，格子即进度，就地重试，打包下载。草图与两项关键取舍（统一工坊 / 服装墙全同屏）已于 2026-07-12 经用户确认。T1–T3 于 2026-07-12 上午落地，T4–T8 当日晚间续作完成；`tsc` 零错误、单测 28/28 过、`npm run build` 通过。浏览器端交互与真实令牌实跑（验收清单 2-9 项）留用户本机验证。

- [x] T1 常量·类型·模板：`limits.ts` 批量三常量；`GenMeta.note`；新增 `batchPrompts.ts`（智能识别/上装/下装/套装）
- [x] T2 `batchStore.ts`：独立 store + 提交/轮询双循环引擎（3/8 并发、停止/单格重试/收尾汇总）＋灯箱状态
- [x] T3 模式切换：`useStudio.workMode` + 顶栏居中双段切换 + 画布主图接力为模特 1 + beforeunload（tsc 过，浏览器交互未验证）
- [x] T4 `BatchWorkshop.tsx`：模特栏 + 服装墙自适应无滚动网格（`packGrid` + ResizeObserver）+ 全匹配吸附矩阵 + 五态格子 + 上传/锁编辑 + 500ms 共享假进度 ticker
- [x] T5 `BatchBar.tsx`：类型选择（手改显示「自定义」）+ 计数芯片 + 参数/校验 + 生成 N 张（超 100 禁用并提示分批）+ 运行/完成态（停止·重试未成功·打包下载）
- [x] T6 `BatchLightbox.tsx`：前后对比弹框 + 服装缩略角标 + ←/→ 翻页 + 下载命名 `服装名-模特N.png` + 设为画布跳回单图
- [x] T7 服务端：`/api/jobs` note 透传（trim + 截 120 字入侧车）；`zip.ts`（手写 STORE zip，UTF-8 名标志位 + CRC32，单测 4 例 + .NET ZipFile 实际解包验证中文名）+ `/api/batch/export`（basename 防穿越、重名加序号）
- [x] T8 验收（可自动化部分：tsc / build / test:unit 全过）+ 文档收尾（HANDOFF / README / 本文件 / PLAN-BATCH-STATUS）
- [x] 追加：「通用替换」类型（跨行业——换鞋/换背景/换道具等）：`batchPrompts.ts` 加 generic 模板 + `batchNouns()` 名词包，全部界面文案/下载命名按类型切换「模特/服装」↔「主图/素材」（2026-07-12）
- [x] 追加：引擎去并发上限（用户要求效率极致）：全部 waiting 格单次原子认领后同时提交（50 格 = 50 个同时 POST），每格提交成功即 spawn 独立轮询循环（1.2s 间隔），谁先生成完谁先落盘亮格；停止/重试/收尾语义不变（2026-07-12）
- [ ] 浏览器端验收清单 2-9 项（1×50 全同屏、2×3 矩阵配对、上限 toast、弹框翻页、zip 中文名、历史 note、刷新挽留）+ 真实令牌 50 张实跑——留用户本机验证（通用替换的换鞋/换背景效果一并验证）

### F3 新增模型 GPT Image 2

走同一套异步任务接口（复用 Nano Banana 系的提交/轮询/落盘/历史链路），仅新增该模型专属的请求体构建与结果解析分支。参考实现依据 ComfyUI 插件 `comfyui_o1key/clients/gpt_image_client.py` 的异步版调用。详细改动记录见 HANDOFF.md 2026-07-12 追加条目。

- [x] 类型注册：`ModelName` 加 `"GPT Image 2"`；`MODELS`/`GPT_IMAGE_2_SIZE_TABLE`/`GPT_IMAGE_2_RATIOS`（`models.ts`）
- [x] 模型 ID 映射：`buildModelId()` 新分支，特价→`gpt-image-2-c`、官方→`gpt-image-2`
- [x] 请求体：`buildGptImageSubmitBody()`/`resolveGptImageSize()`（无 `aspect_ratio`，`size` 走档位或精确宽高；带 `quality`/`n`/`output_format`）
- [x] `/api/jobs/route.ts` 按 `isGptImage2(model)` 分流构建函数
- [x] 结果解析补洞：`extractResultImages()` 的 `url` 字段兼容内联 `data:image` 形式
- [x] UI：`GenerateBar.tsx` 比例下拉按模型置灰不支持项；切模型比例不兼容时静默回落 `auto` + toast；`comboError()` 加比例校验
- [x] 单测：`src/lib/__tests__/gptImage2.test.ts`（17 例，本仓库首批测试文件），`tsconfig.json` 加 `allowImportingTsExtensions` 配合 Node test runner 的 ESM 解析
- [x] 验证：`npx tsc --noEmit` / `npm run build` / `npm run test:unit` 均过
- [ ] 真实令牌实跑验证（文生图 + 图生图各一次，核对 `size`/`quality` 字段上游是否接受）——本轮执行环境无可用令牌，留待用户在本机验证

**本轮未做（有意搁置）**：`quality` UI 选项、`n>1` 单任务多图、gpt-image-2 原生 `mask` 参数（与现有裁剪回贴局部重绘方案不冲突，可留二期）、`error_detail.retryable` 驱动的自动重试。

### F2 多参考图 · 自由创作　→ 设计定稿：[PLAN-MULTI-REF.md](./PLAN-MULTI-REF.md)

不选预设操作，直接传多张参考图 + 自写提示词生成。主图=第 1 张图，参考图带序号徽标，上限 8 张（原定 6，2026-07-12 按用户要求调至"含主图共 9 张"）。

- [x] T1 状态与类型：新增 `limits.ts`；`store.refImage` → `refImages[]` 及全部重置点；`GenMeta.refCount`
- [x] T2 服务端 `/api/jobs`：`refImages[]` 解析组装 + 侧车 `refCount`
- [x] T3 `RefSlot.tsx` 多图化：预设单张不变，自由模式缩略图列表 + 序号徽标 + 移序/删除/更换 + 多选上传
- [x] T3b 上线后展示迭代 ×3（用户反馈驱动，草图确认制）：裁切修正 → 自适应比例卡片 → 自适应双列无滚动布局（8 张 + 添加入口一屏全可见），详见 PLAN-MULTI-REF「执行状态」
- [x] T4 `Stage.tsx` 多文件入口：拖/选/粘贴多张，第 1 张主图其余参考；自由模式显示参考图栏
- [x] T5 `GenerateBar.tsx`：校验/提交体/chip 文案/诊断摘要改多图
- [ ] T6 验收清单全过（见 PLAN-MULTI-REF 第五节）+ `npm run build` 通过
      　→ 已过：`npx tsc --noEmit` 零错误；`npm run build` 编译通过（首屏 92.5kB，无类型/lint 错误）。清单第 2-7 项（拖 3 张编号、真实生成 refs/refCount 落地、上限 toast、移序/删除即时刷新、预设回归、超大图报错可见）已逐条代码走查确认逻辑自洽，但需要真实浏览器交互 + 有效 o1key 令牌才能实跑，本轮执行环境不具备，留待用户在本机手动过一遍
- [x] T7 文档收尾：HANDOFF 追加、README 用法、本文件打勾

### F1 局部重绘历史修复　→ 设计定稿：[PLAN-INPAINT-FIX.md](./PLAN-INPAINT-FIX.md)

- [x] 六步代码实施（Stage 原始字节直存 / 提交边界降采样 / PNG 无损合成 / PUT /api/media 回传 / 裁剪 PNG）
- [ ] 验收：`npx tsc --noEmit` + 手动链路（>1800px 原图局部重绘 → 历史为原分辨率完整 PNG；×2 张、普通生成、视觉反推、裁剪全回归）
- [ ] 验收通过后按该文档约定删除 PLAN-INPAINT-FIX.md，并提交本轮工作树改动（需用户确认）

---

## 待办池（Backlog，源自 HANDOFF，未排期）

**P1 打磨与稳健**
- [ ] 径向菜单响应式：窄屏/竖长图下扇区溢出 → 缩半径或折叠列表
- [ ] 生成栏小屏：高级参数折叠抽屉，主行只留提示词 + 生成
- [ ] 轮询兜底：前端 5 分钟硬超时 + 手动取消/重试
- [ ] 多张批量每张独立进度

**P2 功能扩展**
- [ ] 自定义操作 UI（actions.ts 已配置化，做增删 + 提示词编辑界面）
- [ ] 预设风格库 / 提示词收藏与历史
- [ ] 电商规格尺寸一键导出（主图/详情/SKU）
- [ ] 批量队列 + 并发可视化　→ 已由 F4 批量工坊覆盖（见 PLAN-BATCH.md）
- [ ] i18n（当前中文硬编码）

**技术债**
- [ ] 令牌明文存 `data/settings.json`（可接 OS keychain）
- [ ] 本地无鉴权（单用户假设）

---

## 已完成里程碑

- [x] 第一轮 MVP：画布 + 弧形菜单 + o1key 异步链路 TS 移植 + 设置/历史（commit 92466b4）
- [x] 第二轮 品牌化 TVision + 设置简化 + 历史参数还原 + 快速裁剪 + 双扇区菜单（commit ee043fa）
- [x] 第三轮 画布生成闭环 + 假进度 + 内联参考图槽 + 双击启动器（commit 118ff37）
- [x] 第四轮 平铺动作 + 诊断台 + 视觉反推 + 画笔局部重绘（commit 3483296）
