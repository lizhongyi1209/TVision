# 开发交接 · TVision

> 本地电商 AI 生图工作台。给「另一台电脑上的明天的你」看的接力文档。
> 代码地图和使用说明见 [README.md](./README.md);本文件只记**进度 / 状态 / 计划**。

---

## 一、今日进度（2026-07-08）

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

### 第二轮：品牌化 + 体验迭代（⚠️ 全部尚未 git commit）

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
- **进度体验**：多张批量时进度是平均值，可改成每张独立进度条。

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
- **⚠️ 第二轮所有改动未 commit**（12+ 个文件修改，新增 icon.svg / Logo.tsx / CropPanel.tsx / historyMeta.ts），确认界面效果后先提交再继续开发
- 入口：`src/components/Studio.tsx`（编排 + 轮询引擎）；裁剪弹窗 `CropPanel.tsx`；双扇区菜单 `RadialMenu.tsx`
- 品牌：TVision（元流视觉 / tokenflow vision），主题色即品牌色（`--color-accent` 琥珀）
- 依赖新增：`react-image-crop@11`（裁剪 UI，零依赖）
- API 契约来源：已装技能 `o1key-nano-banana`（`references/api.md` + `scripts/generate_image.py`），逻辑已内联到 `src/lib/o1key.ts`，仓库自包含。
- 端口：dev/start 均 3000
- 版本锁定在 `package-lock.json`（`npm ci` 可精确复现）
