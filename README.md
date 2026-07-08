# TVision（元流视觉）

tokenflow vision · 本地电商 AI 生图工作台（o1key Nano Banana）

深色影棚级界面 · 单一暖强调色 · 玻璃面板 · 弹簧动效。

---

## 快速开始

```bash
npm install      # 已安装可跳过
npm run dev      # 启动本地服务
```

打开 http://localhost:3000 。首次进入会自动弹出**设置**，填入你的 o1key 令牌即可开始。

> 生产模式：`npm run build && npm run start`

## 配置令牌（右上角 ⚙ 设置）

- **API 令牌 (Bearer)**：你在 o1key 后台创建的 new-api 令牌，按 o1key 余额计费。仅保存在本机 `data/settings.json`，不会上传到除 o1key 以外的任何服务器。
- **线路**：固定使用 `全球加速 (api.o1key.cn)`。
- **测试连接**：探测线路可达性与令牌是否被接受（真正的额度校验发生在首次生成时）。

## 使用流程

1. **放图** —— 拖入、点击选择，或直接 `Ctrl/⌘+V` 粘贴一张人物 / 商品主图。
2. **点图** —— 图片旁弹出弧形快捷菜单。
3. **选操作**：
   | 操作 | 说明 | 需要参考图 |
   |---|---|---|
   | 换上衣 | 替换上装为参考图中的服装 | ✅ 上传上衣 |
   | 换裤子 | 替换下装为参考图中的裤装 | ✅ 上传裤子 |
   | 换背景 | 把主体合成到参考背景中 | ✅ 上传背景 |
   | 白底图 | 生成纯白电商主图 | — |
   | 动作裂变 | 同一主体生成多个自然新姿势 | —（默认出 4 张）|
4. **传参考图** —— 需要参考图的操作会弹出上传框（图片自动压缩到 20MB 以内）。
5. **生成** —— 底部生成栏可改提示词、模型、比例、分辨率、计费、张数，点「生成」。
6. **结果** —— 前后对比滑块、批量胶片条；可**下载 / 设为画布（继续编辑）/ 再生成**。右上角 ▤ 查看历史。
7. **快速裁剪** —— 默认 1:1，支持自由拖动与常用比例预设。

每个操作都内置了「只改这一处、其余保持一致」的高质量提示词模板（这是 img2img 出好图的关键），你也可以在生成栏里自由改写。

## 参数说明（对齐 o1key Nano Banana）

- **模型**：`Nano Banana Pro`（1K/2K/4K，质量最佳）、`Nano Banana 2`（512/1K/2K/4K，支持极端比例）、`Nano Banana`（仅 1K，仅特价）。
- **计费**：`特价`（默认）/ `官方`。规则：`Nano Banana` 仅特价；`Nano Banana 2` 的 512 仅特价。非法组合会在界面上拦截提示。
- **比例**：`自动` 或 1:1 / 3:4 / 16:9 等。编辑类操作建议用「自动」以保留原图构图。

## 目录结构

```
TVision/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx / page.tsx / globals.css   # 壳 + 深色主题 tokens
│  │  └─ api/                                   # 本地后端（Route Handlers）
│  │     ├─ jobs/            POST 提交 · [id] GET 轮询并落盘
│  │     ├─ settings/        GET/POST 设置 · test 连接探测
│  │     ├─ media/[name]     读取已生成的图片
│  │     └─ history/         列表 / 删除
│  ├─ components/            # 画布、弧形菜单、上传、生成栏、结果、设置、历史…
│  └─ lib/
│     ├─ o1key.ts            # o1key 异步 API 的 TS 移植（提交/轮询/取图/模型 id）
│     ├─ actions.ts          # 操作与提示词模板（可扩展）
│     ├─ models.ts / types.ts / settings.ts / store.ts / utils.ts
├─ data/settings.json        # 本机设置（含令牌，已 gitignore）
├─ data/history-meta.json    # 生成参数侧车（提示词/模型等，用于历史还原）
└─ output/                   # 生成结果（已 gitignore）
```

## 架构要点

- **单栈本地应用**：Next.js 15 (App Router) + TypeScript + Tailwind v4 + Motion。前端与「本地服务」是同一进程——Route Handlers 即本地后端，天然解决令牌不进浏览器、绕过 CORS、承接大体积 base64。
- **服务端代理 o1key 异步 API**：`POST /async/v1/generateImage` → `task_id`，再轮询 `GET /async/v1/tasks/{id}`。`jobId` 即上游 `task_id`，成功后把结果下载到 `output/` 并通过 `/api/media` 提供，自动进入历史图库。
- **画布用 DOM + Motion**（非 Canvas 库）：为了「艺术感 + 优秀动效」，用绝对定位节点 + 弹簧动画完全掌控缓动、玻璃材质、聚光灯与微交互。
- **操作即数据**：每个操作是一条配置（图标 / 是否需参考图 / 提示词模板）。新增操作 = 加一条 `src/lib/actions.ts`。

## 数据与隐私

- 令牌只写在本机 `data/settings.json`；生成图片只存在本机 `output/`；生成参数（提示词/模型/分辨率等）写入本机 `data/history-meta.json`，用于历史图片还原。
- 除了你配置的 o1key 线路，应用不向任何第三方发送数据。

## 常见问题

- **生成/测试连接失败** → 检查本机网络 / 代理。
- **令牌被拒绝 (401)** → 令牌不对或额度/权限问题，去 o1key 后台确认。
- **请求体超过 20MB** → 参考图太大；应用已自动压缩，仍超限时换更小的图。
- **换装/换背景走形** → 在生成栏微调提示词，明确「保持不变」的部分；或换 `Nano Banana Pro` + 更高分辨率。

## 可扩展方向

多主体画布 / 涂抹遮罩局部重绘 / 批量队列 / 预设风格库 / 导出电商规格尺寸包。
