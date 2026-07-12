# 修复任务交接计划（供新会话直接执行）

> 调研已完成、方案已定稿，按本文档实施即可，**无需重新调研**。执行完成后可删除本文件。

## 任务：局部重绘 —— 历史记录存贴回后的完整图 + 保持原始分辨率

### 问题描述（用户报告）
1. 局部重绘完成后，「历史生成」里保存的是裁剪出来的**局部小图**，而不是贴回后的完整图。
2. 贴回后的完整图必须**保持原始图片的分辨率和大小**，不允许被缩放/有损压缩。

### 根因（已定位，直接采信）
- 提交时只把 bbox 裁剪图发给上游：`src/components/GenerateBar.tsx:192`（cropImageToDataURL）。
- 服务端轮询成功后，把上游返回的**局部生成块**直接落盘 `output/`：`src/app/api/jobs/[id]/route.ts:41-56`；而历史面板就是列这个目录：`src/app/api/history/route.ts`。
- 贴回合成只发生在**客户端内存**：`src/components/Studio.tsx` 的 `finish()`（约 117-154 行）调用 `compositeInpaintResult`（`src/lib/utils.ts:154-179`），合成结果从未回传服务端 → **Bug 1**。
- `src/components/Stage.tsx:84`：上传瞬间 `fileToDownscaledDataURL(file, 1800, 0.94)` —— 原图进应用就被缩到 ≤1800px + JPEG 有损，**Bug 2 总根源**。
- `src/lib/utils.ts:178`：合成输出 `toDataURL("image/jpeg", 0.94)` —— 贴回整图（含未涂抹区域）再次有损重编码，**Bug 2 次因**。

### 设计决策（不要重新论证）
- 画布 `image.src` 一律持有**原始字节**（不缩放不重编码）；降采样只发生在**网络提交边界**（保住服务端 20MB body 上限，行为与现状等价）。
- 合成导出用 **PNG（无损）**，画布尺寸 = 原图自然尺寸；前端用 `URL.createObjectURL(blob)` 展示（避免超大 dataURL）。
- 合成完整图通过新增 `PUT /api/media/[name]` 回传，**覆盖**同任务 ID 的局部图文件（删旧扩展名），历史 meta 按 jobId 关联不受影响。
- 历史里不保留局部小图，直接被完整图替换。

### 实施规格（六步）

#### 1. `src/lib/utils.ts`
a) 新增 `fileToDataURL(file: File | Blob): Promise<string>`：FileReader.readAsDataURL 原样读取（不重编码、不缩放），onerror 时 reject `new Error("读取图片失败")`。
b) 新增 `downscaleImageSrc(src: string, maxDim = 1600, quality = 0.92): Promise<DownscaledImage>`：用现有 `loadImage(src)` 加载，复用 `fileToDownscaledDataURL` 的缩放+白底+JPEG 逻辑（scale = min(1, maxDim/max(w,h))，白底 fillRect 后 drawImage，toDataURL("image/jpeg", quality)）。JSDoc 风格与现有函数一致（用途：把画布上的全分辨率图在提交/网络边界收缩；输入为 data URL 或同源 URL）。
c) `cropImageToDataURL` 增加第 4 参数 `format: "image/jpeg" | "image/png" = "image/jpeg"`：png 时跳过白底 fillRect（保留透明）且 toDataURL("image/png")（忽略 quality）；jpeg 行为不变。
d) `compositeInpaintResult` 返回类型改为 `Promise<{ url: string; blob: Blob }>`：合成逻辑不变（main 画布尺寸依旧 = orig.naturalWidth/Height），导出改 `main.toBlob(cb, "image/png")` 包 Promise（blob 为 null 时 reject `new Error("导出合成图失败")`），`url = URL.createObjectURL(blob)`。更新 JSDoc（无损 PNG、保持原图分辨率）。

#### 2. `src/components/Stage.tsx`
`addFile` 中把 `fileToDownscaledDataURL(file, 1800, 0.94)` 替换为：
```ts
const dataUrl = await fileToDataURL(file);
const img = await loadImage(dataUrl);
setImage({ src: dataUrl, width: img.naturalWidth, height: img.naturalHeight });
```
保留现有 image/* 类型校验、busy 态、错误 toast；调整 import。

#### 3. `src/components/GenerateBar.tsx`
a) `generate()` 普通路径（既非 inpaintMask 也非 `action?.textToImage`）：提交前 `submitImage = (await downscaleImageSrc(image.src, 1800, 0.94)).dataUrl`，包 try/catch，失败 toast「读取图片失败，请重试」并 return。结构：在现有 `if (inpaintMask) {...}` 后加 `else if (!action?.textToImage) {...}`。
b) inpaint 分支：现有 cropImageToDataURL 调用保持（此时裁剪自全分辨率原图）；裁剪后若 `Math.max(cropped.width, cropped.height) > 2048`，再 `submitImage = (await downscaleImageSrc(cropped.dataUrl, 2048, 0.92)).dataUrl`（仅提交用图收缩；`setInpaintJob` 的 origSrc/bboxPx/maskUrl **完全不变**）。
c) 视觉反推 effect（POST /api/reverse-prompt 处）：body 的 image 改为 `(await downscaleImageSrc(imgSrc, 1600, 0.92)).dataUrl`（async IIFE 内、fetch 之前；失败走现有 catch；AbortError 判断不受影响）。
d) refImage 路径不动（RefSlot 已做 1400 降采样）。

#### 4. `src/components/Studio.tsx` — `finish()` 重构（核心）
当前 `const all = imgs.flatMap((x) => x || [])` 丢失了 结果↔任务 映射，需要保留：job i（jobIds[i]）的第 j 张图对应服务端文件名 base = `` `${jobIds[i]}${imgs[i].length > 1 ? `_${j}` : ""}` ``（与 `api/jobs/[id]/route.ts:42` 的命名规则**完全一致**）。

- 构建 `entries: { src, base }[]`（按 job 顺序展开，展示顺序不变）。
- 无 inpaintJob：`finalImages = entries.map(e => e.src)`，行为与现状完全一致。
- 有 inpaintJob：对每个 entry 并行 `compositeInpaintResult(job, e.src)`：
  - 成功 → 该张展示 URL 用返回的 objectURL；记录 `{ base, blob }` 待上传。
  - 失败 → 保留现有 catch：diag warn「单张合成失败，已回退原始生成结果」，展示原始 src，不上传。
  - composite 全部结束后先 `if (cancelled) return;`，再 setResults(finalImages)、setPhase("success")、showToast("success", "生成完成")（**展示优先，不等上传**）。
  - 然后后台上传：对每个 `{ base, blob }` 执行
    `fetch(`/api/media/${encodeURIComponent(base)}.png`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob })`，
    全部 settle 后调用 `refreshHistory()`；单个失败 `diag("warn", "局部重绘", "完整图保存到历史失败", 详情)`，不弹 toast、不影响展示。上传不要因 cancelled 中止（图已生成，落历史仍有价值）。
- 非 inpaint 路径 refreshHistory() 时机保持现状。
- 保留现有 diag 日志（「合成完成 N 张」等），可为上传补一条 info。

#### 5. `src/app/api/media/[name]/route.ts` — 新增 PUT handler（保留现有 GET）
语义：用合成完整图**替换**某个已存在的任务产物文件。
- `const safe = path.basename(name)`；必须匹配 `/^[\w.-]+\.png$/i`，否则 400。
- base = safe 去掉末尾 `.png`。安全门：OUTPUT_DIR 下必须已存在 `base + (".png"|".jpg"|".jpeg"|".webp")` 之一（参考 `api/jobs/[id]/route.ts` 的 findExisting，注意多查 `.jpeg`），否则 404 —— 该端点只能替换既有产物，不能创建任意新文件。
- `const buf = Buffer.from(await req.arrayBuffer())`；空 body → 400；> 100MB → 413；校验 PNG 魔数前 4 字节 `0x89 0x50 0x4E 0x47`，不符 → 400。
- 写入 `base + ".png"`；然后尽力 unlink base + ".jpg"/".jpeg"/".webp"（存在才删，失败忽略）。
- 返回 `NextResponse.json({ ok: true, url: `/api/media/${base}.png` })`（需 import NextResponse）。加一段与项目风格一致的英文注释（local-repaint composite replaces the partial result so history shows the full image）。

#### 6. `src/components/CropPanel.tsx`
`apply()` 里 cropImageToDataURL 调用追加 format 参数 `"image/png"`（画布裁剪走无损）。先读完整个文件再改。

### 通用要求
- 动手前完整读取每个待改文件；风格（注释密度、中文文案、命名）与现有代码一致。
- 顺手核对（默认无需改动）：ImageNode.tsx / ResultSlot.tsx / CompareSlider.tsx 对 objectURL 与大尺寸 src 无副作用（应仅 <img> 展示）；ResultView.setAsCanvas 用 new Image() 读 objectURL 尺寸应正常。
- **用户可见文案（toast/界面）不得出现「压缩/上限/分辨率/MB」等实现细节字眼**；诊断台 diag 日志不受限。
- 不新增依赖；不改任何 .bat；不 git commit（除非用户明确要求）。

### 验收
1. `npx tsc --noEmit` 零错误。
2. 手动链路（`npm run dev`，需已配置 o1key 令牌）：
   - 上传一张 >1800px 的图（如 3000×4000）→ 局部重绘 → 结果展示为**贴回后的完整图**；
   - 「历史生成」刷新后显示**完整图**（非局部小图），下载该文件核对：**尺寸 = 原图自然尺寸**，格式 PNG；
   - ×2 张数的局部重绘 → 历史里 `<id>_0.png`/`<id>_1.png` 均为完整图；
   - 普通生成（白底图/换背景）、视觉反推、画布裁剪均不回归；
   - 合成失败降级路径：断网重试等极端场景下仍展示原始生成结果（diag 有 warn）。
