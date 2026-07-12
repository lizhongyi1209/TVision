# 开发交接 · TVision

> 本地电商 AI 生图工作台。给「另一台电脑上的明天的你」看的接力文档。
> 代码地图和使用说明见 [README.md](./README.md);本文件只记**进度 / 状态 / 计划**。

---

## 一、今日进度（2026-07-08）

> **2026-07-09 总览（当日六件事，细节见下方各追加条目）**
> 1. **平铺上衣 / 平铺裤子**：两个新快捷动作，提示词智能兼容模特图与褶皱单品图，默认 1:1 + 2K。
> 2. **色彩锚定修色漂**：平铺提示词加入色彩锚定条款，修正暖光原图输出偏冷偏蓝的白平衡误判。
> 3. **诊断台**：顶栏常驻运行日志入口（红点未读提示）+ 生成失败就地错误卡片，取代一闪即逝的 toast。
> 4. **视觉反推**：`gemini-3.1-pro-preview`（思考=高）把图解析为 14 字段 JSON 提示词，文生图复刻原图；默认 Nano Banana 2 + 3:4。
> 5. **智能遮罩（已废弃）**：点选标注方案因红圈/编号被模型渗漏进成品而放弃，历史存档见下。
> 6. **画笔局部重绘**：替代智能遮罩的 crop-inpaint 方案——涂抹选区 → 裁包围盒送生成 → 结果羽化回贴，未涂区域像素零改动、无痕迹。左扇区工具入口。
>
> 验证：清缓存全新 `npm run build` 通过（首屏 193kB）；`data/`（令牌）确认未进 git；智能遮罩零残留。
> 已知：开发中一次 `next build` 撞挂了用户同目录的 `next start` 服务（详见文末技术坑），用户重启启动器即可恢复。

**2026-07-09 追加**：径向菜单新增「平铺上衣」「平铺裤子」两个快捷动作（`src/lib/actions.ts`，插在换裤子和换背景之间，`needsRef:false`，同白底图路径），提示词智能兼容模特图与褶皱单品图（自动判断人穿着 or 单品本身，统一重建为白底平铺电商图）；图标 CoatHanger / Belt（`icons.tsx` 注册，包里已有，无需替换）；径向菜单从 5 项扩到 7 项，`RadialMenu.tsx` 的 `pos()` 半径按数量动态加大，避免扇形边缘两项挤压重叠；平铺动作默认比例 1:1 + 分辨率 2K（`StudioAction` 新增可选字段 `defaultResolution`，`store.ts` 的 `chooseAction()` 按同一模式应用）；平铺提示词加入色彩锚定条款，修正暖光原图导致的色漂（实测暖光室内原图输出偏冷偏蓝偏亮，模型误判白平衡）。

**2026-07-09 追加（诊断台）**：错误此前只有 5.2s 自动消失的 toast，网络/生成失败用户几乎无感知，现补上常驻的运行日志入口。新增独立 Zustand store `src/lib/logStore.ts`（故意不并入主 store，避免高频日志写入触发主状态订阅者重渲）：环形缓冲 200 条、`unreadErrors` 未读 error 计数、`log/clear/markRead/togglePanel/openPanel/closePanel` 动作 + 便捷函数 `diag()` 供非组件代码直接调用。新增右侧抽屉 `src/components/DiagnosticsPanel.tsx`（对齐 SettingsPanel/HistoryRail 的玻璃抽屉风格，Esc/遮罩/关闭按钮三种关闭方式），日志最新在上，级别色点 + 时间 + 来源标签 + 消息，`detail` 可展开等宽 `<pre>` 并可一键复制，顶部工具行「复制全部 / 清空」。顶栏 Gear 旁新增 Pulse 图标入口（`icons.tsx` 新注册 Pulse/Copy），未读 error 时右上角红点；与设置/历史面板保持同一互斥组——panelOpen 状态留在 logStore 里，互斥联动放在 `Studio.tsx`（`onOpenSettings`/`onToggleHistory`/`onToggleDiagnostics` 三个 wrapper，各自互相关闭对方）和 `ResultSlot.tsx`（「查看诊断台」按钮），避免两个 store 相互 import 造成循环依赖。埋点覆盖：`GenerateBar` 提交（参数摘要 JSON，不含图片 base64）与提交结果；`Studio.tsx` 轮询——单任务失败、整体完成耗时、以及网络失败的连续计数（每个 job 的失败计数放在轮询 effect 闭包里的 `failCounts` 数组，第 1 次记 warn、连续第 5 次记 error，成功一次即清零，之后不再重复记）；`SettingsPanel` 测试连接成功/失败。`ResultSlot.tsx` 新增 `phase==="error"` 就地错误卡片（Warning 图标 + 错误文案 + 「查看诊断台」），`Stage.tsx` 的 `resultVisible` 补上 `phase === "error"` 分支，否则错误卡片所在的槽位根本不会渲染。

**2026-07-09 追加（视觉反推）**：径向菜单第 8 个动作「视觉反推」（`src/lib/actions.ts` 末尾，图标 `Eye`，`defaultAspect:"3:4"`、`defaultCount:1`、`defaultModel:"Nano Banana 2"`——新增的可选字段，`chooseAction()` 按 `defaultResolution` 同款模式应用到 `params.model`）：图 → 视觉大模型解析 → JSON 结构化提示词 → 自动填入提示词框 → 用户自行核对/编辑后手动点「生成」，做纯文生图复刻（不是 img2img）。新增 `src/lib/vision.ts`，与 `o1key.ts`（异步生图 API）刻意分开——这是网关同一 base URL 下另一套标准 OpenAI 兼容接口 `/v1/chat/completions`。视觉模型固定为 `gemini-3.1-pro-preview`（`src/lib/visionModels.ts` 的 `VISION_MODELS` 数组，客户端/服务端共用的零依赖模块，按顺序尝试；当前只有一项，账号可用性已实测确认，无需第二项兜底），思考强度用 `reasoning_effort:"high"`（新增请求字段，非该网关 `/async/v1/generateImage` 专用的 `thinking_level`——两个是不同端点的不同参数，已用官方 new-api 文档交叉核实），若某次请求因该参数被 400，`reverseEngineerPrompt()` 对同一模型自动去参重试一次（注释写明原因），仍失败才换 `VISION_MODELS` 里的下一项。system prompt 改为要求输出单个 JSON 对象、字段覆盖 scene/type/main_subject/secondary_elements/composition/camera/lighting/color_palette/materials_textures/background/style/text_elements/mood/quality（不适用的键可省略，颜色给 hex 估值，只写英文，不出现 markdown 围栏）。返回内容用 `normalizeVisionPrompt()` 尝试 `JSON.stringify(parsed, null, 2)` 美化整体填入提示词框；解析失败则原样填入原始文本并带 `parseWarning` 标记，前端弹提示 toast + 记 `diag warn`。图片来源有三种可能——新上传/粘贴/裁剪的 `data:` URL、历史记录或「设为画布」产生的本地 `/api/media/<file>` 相对路径、极少数落盘失败时的上游绝对 URL——网关在公网访问不到 localhost，`resolveImageToDataUrl()` 统一在服务端把后两种也转成真正的 `data:` URL 才发给视觉接口。路由 `src/app/api/reverse-prompt/route.ts`（校验令牌/图片/20MB 上限，风格对齐 `/api/jobs`）：内部单次上游调用 180s 超时（`AbortController`），失败返回 `{ error: 友好中文, detail: 原始响应 }`；成功返回 `{ prompt, model, parseWarning }`，只做图片理解，不创建生成任务、不写历史记录。`StudioAction` 的 `textToImage`（该动作生成时画布图整个不发上游，纯文生图）、`visionAnalysis`（标记需要触发解析的动作）两个可选字段沿用，`/api/jobs` 对应的 `textOnly` 字段与 `GenerateBar.generate()` 按 `action?.textToImage` 决定要不要带的逻辑本轮未动（`o1key.ts` 的 `buildSubmitBody` 本就在 `images` 为空数组时省略该字段）。解析的异步编排从 `RadialMenu.tsx`（选中后即卸载，之前只能靠闭包丢弃过期结果、无法真正取消请求）搬到 `GenerateBar.tsx`——其父组件始终挂载，只有自身返回值条件为 `null`，所以它的 `useEffect` 始终存活。新 effect 以 `[activeActionId, image?.src, visionRequestId]` 为依赖、内部建 `AbortController` 并在 cleanup 里 `abort()`，同时配合一个 `cancelled` 闭包标志兜底极窄的竞态窗口——`cancelAction`/`setImage`（换图）/组件卸载/切换到别的动作都统一由这一个机制覆盖，abort 后不写 store；`visionRequestId`（`store.ts` 新增，`chooseAction` 每次调用都自增，即使重选同一个 id）确保重新点击已激活但已失败的动作也能重新触发这个 effect。store 用 `visionProgress`/`visionStartedAt`/`visionError`/`visionRequestId` 四个新字段 + `beginVisionAnalysis`/`setVisionProgress`/`finishVisionAnalysis`/`failVisionAnalysis` 四个新 action 取代原来单一的 `analyzingVision` 布尔位（`analyzingVision` 保留，仍是解析中的判定依据），`chooseAction`/`cancelAction`/`setImage` 均已同步重置这些字段。`ResultSlot.tsx` 新增两张卡片，复用生成进度卡/生成失败卡的样式（`glass`/`aspect-[3/4]`/`rounded-panel` 等）：解析中卡片标题「视觉反推中」+ 大号百分比 + 阶段文案（读取画面…→分析构图与光影…→提取色彩与材质…→整理提示词…，`utils.ts` 新增 `fakeVisionProgressCurve`/`visionProgressStageLabel`，按 30-60s 典型耗时调校、封顶 95%，完成瞬间 `finishVisionAnalysis` 把 `visionProgress` 补到 1）；解析失败卡片标题「反推失败」+ 错误文案 + 「查看诊断台」按钮（同生成失败卡）。`Stage.tsx` 的 `resultVisible` 补上 `analyzingVision`/`visionError` 分支。`GenerateBar.tsx` 原有的提示词框禁用 + 占位符换文案 + 右上角/徽标转圈保留作为补充；新增空提示词拦截——`textToImage` 动作且提示词为空时点「生成」toast「请先完成视觉反推或输入提示词」（`canGenerate` 相应放宽：仅对 `textToImage` 动作允许提示词为空时按钮仍可点，其余动作行为不变）；完成时 toast「反推完成，请确认提示词后点击生成」。`diag()` 埋点（来源统一「视觉反推」）：开始（info，含模型名）、完成（info，耗时 + 提示词字数，完整提示词放 `detail`）、失败（error，原始响应放 `detail`）、parse 警告（warn）。径向菜单 8 项间距复算：外扩半径 272px，相邻两项圆心距恒为 70.33px（等角弦长的几何性质），最窄处（扇形边缘两对）纵向间距 50.10px，对比 44px（`h-11`）胶囊高度仍有 6.10px 净空，暂不需调整现有动态半径公式。

**〔状态：已废弃（标注渗漏进成品）〕** 下面两条「智能遮罩」记录仅作历史存档——点选定点+烘焙标注图的方案，其标注圈/编号徽标是直接画在发给模型的「第二张图」上的可见像素，模型偶发会把这些标注本身（红圈、白描边、编号徽标）当成内容线索渗漏进生成结果里，且 o1key 接口本身也没有原生 mask 参数可用；已被「画笔局部重绘」（crop-inpaint，见下方 2026-07-09 追加条目）整体替换，代码已在阶段①清空，相关文件均不存在。

**2026-07-09 追加（智能遮罩，已废弃）**：径向菜单第 9 个动作「智能遮罩」（`src/lib/actions.ts` 末尾，图标 `Crosshair`——`@phosphor-icons/react` 里确认存在，直接用，未走 `MapPin`/`CircleDashed` 兜底；`needsRef:false`，新增可选字段 `usesMarkers:true`）：解决「说不清楚改哪里」的问题——不是真正的像素级遮罩，而是纯视觉指向：在图上点几下标出要改的位置，标记烘焙成第二张「标注图」和原图一起发给模型，提示词让模型「照第二张图里编号圈住的位置改第一张图」。选中该动作只弹出新建的 `src/components/MarkerPanel.tsx`（`Studio.tsx` 里挂载，风格照抄 `CropPanel.tsx`：遮罩 + 玻璃弹框 + Esc/背景点击关闭），不像其余动作那样直接进生成栏。面板左侧图片区点击加标记（最多 6 个，超出 toast 提示）、可拖拽移动、每个标记右上角编号徽标 + 左上角 ✕ 删除（删除即按数组序重新编号，不依赖内部稳定 `id`）；右侧列表每行编号 + 备注输入框（占位「这里改什么（可选）」）+ 小/中/大三档尺寸（`r` 分别 5%/8%/12%，默认中）+ 删除按钮。图片区用 `object-contain` 撑满容器，点击/拖拽坐标换算专门处理了 letterbox 留白（按图片真实渲染矩形折算百分比，不是简单按容器尺寸算，否则非等比容器下会算错）。标记的 `x/y/r` 都按原图**自然尺寸**的百分比存储（`r` 相对短边），与 `CropPanel` 的百分比换算约定一致，因此与实际显示大小无关。「确认标记」一次做三件事：① `utils.ts` 新增 `bakeMarkersToDataURL()`——canvas 按原图自然尺寸重绘，叠加所有标记（描边 `max(6px, 短边 0.5%)`、红色 `#FF3B30`、白色描边做外发光、内部浅红半透明填充 `rgba(255,59,48,0.15)`、白底红字编号徽标随 `r` 缩放字号），`toDataURL("image/jpeg",0.92)` 后写入既有的 `refImage` 通道（`setRef`）——复用换背景/换上衣同一条「第二张图」链路，`/api/jobs/route.ts` 和 `o1key.ts` 的 `buildSubmitBody` 本来就不按 `needsRef` 过滤 `refImage`、只按 `textOnly` 过滤，所以这条链路**无需任何服务端改动**即可让 `needsRef:false` 的动作也把 `refImage` 当第二张图发出去（已读代码逐层确认，非猜测）；② 按模板拼提示词写入 `params.prompt`——全部标记都没写备注时用统一措辞（含中文占位符「【在这里描述要做的修改】」，**逐字保留不翻译**，留给用户自己替换），只要有一个标记写了备注就切换成按编号分条列出的版本，未写备注的标记退化成「apply the main requested change here」；③ 关闭面板 + toast（无备注「已标记 N 处，请补充修改描述后生成」/ 有备注「已标记 N 处，确认提示词后点击生成」）+ `diag("info","智能遮罩",...)` 记标记数。重新点「确认标记」永远整段重写提示词，若检测到用户在两次确认之间手动改过提示词（用当前标记集反推出「应有」提示词与实际值比对，而非存一份易失效的旧值），先补一条「提示词已按最新标记更新」的 toast 再覆盖——两条 toast 用 `setTimeout` 错开 3s，因为 toast 只有单槽位，同步连续调用会互相顶掉。面板内部用本地 `draft` 状态编辑（未确认前不碰 store，语义上完全对齐 `CropPanel` 的本地 `crop` 状态 + 显式提交），「取消」只关面板不落盘；若这是该动作第一次进面板（`refImage` 还是空，说明从未确认过），「取消」额外调用 `cancelAction()` 整个退回空闲态，避免留下一个半吊子的已选中动作。`store.ts` 新增 `markers`/`markerPanelOpen` 状态 + `setMarkers`/`openMarkerPanel`/`closeMarkerPanel` 三个 action；`chooseAction` 选中 `usesMarkers` 动作时清空 `markers` 并置 `markerPanelOpen:true`，`cancelAction`/`setImage` 同步清空。`RefSlot.tsx` 标记类动作只在 `refImage` 就绪后出现（`Stage.tsx` 的 `refVisible` 补上 `usesMarkers && refImage` 分支），角标文案换成「标记预览」，悬浮态只露一个「重新标记」按钮（调 `openMarkerPanel`，标记不清空），不出现更换/移除（那是上传语义，这里不适用）。`GenerateBar.generate()` 新增两道提交前校验：`markers` 为空 → toast「请先标记要修改的位置」+ 自动 `openMarkerPanel()`；提示词里仍残留占位符「【在这里描述要做的修改】」→ toast「请先在提示词中描述要做的修改」并拦截提交（`canGenerate` 本身不拦，保持能点按钮才能触发这两条具体引导，沿用视觉反推那版「先放行按钮、点击时再 toast」的既有约定）。径向菜单从 8 项扩到 9 项，沿用同一动态半径公式（`R + (n-BASE_N)*R_STEP`）自动算出 312px 半径，无需改公式/改 `R_STEP`：复算得最窄处（扇形边缘两对）纵向间距 49.51px，对比 44px（`h-11`）胶囊高度仍有 5.51px 净空。

**2026-07-09 追加（智能遮罩排障，已废弃）**：用户反馈标记 2 处并各填了备注，「确认标记」后提示词却是无备注的占位符版本——备注没进提示词。先做实证排查「是否在跑旧构建」这一假设：比对源码 mtime（16:22:26）与 `.next/BUILD_ID`（16:26:49，晚于源码）与用户 `npm run start` 进程创建时间（`Get-CimInstance Win32_Process`，16:37:31，晚于构建）；`Get-NetTCPConnection -State Listen` 确认 3000 端口只有这一个监听进程，桌面同级目录也搜过没有第二份工程/第二个服务；最终用 curl 抓实际返回的 HTML、解析出引用的 JS chunk 哈希，再 curl 那个 chunk 原文与磁盘 `.next/static` 里同名文件 `diff`——**逐字节完全一致**。字符串级 grep 两个提示词分支的特征文本在产物里「都存在」这个初筛结论特意没采信，因为三元/if-else 两个分支源码本就会同时编译进 bundle，字符串存在与否和运行时走哪条分支无关；byte-diff 才是真正站得住的证据。结论：「跑的是旧构建」这个假设不成立，服务端此刻 serve 的就是当前最新构建。随后逐层复审运行时链路——`MarkerPanel.tsx` 本地 `draft` 状态更新、`updateNote`/`onConfirm` 闭包、`Studio.tsx` 挂载方式是否会导致重挂载丢状态、`store.ts` marker 相关 action、`GenerateBar.tsx` 对 `params.prompt` 的绑定、`ui.tsx` 里 `Button`/`Segmented` 是否有记忆化钉住旧闭包——未发现可复现的逻辑 bug；备注输入框是受控 `<input>`，其 `onChange` 属于原生 discrete event，按 React 18/19 语义会在同一次物理点击序列里、早于备注框失焦所触发的按钮 `click` 完成同步 flush，正常路径下 `draft` 到 `onConfirm` 执行时已经是最新值。鉴于没有浏览器自动化工具可用、无法真正重放用户那一次真实点击/输入/（不能排除的）中文输入法组字时序，选择"实证 + 加固"双轨：① 把 `buildPromptFromMarkers` 抽成零依赖纯函数模块 `src/lib/markerPrompt.ts`（新增 `countNotedMarkers` 导出，结构化 `MarkerNote` 类型，不依赖 `store.ts` 的 `Marker`），配 6 条回归用例 `src/lib/__tests__/markerPrompt.test.ts`（其中一条直接复刻本次线上 bug 场景：2 个标记均填备注→必须是分条列出版本且备注逐字保留），跑在 Node 内置 `node --test --experimental-strip-types`（本仓库此前无任何测试框架，不新增依赖），`package.json` 新增 `npm run test:unit`；② `onConfirm` 里加一段**运行时 DOM 核对**——「确认标记」执行时不直接信 React 的 `draft`，而是按 `data-marker-note-id` 把每个备注输入框的**当前 DOM 真实值**取出来跟 `draft` 逐个比对，不一致就以 DOM 为准（用户眼见为实）并 `diag("warn",...)` 留痕（含具体哪些标记 ID 漂移），这是唯一一层真正能兜住「哪怕未来某次回归让 `onChange` 没接上、或极端时序下状态与画面不同步」的防线，而不是一个证明不了有效性的 blur() 空调用（最早写了一版靠 `.blur()` 强制失焦再读 `draft` 的方案，复核后发现是无效的——`draft` 是这次函数调用闭包住的绑定，函数内部再调 blur 也不可能倒着改掉已经捕获的值，遂改成现在这版真正读 DOM 现值的实现）；③ toast/diag 从「有没有备注」的布尔判断改成精确「已附说明 X／共 Y 处」三态文案（0 处 / 全部 / 部分），比通用成功提示更容易让用户一眼发现「我明明填了但没生效」。`npm run build` 类型检查 + `npm run test:unit`（6/6）均过；全程未 commit、未碰 `data/`、用户自己那个 `npm run start`（PID 27516, :3000）只读探测、未重启。

**2026-07-09 追加（智能遮罩 → 画笔局部重绘，产品决策变更，阶段①完成）**：智能遮罩（点选定点纯视觉指向方案）被整体替换为「画笔局部重绘」（用户在图上涂抹选区 → 裁选区包围盒送生成 → 结果羽化回贴原图，crop-inpaint 方案），原因是 o1key 接口没有原生 mask 参数，只能走纯前端裁剪-重绘-回贴。三阶段计划：①干净移除智能遮罩全部代码；②画笔面板 + 左扇区入口 + store 涂抹态；③局部重绘提交路径（裁包围盒送生成）+ 结果回贴合成（`Studio.tsx` 轮询改造，多张结果各自合成）。**阶段①已完成**：删除 `MarkerPanel.tsx`/`markerPrompt.ts`/`markerPrompt.test.ts`；`actions.ts` 移除 `usesMarkers` 字段与 `smart-mask` 动作条目（径向菜单 9→8 项，`RadialMenu.tsx` 的 `pos()` 沿用同一动态半径公式按 `ACTIONS.length` 自动收窄，未改代码）；`store.ts` 移除 `Marker` 类型、`markers`/`markerPanelOpen` 状态及 `setMarkers`/`openMarkerPanel`/`closeMarkerPanel` 三个 action；`RefSlot.tsx`/`Stage.tsx`/`GenerateBar.tsx`/`Studio.tsx` 各自回退标记分支（`RefSlot.tsx` 回退后与 git HEAD 逐字节零差异，`git diff` 验证过，证明清理彻底无残留）；`utils.ts` 移除 `bakeMarkersToDataURL`；`icons.tsx` 移除仅供智能遮罩使用的 `Crosshair`。`npm run build` 通过，首屏 JS 89.5kB→85.6kB。`package.json` 的 `test:unit` 脚本保留未删（通用 Node test runner 基建，非智能遮罩专属，阶段③大概率要为包围盒裁剪/羽化混合数学写同款纯函数回归测试，`src/lib/__tests__/` 空目录等阶段③复用）。**阶段②③已完成**（协调者补发的正文规格，取代此前两次落空的「见 content」引用）：

①**画笔面板 + 左扇区入口**：`RadialMenu.tsx` 左扇区 `TOOLS` 数组新增第 2 项「局部重绘」，图标 `PaintBrush`（`node --input-type=module` 动态 import 方式实测确认 `@phosphor-icons/react` 里存在——`node -e "require(...)"` 的 CJS 探测法对这个包会假阴性，webpack/Next 实际走的是 ESM 解析，以动态 import 结果为准；一次到位未走 Paintbrush/Brush/PenNib 兜底），点击走新的 `onTool()` 分发到 `openBrushPanel()`；TOOLS 仍是 2 项，远小于 `BASE_N`，半径公式不受影响。新建 `src/components/BrushPanel.tsx`（玻璃容器 + Esc/点遮罩关闭，仿 `CropPanel.tsx`），letterbox 换算逻辑照 `CropPanel.tsx` 的约定重新手写（原 `MarkerPanel.tsx` 那版从未进 git，`git log` 查过确认无提交记录可抄，只能按同一套 `scale=min(容器宽/自然宽,容器高/自然高)` 公式重建）；指针拖动画圆形笔刷描边，accent 色 40% 透明度实时预览；工具行含粗细滑块/橡皮擦切换/撤销/清空；`strokes:{points:{x,y}[]（0-1 相对渲染区）;sizeRel;erase}[]`，每次 state 变化整段重绘（不做增量描边，简单可靠优先）。

②**mask/bbox/padding/羽化最终参数**：笔刷直径 = 图短边 2%~20%，默认 8%（`MIN_SIZE/MAX_SIZE/DEFAULT_SIZE`）；包围盒扩边 `BBOX_PAD_RATIO=0.08`（短边 8%），扩边后 clamp 到 `[0,自然宽/高]`；羽化半径 `FEATHER_RATIO=0.015`（短边 1.5%）。**有一处对原始规格文字做了功能性修正，如实说明**：规格原文说 mask 画布"填黑+白色描边+羽化"，但阶段③回贴合成用的是 `globalCompositeOperation="destination-in"`——这个操作吃的是源图的**alpha 通道**，不是 RGB/亮度；若真做成不透明黑底+白线（全图 alpha=255），`destination-in` 会让整块结果原样通过，等于羽化形状完全失效、退化成硬边矩形贴图。改为**透明背景 + 不透明白色描边**，再整体模糊，让 alpha 通道本身承载黑白羽化信息（这也更贴合规格自己的命名「羽化 alpha mask」）。另外模糊步骤没有按字面「对同一 canvas 自身重绘」（跨浏览器对「画布模糊时把自己画进自己」有已知的未定义/花屏风险），改成画到第二块离屏 canvas 上（`ctx.filter=blur()` 作用于绘制时，不作用于原画布），结果等价但规避了该风险。

③**提交与合成链路改动位置**：`src/components/GenerateBar.tsx` 的 `generate()` 函数内，紧跟既有 `cErr` 校验之后、`beginSubmit()` 之前，新增 `inpaintMask` 非空分支——校验提示词非空、`cropImageToDataURL` 裁 bbox 区块（新增 `quality` 可选参数，`utils.ts`）、`setInpaintJob` 存快照、提交 body 用裁块替换整图且 `aspectRatio` 强制 `"auto"`。`src/components/Studio.tsx` 的轮询 `finish()` 由同步改 `async`：`inpaintJob` 非空时对每张返回图调用新增的 `compositeInpaintResult()`（`src/lib/utils.ts`，内部用 `loadImage()` 新辅助函数加载原图/mask/结果三张图，裁 bbox 区域 mask 配 `destination-in` 得羽化块，贴回原图尺寸 canvas 的 bbox 坐标位置，`toDataURL("image/jpeg",0.94)`），`await Promise.all` 前后各一道 `cancelled` 检查（跟本文件里已有的「异步取消双保险」惯例一致），单张合成失败会分别 `try/catch` 回退未合成结果并 `diag warn`，不影响其余张。

④**图标最终选型**：`PaintBrush`（左扇区入口，第一选择即命中，未走兜底链）、`Eraser`（画笔面板橡皮擦切换）、`ArrowCounterClockwise`（撤销），均已加入 `icons.tsx` 的导入列表与 `MAP`。

⑤**两阶段 build 结果**：阶段②`npm run build` 通过，首屏 JS 85.6kB→90.1kB，无类型/lint 错误；阶段③`npm run build` 通过，90.1kB→90.6kB，无类型/lint 错误。

**一处超出规格字面枚举、经推理补做的联动**：规格枚举的 `clearInpaint` 触发点是 `chooseAction`/`cancelAction`/`setImage` 三处，但没提 `openBrushPanel` 本身要不要清 `activeActionId`。径向菜单可在选中某个需要参考图的右扇区动作后重新打开、改选左扇区画笔——若不清，会同时存在「已选中一个需要参考图的动作」和「已设涂抹区」两种状态，`GenerateBar.generate()` 里既有的 `needsRefMissing` 校验排在新的局部重绘分支之前，会误把合法的局部重绘提交拦成「请先上传参考图」。为保证规格自己期望的「画笔态与 AI 动作态互斥」真正成立，让 `openBrushPanel` 额外清了 `activeActionId`/`refImage`；`useResultAsCanvas` 换图路径原规格只写"仅 useResultAsCanvas/setImage 换图时清（②已含）"，也一并确认补上了 `clearInpaint`。全程未 commit/push，未碰 `data/`（`git status --porcelain -- data/` 验证为空），用户自己那个 `npm run start` 本轮全程确认已不在、未重启。

**⚠️ 技术坑（本轮踩到，记录避免重蹈）**：`npm run build`（`next build`）与 `npm run start`（`next start`）若指向同一个 `.next` 输出目录，**不要在 `next start` 还活着的时候重复跑 `next build`**——本轮在验证阶段①改动时对着用户正在跑的 `npm run start` 所在目录重新 `npm run build`，几分钟后发现该 `npm run start` 进程（原 PID 27516,:3000）已消失、端口无监听，时间线高度吻合（构建产物 `BUILD_ID` 完成时间与进程消失时间前后仅差几分钟），推断是 Windows 下 `next build` 覆写 `.next` 内文件时与 `next start` 持有的文件句柄冲突，导致后者非正常退出（Windows 文件锁比 POSIX 严格，Node 未必优雅处理）。这不是刻意的 kill/restart，但违反了「不碰用户自己起的服务」的约定，属于本轮工作流程失误，非环境必然如此——**结论：验证类 build 若明知有人正用同目录 `next start` 提供服务，应避免重复执行，或改用独立 `--outDir`/临时目录构建后再比对，不要直接对着生产目录反复 build。**

**2026-07-12 追加（多参考图 · 自由创作，PLAN-MULTI-REF 落地）**：新需求——不选任何预设操作，一上来直接传多张参考图，自己写提示词与参数完成生成（此前只有换上衣/换裤子/换背景这类预设操作能带一张参考图）。设计定稿见 `PLAN-MULTI-REF.md`，本轮按文档 T1-T7 实施。核心决策：主图即第 1 张图，不做"无画布纯参考"新模式——上游本不区分主图/参考，画布只是 UI 概念，沿用现有对比滑块/设为画布等全部机制；`store.ts` 的 `refImage: string | null` 改为 `refImages: string[]`，一处状态两种用法——预设 needsRef 操作仍限 1 张（交互文案/大上传框/更换移除/取消操作按钮全部照抄不变），自由模式（未选任何预设操作）上限 `MAX_REF_IMAGES = 6`（新增零依赖模块 `src/lib/limits.ts`，风格对齐 `visionModels.ts`，因为 `o1key.ts` 是 server-only 不能放共享常量）；新增 `addRefs/removeRef/replaceRef/moveRef` 四个 store action 取代原来的单一 `setRef`。**顺带堵上一个既有隐患**：原来 `chooseAction` 选中不需要参考图的动作（如白底图）时会保留旧 `refImage`（`a.needsRef ? null : s.refImage`），而 `/api/jobs` 组装 `images[]` 时只看 `refImage` 是否非空、根本不检查这次动作是否 `needsRef`——也就是说用户先做过一次换上衣上传了参考图，之后不清空直接切到白底图生成，那张换装参考图会静默地被当成第二张图一起发给模型。本轮改为选中任意预设操作一律清空 `refImages`（不再区分 needsRef），这个隐患随之消失。服务端 `/api/jobs/route.ts`：`refImages` 改从 `body.refImages` 数组解析（`Array.isArray` + 过滤非空字符串 + `slice(0, MAX_REF_IMAGES)`），组装 `images[]` 时 `if (baseImage) push; push(...refImages)`（`o1key.ts` 的 `buildSubmitBody`/`images?: string[]` 本就是数组透传，零改动）；`appendMeta` 侧车新增 `refCount`（`GenMeta.refCount?: number`，历史侧车向后兼容；`HistoryRail.tsx` 的 `pick()` 按字段名逐个传给 `updateParams`，不会把这个新字段带进 `GenParams`，顺手核对过不用改）。`RefSlot.tsx` 拆成两个内部子组件共享同一个 `refImages` 数组：`PresetRefBox`（`action?.needsRef` 时渲染，和多参考图之前的实现逐像素一致，只是把 `refImage`/`setRef` 换成 `refImages[0]`/`replaceRef(0,·)`/`removeRef(0)`）、`FreeRefList`（无 action 时渲染，竖排缩略图列表 + `max-h-[54vh] overflow-y-auto`，每张左上角"图 N"徽标——N = 数组下标 + 2，与 `actions.ts` 提示词里"the first image/the second image…"按顺序指代的约定对齐——hover 露出更换/上移/下移/删除四个小圆按钮，`CaretUp`/`CaretDown` 新注册进 `icons.tsx`；列表末尾常驻一个虚线"＋ 添加参考图"小方块，支持点击选图/多文件拖入，零参考时列表为空、只剩这块入口，不出现预设模式那种大框）。**顺手挖到并修了一个不在原规格文字里、但推理后判断必须修的 bug**：`RefSlot.tsx` 的上传/添加框全都嵌套在 `Stage.tsx` 外层那个 `onDrop` 容器内部，且两边都没调用 `stopPropagation()`——原生 drop 事件默认冒泡，这意味着直接拖文件到参考图框上会同时触发框自己的 `onDrop`（正确处理）和 `Stage` 外层的 `onDrop`（把同一批文件当成"新主图+新参考图"重置一遍，参考图刚加进去又被清空、主图也被换掉）。这个问题在多参考图上线前也存在（预设模式的大上传框同样没挡冒泡），但当时只有选中 needsRef 操作才会露出这个框，触达面很窄；这轮自由模式下"＋ 添加参考图"变成默认可见的常驻入口，问题会被高频触发，所以在 `PresetRefBox` 和 `FreeRefList` 两处的 `onDrop` 里都加了 `e.stopPropagation()`（未触碰各缩略图本身——按 D5，直接拖到缩略图上冒泡触发整体重置是符合预期的"舞台级"行为，只有两个专用上传入口需要拦截）。`Stage.tsx`：`addFile(file)` 改成 `addFiles(files: File[])`——非图片项过滤、文件输入加 `multiple`、拖拽/粘贴都改为收集全部图片项（粘贴处理原来遇到第一张图片就 `break`，现在收集所有）；第 1 张走 `fileToDataURL` 全分辨率 `setImage`，其余走 `fileToDownscaledDataURL(f,1400,0.92)` 后 `addRefs`（严格保证 `setImage` 先执行——它会把 `refImages` 清空——`addRefs` 后执行才不会被一并清掉）；`rest` 数组落地前按 `MAX_REF_IMAGES` 先 `slice`，避免对注定会被丢弃的多余文件做无意义的降采样；空画布/已有画布拖入行为统一为"重置"（D5），复用同一个 `onDrop`。`GenerateBar.tsx`：订阅改 `refImages`；`needsRefMissing` 改 `refImages.length === 0`；提交 body 的 `refImage` 换成 `refImages: refImages.length && !inpaintMask ? refImages : undefined`（局部重绘分支强制不带参考图，双保险）；未选操作时的 chip 文案按有无参考图分两态——零参考仍是"未选操作 · 点击图片选操作，或直接写提示词"，有参考图变成"自由创作 · 已附 N 张参考图（提示词可用"第 2 张图"指代）"；提交诊断摘要 JSON 加 `refs: refImages.length`（不含 base64）。验证：`npx tsc --noEmit` 零错误；`npm run build` 编译通过（首屏 92.5kB，此前含局部重绘的基线是 90.6kB，涨幅符合新增参考图列表/按钮的代码量）——build 前发现 3000 端口正跑着这个项目自己的 `next start`（PID 15256，当天 12:14 启动，就是上面记录过的"build 覆写 .next 可能冲掉 start"那个坑），当面问过用户后得到「服务无所谓，直接 build」的答复才执行，build 完成后复查该进程仍在监听、未被冲掉。验收清单第 2-7 项（空画布拖 3 张的编号、真实生成 + `refs`/`refCount` 落地、超限 toast、移序删除即时刷新、预设回归、超大图报错可见）逐条对着代码走查过调用链，逻辑自洽，但没有真实 o1key 令牌和浏览器交互能力，无法真正端到端跑一遍，留给用户在本机验证（`DEV-PLAN.md` 的 T6 已如实标注这一点，未打勾）。全程未碰 `data/`、未改任何 `.bat`、未 git commit。

**2026-07-12 追加（多参考图 · 缩略图裁切修正）**：用户上线后实测反馈，自由模式参考图列表的缩略图把竖版人像参考图裁得只剩局部（截图可见只剩肩膀/下巴一小条）。根因：`RefSlot.tsx` 的 `FreeRefList` 缩略图用 `object-cover` 配固定高度横向框，宽高比不匹配时裁切填满会丢内容；同文件里预设模式的大预览框 `PresetRefBox` 本来就用 `object-contain`（完整显示），自由模式新写的列表项没照抄这一点，属于本轮实施疏漏。修正：缩略图 `object-cover` → `object-contain`，容器补 `bg-panel-2` 垫底色（避免比例不满填满时露出的留白区域是裸露背景）。`npx tsc --noEmit` 复核通过。已记入 DEV-ERRORS.md。

**2026-07-12 追加（多参考图 · 缩略图改自适应比例，taste-skills 参考）**：上一条修正只解决了"内容被裁"，用户接着反馈外框仍是固定高度的宽矩形，人像图被挤成中间一条窄图、两侧留一大截黑边，"不太好看"，要求先出草图确认再动手。用户点名参考本机 `~/.claude/skills` 下的 `taste-skills`（`design-taste-frontend`/`-v1`/`gpt-taste`/`stitch-design-taste`）：读过之后发现这几个技能主要面向落地页/营销站/仪表盘这类从零设计场景（Hero 排版、Bento 网格、GSAP 滚动编排），其自身的「Out of Scope」也明确说密集型产品 UI 不归它管；本次能直接拿来用的是其中通用的品味原则——Shape Consistency Lock（尺寸/圆角体系全项目统一，不为一处另起一套）、反对"强制外框比例造成大片留白/留黑边"、Redesign-Preserve（小范围修复优先复用项目里已验证的展示模式，而不是发明新视觉语言）。据此比对发现：项目里 `PresetRefBox`（单参考大图）、`ResultSlot`（结果图）、`ImageNode`（画布图）全部是"卡片贴合图片真实比例，只设尺寸上限，不强制外框"，唯独这轮新写的 `FreeRefList` 用了固定高度的宽矩形框，是本轮实现里唯一的例外，也是问题根源。用 `AskUserQuestion` 出了三个 ASCII 草图供选（自适应比例单列 / 双栏方形网格 / 单列 3:4 定框），并各自标注了取舍（自适应比例零留白但列表高度不整齐；双栏更紧凑但收窄状态下四个悬浮按钮太挤；3:4 定框比现状好但横版参考图仍会留边），用户选定"自适应比例"。落地：`FreeRefList` 缩略图去掉固定高度（`h-16`/`h-28`），改为 `w-full object-contain` + 仅设上限高度，且上限数值直接复用同文件里 `PresetRefBox` 已有的 `compact ? "max-h-[200px]" : "max-h-[52vh]"`（未新造数值，尺寸体系保持统一）——常规参考图（竖版人像、商品图、横版场景图）现在都按自己的真实比例渲染，`max-h` 只在极端比例时兜底触发 `object-contain` 的留白。`npx tsc --noEmit`、`npm run build` 复核均通过。已更新 DEV-ERRORS.md 对应条目（把两步修正合并写成一条，记录最终方案而非中间态）。

**2026-07-12 追加（多参考图 · 上限调 9 张 + 列表改无滚动自适应双列）**：用户第三轮反馈——缩略图预览已对，但图片一多就得滚到列表最底部才够得着「＋ 添加参考图」，明确预期"一共可上传 9 张（含主图），全部在画布中完美展示，不要滚动条"。沿用草图确认制，`AskUserQuestion` 出 3 个 ASCII 方案（自适应双列 / 统一等高网格——已注明会重现上一轮否掉的留白裁切 / 主图下方横向胶片条——改动大且缩略图小），用户选定**自适应双列**。落地两件事：① `src/lib/limits.ts` 的 `MAX_REF_IMAGES` 6 → 8（含主图共 9 张；toast 文案、`Stage.tsx`/`route.ts` 的 slice 全部引用常量自动跟随，零散改动）；② `RefSlot.tsx` 的 `FreeRefList` 布局重做：删掉 `max-h-[54vh] overflow-y-auto` 滚动容器，改为 ≤3 张单列、≥4 张自动切 `grid-cols-2`，每张缩略图 `maxHeight = min(52vh|200px, (100vh - 380px) / 行数)`（380px = 舞台行 pt-8/pb-[232px] 上下留白 + 添加条 + 行间隙的总预算，行数 = `ceil(张数/2)`，公式写进了代码注释）——满员 8 张 + 添加条在任意窗口高度都一屏放下，永不滚动；卡片延续上一轮确认的自适应比例（grid 车道内 `w-fit max-w-full` 收缩包裹图片、居中摆放，竖图横图零留白零裁切）；双列时移序按钮从上/下箭头换成 `CaretLeft/CaretRight`（新注册进 `icons.tsx`，仍按惯例先用 ESM 动态 import 验证存在）且 title 改"前移/后移"（双列下视觉流向是左右+折行，上/下箭头会误导），compact 态（有结果图时列表车道仅约 71px 宽）放不下四个悬浮按钮，只保留更换/删除——与 `PresetRefBox` compact 态的既有规格一致，移序在全尺寸视图操作。文档同步：README 用法段（6 张 → 8 张/共 9 张一屏展示）、PLAN-MULTI-REF「执行状态」补 3 轮迭代与正文差异清单、DEV-PLAN F2 简介与新增 T3b 打勾项、DEV-ERRORS 新增"滚动容器兜多图"教训条目。验证：`npx tsc --noEmit` 零错误；`npm run build` 通过（首屏 93.1kB）——**build 前照例查了 3000 端口**，仍是本项目自己的 `next start`（新 PID 17268），按用户此前「服务无所谓，直接 build」的答复执行，这回进程真的被 build 冲掉了（DEV-ERRORS 2026-07-09 那个坑复发），当场 `npm run start` 后台重新拉起（顺带跑上新构建），netstat + curl 200 验证恢复，该条 DEV-ERRORS 已补记复发与"build 完立即重启验证"的预防项。**遗留提醒**：上游各模型多图输入上限仍未实测（DEV-ERRORS 待实测条目），8 张参考 = 单请求 9 图，旧款 nano-banana 有可能拒收，需用户真实令牌实测后回填结论。全程未碰 `data/`、未改任何 `.bat`、未 git commit。

### 第一轮：从零搭好 MVP

从零搭好一个**端到端可用的 MVP**,并已验证可编译、可起服务、o1key 线路可达。

**技术栈**：Next.js 15.5 (App Router) · TypeScript · Tailwind v4 · Motion 11 · Zustand · Phosphor · Geist。Node 24。

**已完成（全部落地）**
- [x] 画布：拖 / 点 / 粘贴添加图片,弹簧入场,聚光灯,指针微倾斜（motion value,无逐帧重渲染）
- [x] 点图 → **弧形快捷菜单**：换上衣 / 换裤子 / 换背景 / 白底图 / 动作裂变（配置化,`src/lib/actions.ts`）
- [x] 需要参考图的操作 → **玻璃上传浮层**,客户端自动压缩到 <20MB
- [x] **生成栏**：提示词（按操作预填「只改这处、其余不变」模板）+ 模型 / 分辨率 / 比例 / 计费 / 张数,非法组合拦截
- [x] **o1key 异步 API 的 TS 移植**（`src/lib/o1key.ts`）：提交 → 轮询 → 取图 → 落盘,忠实对齐技能里的 `generate_image.py`
- [x] 本地后端 Route Handlers：`/api/jobs`（提交+轮询）、`/api/settings`(+test)、`/api/media`、`/api/history`
- [x] **结果**：前后对比滑块 + 批量胶片条 + 下载 / 设为画布继续编辑
- [x] **设置**：令牌（固定全球加速线路）、测试连接;令牌只存本机
- [x] **历史图库**：output/ 落盘,缩略图,载入画布,删除
- [x] 完整交互态：加载扫描动效、错误就地提示、reduced-motion、暗色锁定、玻璃材质

**已验证**
- `npm run build` 通过（类型全过,首屏 173kB）
- `npm run dev` / `npm run start` 正常起服务
- 冒烟测试：`/`、`/api/settings`、`/api/history`、`/api/jobs`、连接探测全绿
- **`api.o1key.cn` 从本机可达**：假令牌探测拿到 `401 令牌被拒绝` → 说明提交/轮询全链路只差真实令牌即可跑通

**尚未做**（明日 P0）
- 真实付费出图未跑（需真实令牌）。链路已验证到「鉴权」这一步。

### 第二轮：品牌化 + 体验迭代（已 commit：ee043fa）

- [x] **品牌重塑 TVision**（元流视觉 / tokenflow vision）：SVG 标记「token 短划流入镜头」+ favicon（`src/app/icon.svg`）+ 头部字标（`src/components/Logo.tsx`）+ metadata + 包名改 `tvision` + 下载文件名前缀 `tvision-`
- [x] **设置面板简化**：只剩令牌输入 + 只读的全球加速线路 + 测试连接；删掉「o1key 接入」标题、自定义 Base URL、默认生成参数区块。服务端同步收紧：POST /api/settings 只接受 apiKey/clearApiKey，旧 data/settings.json 里的多线路 / baseUrlOverride 读取时自动清洗（`readSettings` 逐字段构造）
- [x] **顶栏清理**：移除参数徽章（Nano Banana Pro · 2K）
- [x] **舞台布局修复**：图片在「顶栏与生成栏之间」居中（容器 pb 预留生成栏高度），最大高度 `calc(100dvh-380px)` 随视口伸缩，不再被生成栏遮挡
- [x] **生成栏**：移除「按 o1key 计费」文案
- [x] **Bug 修复**：`setImage`（新建 / 换图）现在清空提示词 / 比例 / 张数（模型 / 分辨率 / 计费保留）；「设为画布继续编辑」仍保留提示词（有意）
- [x] **历史还原**：提交生成时把 prompt/模型/分辨率/比例/计费/张数按任务 ID 写入 `data/history-meta.json`（`src/lib/historyMeta.ts`，上限 500 条，best-effort）；点历史图 = 载入画布 + 还原整组参数（侧车没有记录的旧图只载入）
- [x] **快速裁剪**（`src/components/CropPanel.tsx`，依赖 `react-image-crop@11`）：默认 1:1 居中选区、自由拖动缩放、8 组比例预设；百分比换算原图像素后本地 canvas 裁剪；`replaceImage` 只换图不清提示词。注意坑：该库自带 CSS 会用 `max-height: inherit` 顶掉 img 上的高度类，上限要挂在 ReactCrop 根节点上
- [x] **径向菜单双扇区**：左侧快捷小工具（目前只有裁剪，镜像布局），右侧原有五个 AI 操作；顶栏裁剪按钮已移除
- [x] `.gitignore`：`/data/settings.json` 收紧为整个 `/data/`

### 第三轮：部署上线 + 画布生成闭环（本轮随本次 commit 提交）

- [x] **部署验证**：`npm ci` → `npm run build` → `npm run start`（:3000）全绿；冒烟测试 `/`、`/api/settings`、`/api/history` 全 200；`api.o1key.cn` 可达（假令牌 → 401 被拒，链路只差真令牌）
- [x] **双击启动器**（`启动 TVision.bat`）：已在运行则直接开浏览器；缺 node_modules 自动 `npm ci`、缺构建产物自动 build；服务挂在最小化「TVision Server」窗口（关窗即停）；最多 60s 就绪轮询后自动开浏览器。**坑：中文 .bat 必须 GBK + CRLF 落盘**（UTF-8 或 LF 会被 cmd 逐行切碎报「不是内部或外部命令」），本文件已转换，勿用会改编码的编辑器另存
- [x] **上传弹窗 → 内联参考图槽**：删除 `UploadPopover.tsx`，新增 `RefSlot.tsx`。选「换上衣 / 换裤子 / 换背景」后，上传槽以 ⊕ 连接符内联出现在原图右侧（点击 / 拖拽上传，悬停更换 / 移除，下方可取消操作）；store 移除整套 `uploadOpen` 弹窗态；换裤子提示语与换上衣统一口径
- [x] **假进度曲线**：按单张 20-60s 真实耗时调校的分段减速曲线（10s≈31% / 20s≈52% / 40s≈78% / 70s+ 封顶 96%，完成瞬间补 100%；多张批量整体放慢 1.2 倍），配四档阶段文案（理解图片 → 构图 → 绘制细节 → 即将完成）；真实轮询完成度写入 `realProgress` 做抬底合成，纯函数在 `utils.ts:fakeProgressCurve`
- [x] **结果上画布闭环**（`ResultSlot.tsx`）：生成中右槽显示进度卡（大号百分比 + 阶段文案 + 细进度条），完成后原地切换为结果大图，**不再自动弹框**；点结果图 → 前后对比弹框（`ResultView` 改为显式受控 `resultsOpen`，画布与弹框共享 `resultIndex`）；多张结果画布下方胶片条切换
- [x] **成功态三列布局**：`[原图(中)] ⊕ [参考图(小 compact)] → [结果图(最大)]`；参考图**常驻**且 compact 态仍可悬停更换 / 移除（快速换参考图再生成的迭代闭环）；尺寸层级 结果(≤62vh/480px) > 原图(≤46vh/380px，`.stage-image-compact`) > 参考(≤200px)
- [x] **界面文案脱敏**：删除「自动压缩到 20MB 以内」等实现细节文案（压缩逻辑保留，静默执行）；约定 UI 不出现压缩 / 体积上限 / 轮询 / 重试等字眼
- [x] **默认模型 → Nano Banana 2**：`settings.ts` / `store.ts` 默认值 + 本机 `data/settings.json` 三处同步（id `nano-banana-2` 原生在列表，2K + 特价默认组合兼容），接口实测已返回新默认

**2026-07-12 追加（新增模型 GPT Image 2）**：接入 o1key 的 `gpt-image-2` 系列，走同一套异步任务接口（`POST /async/v1/generateImage` → 轮询 `GET /async/v1/tasks/{id}`），与 Nano Banana 系全部共用，本轮只改了模型分支的请求体构建与结果解析，没碰轮询/落盘/历史链路。参考实现依据是 ComfyUI 插件 `comfyui_o1key` 里已跑通的 `clients/gpt_image_client.py`（异步版）。**模型 ID**：`ModelName` 新增 `"GPT Image 2"`，`buildModelId()` 里单开一支——特价 → `gpt-image-2-c`，官方 → `gpt-image-2`，与分辨率无关（不像 nano-banana-* 按档位拼后缀），映射表 `GPT_IMAGE_2_MODEL_ID`（`o1key.ts`）。**请求体**：GPT Image 2 没有 `aspect_ratio` 字段，比例信息全靠 `size` 表达——新增 `buildGptImageSubmitBody()`/`resolveGptImageSize()`，比例=自动时 `size` 直接发档位字符串（`1K/2K/4K`），比例在预设表内时换算成精确宽高（`models.ts` 新增 `GPT_IMAGE_2_SIZE_TABLE`，1K/2K/4K × 7 个比例，数值照抄 ComfyUI 节点里的同一张表），额外带 `quality`（本轮固定 `"auto"`，未加 UI）、`n`、`output_format` 三个 nano-banana 分支没有的字段；`/api/jobs/route.ts` 按 `isGptImage2(model)` 分流调 `buildGptImageSubmitBody` 还是原 `buildSubmitBody`，`submitTask()` 的参数类型放宽成两种 body 的联合（内部只做 `JSON.stringify`，无需收窄）。**比例约束**：`GPT_IMAGE_2_RATIOS`（`auto/1:1/3:4/4:3/2:3/3:2/9:16/16:9`）之外的比例在 `GenerateBar.tsx` 的比例下拉里置灰（`Select` 的 `options[].disabled`，`ui.tsx` 组件本身已支持，未改）；`comboError()` 加第四个可选参数 `aspectRatio`，GPT Image 2 时额外校验；切模型时 `onModel()` 若发现残留比例不在该模型支持范围内，静默回落 `"auto"` 并 toast 提示（复用现有 `showToast`，不是新机制）。**结果解析补洞**：`extractResultImages()` 原先 `url` 字段只认 `http` 开头，`data:image;base64,...` 形式的内联结果会被 `addUrl()` 的前缀校验直接吞掉——gpt-image-2 有概率把结果放在这种内联 `url` 字段里（不止 nano-banana 用的独立 `b64_json`/`base64` 字段），改成 `addUrl()` 内部按前缀分流：`http` 走原 URL 下载路径，`data:image` 转手交给 `addB64()`，两种情况共用同一份 `seen` 去重集合，不引入新状态。**测试**：新增 `src/lib/__tests__/gptImage2.test.ts`（17 例，`buildModelId`/`resolveGptImageSize`/`comboError`/`buildGptImageSubmitBody`/`extractResultImages` 各角度覆盖，含 `data:image` URL 兼容那条回归用例），本仓库此前无 `__tests__` 目录，这是第一批测试文件。**踩坑**：Node 内置 test runner（`node --test --experimental-strip-types`）用真实 ESM 解析，相对导入不带扩展名会在运行时报 `ERR_MODULE_NOT_FOUND`（Next.js 的 bundler 解析模式对此宽容，之前从未暴露）——`o1key.ts` 新增的 `import { GPT_IMAGE_2_SIZE_TABLE } from "./models"` 和测试文件里的导入都得写成 `"./models.ts"`/`"../o1key.ts"` 显式扩展名；但 `tsconfig.json` 默认不允许 import 路径带 `.ts` 后缀（`TS5097`），加了 `allowImportingTsExtensions: true` 后 `tsc --noEmit` 和 `next build` 都过（项目本就 `noEmit:true`，这个选项不影响任何产物）。**验证**：`npx tsc --noEmit` 零错误、`npm run build` 编译通过（首屏 93.3kB）、`npm run test:unit` 17/17 通过；未接入真实令牌实跑（无可用 o1key 令牌），下一步 P0 待办里加一条「用真实令牌跑一次 GPT Image 2 文生图+图生图，核对 `size`/`quality` 等字段真实上游是否接受」。**本轮未做**（有意搁置，见 `DEV-PLAN.md`）：`quality` 的 UI 选项、`n>1` 单任务多图、gpt-image-2 原生 `mask` 参数（现有局部重绘走的是裁剪回贴方案，两者不冲突，原生 mask 留作二期）、`error_detail.retryable` 驱动的服务端自动重试。

**2026-07-12 追加（批量工坊 · F4 全量落地，PLAN-BATCH T1–T8）**：新顶层工作区「批量工坊」上线——顶栏中间双段切换（单图创作 | 批量工坊），给 1–6 位模特批量试穿最多 50 件服装，1 位模特是网格视图（服装墙全部同屏、格子随数量自适应缩放、永不滚动），加到第 2 位自动切全匹配矩阵（行=服装、列=模特，行列头吸附、超屏纵向滚动），单次上限 100 张（超出禁生成并提示分批）。**当日上午实施至 T3 暂停，晚间续作 T4–T8 完成**。分层：状态与引擎全在独立 zustand store（`src/lib/batchStore.ts`，独立建店理由同 logStore——50 格高频进度不惊动主 store 订阅者），提交/轮询是模块级 async 双循环（3 并发提交、轮询每轮 8 个按「最久未轮询」取、runId 失配即自杀），每个「模特×服装」组合独立 `POST /api/jobs`（count=1，note=「服装名 · 模特N」），切回单图创作引擎照跑；组件只读状态派发动作——`BatchWorkshop.tsx`（T4：模特栏+服装墙，`packGrid()` 枚举列数取「最小格边长最大」+ ResizeObserver 实现全同屏；五态格子 waiting「等待…」/running 百分比/success 结果 crossfade/failed ⚠重生成；hover 动作 对比/下载/重生成/设为画布，矩阵窄格只留对比/重生成；矩阵行头带整行重生成/下载整行；多选/拖拽/全局粘贴上传，模特 1800/0.94、服装 1400/0.92 沿用两侧既有降采样惯例；运行中锁编辑 toast 引导先停止；进度显示用 500ms 共享 ticker 取 max(真实进度, fakeProgressCurve(startedAt))，不写回 store）、`BatchBar.tsx`（T5：玻璃面板对齐 GenerateBar；类型 Select 手改提示词后显示「自定义」；生成按钮禁用条件含超 100 琥珀提示；运行态进度条+已完成 x/N·y 张未成功+停止；完成态重试未成功+打包下载）、`BatchLightbox.tsx`（T6：复用 ResultView 弹框壳 + CompareSlider，before=模特原图；左下服装缩略角标；success 格间 ←/→ 翻页 + Esc 关闭；下载命名「服装名-模特N.png」；设为画布跳回单图）。**服务端（T7）**：`/api/jobs` 解析可选 `note`（trim + 截 120 字）进 `appendMeta` 侧车（record-only，HistoryRail 的 pick() 不会带进 updateParams）；新增 `src/lib/zip.ts`——零依赖手写 STORE zip（本地头+中央目录+EOCD+查表 CRC32，~110 行，文件名 UTF-8 标志位 bit 11 保证中文名在 Windows 资源管理器正确显示；DOS 时间戳固定为格式纪元使产物字节稳定利于测试）+ `zip.test.ts` 4 例（签名顺序/中央目录计数/中文名 UTF-8 位/CRC32 标准校验向量 0xCBF43926），并额外用 .NET `ZipFile` 实际解包验证过中文文件名逐字符相等、内容无损；新增 `POST /api/batch/export`（body `{files:[{file,name}]}`，`file` 走 `path.basename` 防穿越 + 扩展名白名单——对齐 `/api/media/[name]` 的写法，`name` 去路径分隔符 + 重名自动加 (2)/(3) 序号，一次上限 200 个文件）。**存量小改**：`batchStore.ts` 续作时补了 `clearGarments`（服装墙「清空」）并把 `retryCell` 放宽到 success 格也可重生成（弹框/hover 的「重生成」需要）。**验证**：`npx tsc --noEmit` 零错误、`npm run test:unit` 28/28、`npm run build` 通过（首屏 103kB，/api/batch/export 已进路由表）——build 前照例查 3000 端口（本项目 next start，PID 22896），按用户既往「服务无所谓」的答复执行，build 后端口仍存活但按 DEV-ERRORS 预防项**主动重启到新构建**（Stop-Process → npm run start 后台拉起 → netstat + curl 200 验证，新 PID 28592）。**留用户本机验证**：验收清单 2–9 项（浏览器交互：1×50 全同屏、2×3 矩阵配对、上限 toast、翻页、zip 中文名、历史 note、刷新挽留）与真实令牌 50 张实跑（上游对快速连发的限流承受度，PLAN-BATCH §6 风险项）。全程未碰 data/、未改 .bat、未 git commit。

**2026-07-12 追加（批量工坊 · 新增「通用替换」类型，跨行业适配）**：用户提出批量工坊不应局限服装领域（还会用于换鞋子、换背景等其他行业），本轮加第 5 个批量类型「通用替换」。**模板**：`batchPrompts.ts` 的 `WearType.id` 联合加 `"generic"`，`WEAR_TYPES` 追加通用模板——让模型自己识别第二张图是什么（garment / footwear / bag / background / product / prop…）并替换第一张图中的对应元素，特判「第二张图是背景/场景时保持主体不动、替换场景」，其余沿用同一套「只改一处锁死其余」措辞，收尾从 fashion e-commerce 放宽为 commercial photography。**界面名词跟随类型**：同文件新增 `BatchNouns` 接口 + `batchNouns(wearTypeId)`——换装类叫「模特/服装」（量词 位/件，芯片「批量换装」，图标 CoatHanger），通用替换叫「主图/素材」（量词 张/个，芯片「批量替换」，图标 ImageSquare，已在 icons.tsx 注册无需新增）；`BatchWorkshop`（栏标题/角标/空态/添加入口/矩阵行列头/锁定 toast/兜底文件名）、`BatchBar`（芯片/计数/placeholder/超限提示/zip 内命名）、`BatchLightbox`（标题/图标）、`batchStore`（上限 toast/名单重置 toast/diag 摘要/note「素材名 · 主图N」）全部改为按当前 wearTypeId 取名词，下载命名相应变为「素材名-主图N.png」；手改提示词（自定义）不动 wearTypeId，名词跟随最后选中的类型。零新状态、零结构改动——纯模板 + 文案层扩展，引擎/矩阵/打包链路不感知类型。**验证**：`npx tsc --noEmit` 零错误、`npm run test:unit` 28/28、`npm run build` 通过；build 后 3000 端口进程照例 Stop-Process → `npm run start` 重启到新构建（新 PID 9732，curl 200）。通用模板的实际替换效果（换鞋/换背景实跑）留用户真实令牌验证。

**2026-07-12 追加（批量工坊 · 引擎去并发上限，全量同时提交 + 每格独立轮询）**：用户明确要求把效率做到极致——即使 1 模特 × 50 服装也要全部同时并发，谁先响应先下载谁。重写 `batchStore.ts` 引擎：删掉原「3 并发提交工人 + 单轮询循环每轮 8 个按最久未轮询调度」的限流结构（`SUBMIT_CONCURRENCY`/`POLL_ROUND_SIZE`/`SUBMIT_IDLE_SLEEP_MS` 常量与 `submitWorker`/`claimNextWaiting`/`claimStalestRunning`/`runPollLoop`/`pollOneCell` 一并移除），改为：① `pumpWaiting(runId)`——单次原子 setState 认领全部未认领 waiting 格后一口气 fire 所有 POST（50 格 = 50 个同时在途的 `/api/jobs`），原子认领保证 pump 与运行中重试竞态也不会双重提交；② 每格提交成功当场 spawn 自己的 `pollCellLoop`（间隔仍 1.2s，仅剩常量 `POLL_INTERVAL_MS`）——所有 running 格并行各自轮询，上游谁先完成，它自己的下一次轮询立即发现并由服务端落盘（`/api/jobs/[id]` 成功即下载，本就逐任务独立），完全不受其他格影响；轮询循环自带退出条件（终态 / runId 失配 / 格被重试重置回 waiting——重试提交会再 spawn 新循环）。`ensureEngineRunning` 顺带增强：运行中发起的单格重试现在即时 pump（原实现要等提交工人空轮询捡起）。行为不变项：stopRun 仍只删 waiting、已提交的继续轮到收尾；runId 存活判定、checkCompletion 收尾汇总、锁编辑、假进度 ticker 全部不动；zip 打包本就是读本地现成文件，无涉。**风险提示（已知取舍）**：50 个同时 POST 意味着 Next dev/start 单进程要同时处理 50 个含 base64 的请求体 + 上游收到 50 连发，PLAN-BATCH §6 的上游限流风险敞口变大，若实测 429/拒收需回填 DEV-ERRORS 再议节流。**验证**：`npx tsc --noEmit` 零错误、`npm run test:unit` 28/28、`npm run build` 通过；3000 端口照例重启到新构建（新 PID 20196，curl 200）。

---

## 二、在另一台电脑无缝继续

> 令牌与生成图**不进 git**（安全 + 体积）,所以新机器要重填令牌、历史从空开始,这是预期行为。

1. **拿到代码**（三选一）
   - 推到你自己的 GitHub/Gitee，再 `git clone`（注意：本沙盒访问 github.com 受限，**推送请在你自己有 VPN 的机器上做**）
   - 或用云盘 / U 盘拷贝整个 `TVision` 文件夹，**但排除 `node_modules`**
2. **装依赖**：`npm ci`（用锁定版本，最稳）或 `npm install`
3. **起服务**：`npm run dev` → http://localhost:3000
4. **重填令牌**：右上角 ⚙ 设置 → 填 o1key 令牌 → 保存（可先「测试连接」）
5. 环境要求：Node ≥ 18.18（本机用的 24.x）

首屏 dev 首次编译要 ~10s，之后秒开，属正常。

---

## 三、明日计划 / 待办（按优先级）

### P0 · 跑通真实出图链路
- 填真实令牌，跑一次「白底图」和「换背景」，确认：提交→轮询→`output/` 落盘→历史→前后对比全通。
- 若上游返回结构与移植假设有出入：调 `src/lib/o1key.ts` 里的 `extractTaskId / extractStatus / extractResultImages`（已尽量鲁棒地扫描嵌套字段，但真实响应可能需微调）。
- 确认计费/分辨率组合与后台一致。

### P1 · 打磨与稳健
- **径向菜单响应式**：窄屏 / 竖长图时左右两个扇区（左工具 / 右操作）可能溢出视口 → 缩小半径或折叠成列表。
- **生成栏小屏**：参数多时换行拥挤 → 折叠「高级参数」到抽屉，主行只留提示词+生成。
- **轮询兜底**：目前无前端硬超时（靠上游）。加 5 分钟兜底 + 手动「取消 / 重试」。
- **进度体验**：已有整体假进度曲线；多张批量可进一步做每张独立进度。

### P2 · 功能扩展
- 局部涂抹遮罩重绘（引入 Konva 图层，仅此场景）。
- 自定义操作 UI（`actions.ts` 已配置化，做个增删界面 + 提示词编辑）。
- 预设风格库 / 提示词收藏与历史。
- 电商规格尺寸包一键导出（主图 / 详情 / SKU）。
- 批量队列 + 并发可视化。
- i18n（当前中文硬编码）。

### 技术债 / 注意
- 令牌明文存 `data/settings.json`（本地单用户工具可接受；要更严可接 OS keychain）。另有 `data/history-meta.json`（生成参数侧车，用于历史还原），非敏感信息。
- 无鉴权，假设本地单用户。
- 图片走请求体 base64（已客户端压缩 <20MB，超大图会被后端拦）。

---

## 四、状态快照
- 第一 / 二 / 三轮均已 commit；工作树干净后继续开发
- 入口：`src/components/Studio.tsx`（编排 + 轮询 + 假进度引擎）；画布槽位 `Stage.tsx` → `RefSlot.tsx`（参考图）/ `ResultSlot.tsx`（进度卡 + 结果图）；对比弹框 `ResultView.tsx`（受控 `resultsOpen`）；裁剪弹窗 `CropPanel.tsx`；画笔局部重绘弹窗 `BrushPanel.tsx`（`MarkerPanel.tsx` 已随智能遮罩废弃删除，不再存在）；双扇区菜单 `RadialMenu.tsx`
- 日常启动：双击根目录「启动 TVision.bat」（GBK+CRLF，勿改编码）
- 默认模型：Nano Banana 2（2K · 特价）
- 品牌：TVision（元流视觉 / tokenflow vision），主题色即品牌色（`--color-accent` 琥珀）
- 依赖新增：`react-image-crop@11`（裁剪 UI，零依赖）
- API 契约来源：已装技能 `o1key-nano-banana`（`references/api.md` + `scripts/generate_image.py`），逻辑已内联到 `src/lib/o1key.ts`，仓库自包含。
- 端口：dev/start 均 3000
- 版本锁定在 `package-lock.json`（`npm ci` 可精确复现）
