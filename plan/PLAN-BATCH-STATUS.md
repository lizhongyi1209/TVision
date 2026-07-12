# 批量工坊 · 执行进度快照（PLAN-BATCH-STATUS）

> **T1–T8 已全部完成（2026-07-12 晚间续作收尾）**。设计定稿见 [PLAN-BATCH.md](./PLAN-BATCH.md)；任务总账与打勾在 [DEV-PLAN.md](../DEV-PLAN.md) F4；当日详细改动记录见 HANDOFF.md 的「批量工坊 · F4 全量落地」条目。
> **工作树状态：可编译、可运行。** `npx tsc --noEmit` 零错误、`npm run test:unit` 28/28 通过、`npm run build` 通过（首屏 103kB），3000 端口的 `next start` 已重启到新构建（2026-07-12 验证）。

## 一、已完成（T1–T8）

- **T1 常量·类型·模板** ✅：`limits.ts` 三常量、`GenMeta.note`、`batchPrompts.ts`（4 种换装类型，上装/下装引用 actions.ts 模板）。
- **T2 批量 store 与引擎** ✅：`batchStore.ts` 独立 store + 模块级提交/轮询双循环（3/8 并发、runId 存活判定、stopRun 只删 waiting、服装序建格）。续作时补了 `clearGarments`、`retryCell` 放宽到 success 格（「重生成」用）。
- **T3 模式切换** ✅：`workMode` + 顶栏居中 Segmented（运行中呼吸点）+ D9 画布接力 + beforeunload 挽留。
- **T4 `BatchWorkshop.tsx`** ✅：模特栏 + 服装墙（`packGrid` + ResizeObserver 全同屏）、≥2 模特吸附矩阵（行头整行重生成/下载整行）、五态格子、上传（多选/拖拽挡冒泡/全局粘贴→服装）、运行中锁编辑、500ms 共享假进度 ticker（不写回 store）。降采样模特 1800/0.94、服装 1400/0.92。
- **T5 `BatchBar.tsx`** ✅：类型 Select（手改显示「自定义」）+ 计数芯片 + 提示词 + 参数行（`resolutionsFor/comboError`、GPT Image 2 加 quality）+「⚡ 生成 N 张」（超 100 琥珀提示分批）；运行态进度条 + 已完成 x/N·y 张未成功 + 停止；完成态 重试未成功 + 打包下载。
- **T6 `BatchLightbox.tsx`** ✅：ResultView 弹框壳 + CompareSlider（before=模特原图）、服装缩略角标、下载 `服装名-模特N.png`、重生成、设为画布、←/→ 翻页（success 格间）、Esc/遮罩关闭。
- **T7 服务端** ✅：`/api/jobs` 解析 `note`（trim + 截 120）入侧车；`zip.ts` 手写 STORE zip（UTF-8 bit 11 + CRC32）+ `zip.test.ts` 4 例（另用 .NET ZipFile 实际解包验证过中文名）；`/api/batch/export`（basename 防穿越 + 扩展名白名单 + 重名加序号）。
- **T8 验收与文档** ✅（可自动化部分）：tsc / test:unit / build 全过；HANDOFF 当日条目、README「批量工坊」用法段、DEV-PLAN F4 打勾、本文件更新。本轮无新踩坑，DEV-ERRORS 无新增。

## 二、留用户本机验证（本执行环境无浏览器交互与真实令牌）

PLAN-BATCH 第五节验收清单 2–9 项：
1. 模式切换双工作区互不影响 + 单图全链路零回归。
2. 批量 1×50：50 张全同屏无滚动；出一张亮一张；停止/单格重试/重试未成功。
3. 全匹配 2×3：格子配对逐格正确；行列头吸附；模特数增减自动切视图。
4. 上限 toast（第 51 件 / 第 7 位 / 6×20=120 超 100 禁生成）。
5. 弹框对比/翻页/下载命名/设为画布。
6. 打包 zip 中文名在资源管理器正常（服务器侧 .NET 解包已验，浏览器端到端待验）。
7. 历史侧车含 note；运行中刷新有挽留。
8. 真实令牌 50 张实跑——上游对快速连发的限流承受度未实测（PLAN-BATCH §6 风险项），若 429/拒收则调低 `batchStore.ts` 的 `SUBMIT_CONCURRENCY` 或加间隔，结论回填 DEV-ERRORS。

## 三、本轮（F4 全程）改动文件清单（全部未 commit）

| 类型 | 文件 |
|---|---|
| 改 | `src/lib/limits.ts` · `src/lib/types.ts` · `src/lib/store.ts` · `src/lib/utils.ts` · `src/components/ui.tsx` · `src/components/Studio.tsx` · `src/app/api/jobs/route.ts` |
| 新 | `src/lib/batchPrompts.ts` · `src/lib/batchStore.ts` · `src/lib/zip.ts` · `src/app/api/batch/export/route.ts` |
| 新（组件） | `src/components/BatchWorkshop.tsx` · `src/components/BatchBar.tsx` · `src/components/BatchLightbox.tsx` |
| 新（测试） | `src/lib/__tests__/packGrid.test.ts` · `src/lib/__tests__/zip.test.ts` |
| 文档 | `PLAN-BATCH.md` · `PLAN-BATCH-STATUS.md`（本文件） · `DEV-PLAN.md` · `HANDOFF.md` · `README.md` |
