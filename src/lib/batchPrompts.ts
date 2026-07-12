// Prompt templates for the batch workshop (PLAN-BATCH). Picking a "wear type"
// rewrites the whole prompt box — same convention as actions.ts's
// buildPrompt(). Two of the types (top/bottom) delegate to the
// already-validated single-reference templates in actions.ts instead of
// duplicating their wording, so a future tuning pass on swap-top/swap-pants
// can't silently drift out of sync with a hand-copied duplicate here.
//
// Image order for every batch submission is fixed: first image = model,
// second image = garment (mirrors /api/jobs's baseImage + refImages[0]
// assembly), so every template below refers to "the first image" (person)
// and "the second image" (garment) — identical wording convention to
// actions.ts's header comment.

import { getAction } from "./actions";

export interface WearType {
  id: "generic" | "top" | "bottom" | "outfit";
  label: string;
  buildPrompt: () => string;
}

export const WEAR_TYPES: WearType[] = [
  {
    id: "generic",
    label: "通用替换",
    // 默认模式，不带任何预设提示词：完全交给用户自己写（换鞋 / 换背景 /
    // 换包 / 换道具…都靠用户描述）。提示词为空时生成按钮保持禁用
    // （BatchBar 的 canGenerate 已有 prompt.trim() 门槛），所以空模板
    // 不会放跑一次无提示词的批量提交。
    buildPrompt: () => "",
  },
  {
    id: "top",
    label: "上装",
    // Reuses swap-top's prompt verbatim (actions.ts) — same garment-replace
    // semantics, just triggered from the batch workshop instead of the
    // radial menu.
    buildPrompt: () => getAction("swap-top")?.buildPrompt() ?? "",
  },
  {
    id: "bottom",
    label: "下装",
    buildPrompt: () => getAction("swap-pants")?.buildPrompt() ?? "",
  },
  {
    id: "outfit",
    label: "连衣裙 · 套装",
    buildPrompt: () =>
      "Using the person in the first image as the base, replace their entire outfit (both upper and lower garments, or a full one-piece dress) with the complete garment or outfit shown in the second image. Faithfully reproduce its design, color, fabric texture, pattern, print, silhouette and fit, draping it naturally over the person's body and matching their exact pose. Keep everything else in the first image identical: the same face, hairstyle, expression, skin tone, body shape, pose, hands, shoes, background, lighting, shadows, color grade and camera framing. Photorealistic fashion e-commerce photography. Only the outfit changes.",
  },
];

export function getWearType(id: string | null | undefined): WearType | undefined {
  if (!id) return undefined;
  return WEAR_TYPES.find((w) => w.id === id);
}

/** 批量工坊界面名词包：换装类（top/bottom/outfit）叫「模特/服装」，
 *  通用替换（generic，默认）叫「主图/素材」——同一套组件按当前 wearTypeId 换文案，
 *  非服装行业（换鞋/换背景/换道具）用起来不别扭。手改提示词（自定义）不改
 *  wearTypeId，名词跟随最后选中的类型。 */
export interface BatchNouns {
  /** 左栏底图的叫法 */
  base: string;
  /** base 的量词（位/张） */
  baseUnit: string;
  /** 参考墙物件的叫法 */
  item: string;
  /** item 的量词（件/个） */
  itemUnit: string;
  /** 生成栏左侧芯片文案 */
  chip: string;
  /** 提示词框 placeholder 的开头词 */
  promptLabel: string;
  /** 芯片与服装墙空态的图标（icons.tsx 注册名） */
  icon: string;
}

export function batchNouns(wearTypeId: string | null | undefined): BatchNouns {
  if (getWearType(wearTypeId)?.id === "generic") {
    return { base: "主图", baseUnit: "张", item: "素材", itemUnit: "个", chip: "批量替换", promptLabel: "替换提示词", icon: "ImageSquare" };
  }
  return { base: "模特", baseUnit: "位", item: "服装", itemUnit: "件", chip: "批量换装", promptLabel: "换装提示词", icon: "CoatHanger" };
}
