import type { Billing, ModelName, Quality, Resolution, RouteName } from "./types";

// Client-safe route list (mirrors NETWORK_ROUTES in o1key.ts, which is server-only).
export const ROUTE_OPTIONS: { value: RouteName; label: string; base: string }[] = [
  { value: "全球加速", label: "全球加速 · api.o1key.cn", base: "https://api.o1key.cn" },
];

export interface ModelInfo {
  name: ModelName;
  resolutions: Resolution[];
  blurb: string;
}

export const MODELS: ModelInfo[] = [
  { name: "Nano Banana Pro", resolutions: ["1K", "2K", "4K"], blurb: "质量最佳 · 推荐" },
  { name: "Nano Banana 2", resolutions: ["512", "1K", "2K", "4K"], blurb: "快速批量 · 最新" },
  { name: "Nano Banana", resolutions: ["1K"], blurb: "普通质量 · 初代" },
  { name: "GPT Image 2", resolutions: ["1K", "2K", "4K"], blurb: "文字和真实感出色" },
];

/** GPT Image 2 has no aspect_ratio param — the exact pixel size for a given
 *  resolution tier + ratio is looked up from this table (mirrors the preset
 *  table in the o1key GPT Image ComfyUI node). Ratios not listed here are
 *  disabled in the UI for this model; "auto" bypasses the table entirely and
 *  sends the tier string straight through as `size`. */
export const GPT_IMAGE_2_SIZE_TABLE: Record<string, Record<string, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "4:3": "1360x1024",
    "3:4": "1024x1360",
    "16:9": "1824x1024",
    "9:16": "1024x1824",
  },
  "2K": {
    "1:1": "2048x2048",
    "3:2": "3072x2048",
    "2:3": "2048x3072",
    "4:3": "2736x2048",
    "3:4": "2048x2736",
    "16:9": "3648x2048",
    "9:16": "2048x3648",
  },
  "4K": {
    "1:1": "2880x2880",
    "3:2": "3504x2336",
    "2:3": "2336x3504",
    "4:3": "3264x2448",
    "3:4": "2448x3264",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
  },
};

/** Aspect ratios GPT Image 2 can render exactly (plus "auto"); used to grey
 *  out unsupported options in GenerateBar's ratio selector. */
export const GPT_IMAGE_2_RATIOS = ["auto", "1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"];

/** GPT Image 2 only — the nano-banana family has no quality knob, so
 *  GenerateBar only renders this selector when params.model === "GPT Image 2". */
export const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
];

export const BILLINGS: Billing[] = ["特价", "官方"];

export const ASPECT_RATIOS = ["auto", "1:1", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "9:16", "16:9", "21:9"];

export function resolutionsFor(model: ModelName): Resolution[] {
  return MODELS.find((m) => m.name === model)?.resolutions ?? (["2K"] as Resolution[]);
}

/** Mirror buildModelId's validity rules so the UI can gate invalid combos before spending credits. */
export function comboError(
  model: ModelName,
  resolution: Resolution,
  _billing: Billing,
  aspectRatio?: string,
): string | null {
  if (!resolutionsFor(model).includes(resolution)) return `${model} 不支持 ${resolution}`;
  if (model === "GPT Image 2" && aspectRatio && !GPT_IMAGE_2_RATIOS.includes(aspectRatio)) {
    return `GPT Image 2 不支持 ${aspectRatio} 比例`;
  }
  return null;
}
