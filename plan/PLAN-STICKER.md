# 开发设计 · 贴图（PLAN-STICKER）

> 需求（2026-07-16）：上传主图后，点击「贴图」，支持再上传另一张图片叠加到图层上方，
> 支持移动、放大缩小、旋转；点「保存」后画布图（参考图）变成贴完图的成品，然后继续正常生图。
> 本文档为定稿设计，按此实施。

## 一、交互定位（复用现有编辑工具链路）

「贴图」是一个**本地编辑工具**，与 裁剪/局部重绘 同类：

- 入口：单图创作 → 点击画布图片 → RadialMenu **左扇**新增「贴图」pill（排在 裁剪、局部重绘 之后、视觉反推 之前），图标用 phosphor 的 `Sticker`（已确认 `@phosphor-icons/react` 里存在，需在 icons.tsx 注册）。
- 打开一个居中玻璃弹层 **StickerPanel**（结构、动效、层级完全对齐 CropPanel：`z-[96]` 遮罩 + `z-[97]` 面板、motion spring、Esc 关闭）。
- 保存 = 在 canvas 上按原图分辨率合成 PNG → `replaceImage({src,width,height})`（与裁剪一致：只换画布图，**保留 prompt/action/参数**）→ toast「贴图完成 · W×H」→ 关闭面板，用户继续生图。
- 取消/Esc = 直接关闭，不改画布。

## 二、UI 设计

```
┌───────────────────────────────────────────────────┐
│ ⬡ 贴图      将另一张图叠加到当前图上                × │  ← header（对齐 CropPanel）
├───────────────────────────────────────────────────┤
│                                                   │
│        ┌───────────────────────────┐              │
│        │        底图（等比缩放       │              │
│        │        max-h 46dvh）      │              │
│        │      ┌╌╌╌╌╌╌╌╌┐ ×        │  ← 选中贴纸：虚线 accent 框
│        │      ╎  贴纸    ╎          │     右上角 × 删除
│        │      └╌╌╌╌╌╌╌╌⤡          │     右下角 ⤡ 手柄 = 缩放+旋转
│        │                           │
│        └───────────────────────────┘              │
│                                                   │
├───────────────────────────────────────────────────┤
│ [＋ 添加贴图]   拖动移动 · 角柄缩放旋转 · 滚轮缩放    │
│                              [取消] [✓ 保存合成]   │  ← footer（对齐 CropPanel）
└───────────────────────────────────────────────────┘
```

- **空状态**（还没有贴纸）：底图中央浮一个虚线按钮「＋ 上传贴图」，点击即选文件；也支持把图片直接**拖拽**进面板。
- **多张贴纸**：允许（footer「＋ 添加贴图」可反复加，file input `multiple`），点击某张即选中；后添加的在图层上方（数组顺序即绘制顺序）。v1 不做层序调整。
- **操作方式**（选中贴纸后）：
  - 拖动贴纸本体 = 移动；
  - 右下角圆形手柄 = **组合缩放+旋转**（常见贴纸编辑器手势，见 §三）；
  - 鼠标滚轮悬停在选中贴纸上 = 缩放；
  - `Delete`/`Backspace` = 删除选中贴纸；右上角 × 同样删除；
  - 点击底图空白处 = 取消选中；`Esc` = 关闭面板（与 CropPanel 一致，不做「先取消选中」的两段式）。
- 「保存合成」在没有任何贴纸时 disabled；合成中按钮转圈（`CircleNotch animate-spin`，对齐 CropPanel 的 applying 态）。
- 提示文案放 footer 左侧灰字，不暴露实现细节。

## 三、数据模型与几何（分辨率无关，全部存百分比）

StickerPanel 内部 `useState`，**不进 zustand**（与 CropPanel 的 crop state 同理，面板关即弃）：

```ts
interface Sticker {
  id: number;          // 自增
  src: string;         // dataURL（上传时 fileToDownscaledDataURL(file, 2048, 0.95) 降采样，防超大图卡合成）
  natW: number; natH: number;   // 贴纸自然尺寸（仅用于纵横比）
  cx: number; cy: number;       // 贴纸中心，相对底图显示区的比例 0~1（可拖出边界少许，不强制 clamp 到 0~1，clamp 到 -0.2~1.2 防丢失）
  wFrac: number;                // 贴纸显示宽 / 底图显示宽（初始 min(0.35, 贴纸不超过底图高的 0.35 对应值)，clamp 0.02~3）
  rotation: number;             // 弧度
}
```

- 底图用 `<img>` 等比渲染（`max-h-[46dvh] max-w-full`），外层 relative 容器记录 `getBoundingClientRect()`；贴纸是绝对定位 div：
  `left: cx*100% ; top: cy*100%; width: wFrac*100%（相对容器）; transform: translate(-50%,-50%) rotate(rot)`。
- **拖动**：pointerdown 记录起点与初始 cx/cy → pointermove 增量换算成容器比例（用 `setPointerCapture`，pointerup 结束）。
- **组合手柄**（右下角）：pointerdown 记录 `v0 = pointer − 贴纸中心(屏幕坐标)`、`scale0 = wFrac`、`rot0 = rotation`；
  pointermove 时 `v1 = pointer − 中心`，则
  `wFrac = clamp(scale0 * |v1|/|v0|, 0.02, 3)`；`rotation = rot0 + (atan2(v1.y,v1.x) − atan2(v0.y,v0.x))`。
- **滚轮**：`wFrac *= e.deltaY < 0 ? 1.06 : 1/1.06`（preventDefault，仅作用于选中贴纸）。

## 四、合成（保存）

在 `src/lib/utils.ts` 新增纯函数（与 `cropImageToDataURL` 相邻，风格一致）：

```ts
export async function compositeStickersToDataURL(
  baseSrc: string,
  stickers: { src: string; cx: number; cy: number; wFrac: number; rotation: number }[],
): Promise<{ dataUrl: string; width: number; height: number }>
```

- canvas 尺寸 = 底图 `naturalWidth × naturalHeight`（**原分辨率合成**，与显示尺寸无关）；
- 依次 `drawImage(base)`，然后每张贴纸：
  `drawW = wFrac * baseNatW; drawH = drawW * natH/natW;`
  `ctx.save(); ctx.translate(cx*baseNatW, cy*baseNatH); ctx.rotate(rotation); ctx.drawImage(img, -drawW/2, -drawH/2, drawW, drawH); ctx.restore();`
- 导出 `toDataURL("image/png")`。canvas API 无法在 node 单测中跑，不加 unit test（与 cropImageToDataURL 同待遇）。

保存流程（StickerPanel.apply，对齐 CropPanel.apply）：`setApplying(true)` → composite → `replaceImage` → `showToast("success", `贴图完成 · ${w}×${h}`)` → 关闭。失败 toast「贴图合成失败」。

## 五、改动文件清单

| 类型 | 文件 | 内容 |
|---|---|---|
| 改 | `src/lib/store.ts` | `stickerOpen: boolean` + `openSticker`（有 image 才开，`menuOpen:false`，镜像 `openCrop`）+ `closeSticker` |
| 改 | `src/components/RadialMenu.tsx` | `TOOLS` 增 `{ id:"sticker", label:"贴图", hint:"叠加另一张图片，可移动/缩放/旋转", icon:"Sticker" }`；`onLeftItem` 加分支 |
| 改 | `src/components/icons.tsx` | import `Sticker` 并加入 MAP |
| 新 | `src/components/StickerPanel.tsx` | 本设计的弹层（结构抄 CropPanel 骨架） |
| 改 | `src/lib/utils.ts` | `compositeStickersToDataURL` |
| 改 | `src/components/Studio.tsx` | import + `<AnimatePresence>{stickerOpen ? <StickerPanel/> : null}</AnimatePresence>`（排在 CropPanel 旁） |

不新增依赖；左扇变 4 个 pill，`pos()` 的 `BASE_N=5` 覆盖得住，无需调参。

## 六、验收

1. `npx tsc --noEmit` 零错误；`npm run test:unit` 全过；`npm run build` 通过。
2. 上传主图 → 点图 → 贴图 → 上传贴纸 → 拖动/角柄旋转缩放/滚轮缩放/删除 → 保存 → 画布变成合成图，尺寸与原图一致（toast 显示 W×H），prompt/参数未被清空 → 可直接继续生成。
3. 取消/Esc 不改画布；多张贴纸叠放顺序正确（后加的在上）。
