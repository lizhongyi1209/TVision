// Templates (PLAN-TEMPLATE): a named, reusable bundle of generation params +
// prompt that can be saved from the current GenerateBar state, applied back
// in one click, and shared as a .tvt.json file. Also defines the payload
// embedded into generated PNGs (pngMeta.ts) so an image dropped back onto
// the canvas restores the exact settings that produced it — dependency-free
// module shared between client (TemplateWorkshop/Stage) and server (template
// store, jobs route).

import type { Billing, GenMeta, ModelName, Quality, Resolution } from "./types.ts";
import { GPT_IMAGE_2_RATIOS, MODELS, ASPECT_RATIOS } from "./models.ts";

/** What a template captures — the GenParams recipe plus name/notes
 *  bookkeeping. count is optional: most templates leave the ×N choice to the
 *  moment, but e.g. 动作裂变 is only useful when it fans out to 4. */
export interface Template {
  id: string;
  name: string;
  /** Optional free-form usage note shown in the list ("适合白底商品图"…). */
  notes?: string;
  /** Icon name (icons.tsx MAP) for the template-page card; presets set it. */
  icon?: string;
  prompt: string;
  model: ModelName;
  resolution: Resolution;
  aspectRatio: string;
  billing: Billing;
  /** GPT Image 2 only, mirrors GenParams. */
  quality?: Quality;
  /** Optional ×N generate count applied together with the params. */
  count?: number;
  createdAt: number;
  updatedAt: number;
}

/** Shareable file shape (.tvt.json) — a version tag plus the template sans
 *  ids/timestamps (regenerated on import so imports never collide). */
export interface TemplateFile {
  tvisionTemplate: 1;
  name: string;
  notes?: string;
  prompt: string;
  model: string;
  resolution: string;
  aspectRatio: string;
  billing: string;
  quality?: string;
  count?: number;
}

/** Payload embedded into generated PNGs (pngMeta.ts, keyword "TVision").
 *  v is bumped if the shape ever changes incompatibly. */
export interface EmbeddedGenMeta {
  tvision: 1;
  prompt: string;
  model: string;
  resolution: string;
  aspectRatio: string;
  billing: string;
  quality?: string;
  createdAt: number;
}

export function buildEmbeddedMeta(meta: Omit<GenMeta, "count" | "refCount" | "note">): EmbeddedGenMeta {
  return {
    tvision: 1,
    prompt: meta.prompt,
    model: meta.model,
    resolution: meta.resolution,
    aspectRatio: meta.aspectRatio,
    billing: meta.billing,
    quality: meta.quality,
    createdAt: meta.createdAt,
  };
}

const BILLING_SET = new Set(["特价", "官方"]);
const QUALITY_SET = new Set(["auto", "high", "medium", "low"]);

/** Validate + normalize externally-sourced params (imported template file or
 *  PNG-embedded metadata) into safe GenParams fields. Unknown model/resolution
 *  combos degrade field-by-field to defaults instead of rejecting the whole
 *  thing — a template from a newer version with an unknown model should still
 *  restore its prompt. Returns null only when there's no usable content. */
export function sanitizeParams(raw: Record<string, unknown>): {
  prompt: string;
  model: ModelName;
  resolution: Resolution;
  aspectRatio: string;
  billing: Billing;
  quality: Quality;
} | null {
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  const modelInfo = MODELS.find((m) => m.name === raw.model);
  if (!prompt.trim() && !modelInfo) return null;
  const model = modelInfo?.name ?? "Nano Banana Pro";
  const resolutions = (modelInfo ?? MODELS[0]).resolutions;
  const resolution = resolutions.includes(raw.resolution as Resolution)
    ? (raw.resolution as Resolution)
    : resolutions.includes("2K")
      ? "2K"
      : resolutions[0];
  const ratios = model === "GPT Image 2" ? GPT_IMAGE_2_RATIOS : ASPECT_RATIOS;
  const aspectRatio = ratios.includes(raw.aspectRatio as string) ? (raw.aspectRatio as string) : "auto";
  const billing = BILLING_SET.has(raw.billing as string) ? (raw.billing as Billing) : "特价";
  const quality = QUALITY_SET.has(raw.quality as string) ? (raw.quality as Quality) : "auto";
  return { prompt, model, resolution, aspectRatio, billing, quality };
}

/** Optional ×N count carried by a template (1-4, else absent). */
export function sanitizeCount(raw: unknown): number | undefined {
  const n = Math.round(Number(raw));
  return n >= 1 && n <= 4 ? n : undefined;
}

/** Parse the JSON text of a template file / embedded PNG payload. Both carry
 *  the same param fields; the type tag decides which container it was. */
export function parseTemplateFile(
  text: string,
): { name: string; notes?: string; count?: number; params: NonNullable<ReturnType<typeof sanitizeParams>> } | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || j.tvisionTemplate !== 1) return null;
  const params = sanitizeParams(j);
  if (!params) return null;
  const name = typeof j.name === "string" && j.name.trim() ? j.name.trim().slice(0, 40) : "导入的模板";
  const notes = typeof j.notes === "string" && j.notes.trim() ? j.notes.trim().slice(0, 200) : undefined;
  return { name, notes, count: sanitizeCount(j.count), params };
}

export function parseEmbeddedMeta(text: string): NonNullable<ReturnType<typeof sanitizeParams>> | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || j.tvision !== 1) return null;
  return sanitizeParams(j);
}

export function templateToFile(t: Template): TemplateFile {
  return {
    tvisionTemplate: 1,
    name: t.name,
    notes: t.notes,
    prompt: t.prompt,
    model: t.model,
    resolution: t.resolution,
    aspectRatio: t.aspectRatio,
    billing: t.billing,
    quality: t.quality,
    count: t.count,
  };
}

export const MAX_TEMPLATES = 100;

// ── 预设模板 ─────────────────────────────────────────────────────────────────
// Built-in showcase recipes on the 模板 page: not persisted, not deletable,
// ids prefixed "preset-". Prompts are verbatim copies of the corresponding
// radial-menu actions (actions.ts) — the wording there is battle-tested, and
// "the second image" phrasing lines up with free-mode reference slots being
// numbered 图 2+ (PLAN-MULTI-REF).

const preset = (t: Omit<Template, "id" | "createdAt" | "updatedAt"> & { id: string }): Template => ({
  ...t,
  createdAt: 0,
  updatedAt: 0,
});

export const PRESET_TEMPLATES: Template[] = [
  preset({
    id: "preset-swap-top",
    name: "换上衣",
    icon: "TShirt",
    notes: "主图放模特，参考图（第 2 张）放要换上的上衣 — 平铺图或模特图都可以。",
    prompt:
      "Using the person in the first image as the base, replace their upper garment (top, shirt, jacket, dress top) with the garment shown in the second image. Faithfully reproduce the second garment's design, color, fabric texture, pattern, print, collar, sleeves and fit, draping it naturally over the person's body and matching their exact pose. Keep everything else in the first image identical: the same face, hairstyle, expression, skin tone, body shape, pose, hands, lower garment, shoes, background, lighting, shadows, color grade and camera framing. Photorealistic fashion e-commerce photography. Only the upper garment changes.",
    model: "Nano Banana Pro",
    resolution: "2K",
    aspectRatio: "auto",
    billing: "特价",
    count: 1,
  }),
  preset({
    id: "preset-swap-bg",
    name: "换背景",
    icon: "Mountains",
    notes: "保主体、换环境：主图放人物或商品，参考图（第 2 张）放目标场景。",
    prompt:
      "Keep the main subject from the first image completely identical: same shape, pose, proportions, colors, materials, textures and crisp edges. Replace only the background with the scene shown in the second image. Composite the subject naturally into the new environment with matching perspective, lighting direction, color temperature and a believable soft contact shadow so it reads as one real photograph. Photorealistic, clean subject edges, professional composite. Only the background changes.",
    model: "Nano Banana Pro",
    resolution: "2K",
    aspectRatio: "auto",
    billing: "特价",
    count: 1,
  }),
  preset({
    id: "preset-action-variation",
    name: "动作裂变",
    icon: "Sparkle",
    notes: "同一主体一次裂变 4 个自然新姿势，无需参考图。",
    prompt:
      "Generate a new photograph of the same subject wearing the exact same outfit and styling as in the image, but in a different, natural pose and body gesture. Keep identity, face, hairstyle, clothing, colors, materials, overall style, background type and lighting consistent with the original. Vary only the pose and camera angle in a natural, flattering way. Photorealistic fashion e-commerce photography.",
    model: "Nano Banana Pro",
    resolution: "2K",
    aspectRatio: "auto",
    billing: "特价",
    count: 4,
  }),
];
