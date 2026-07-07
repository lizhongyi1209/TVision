import type { Billing, ModelName, Resolution, RouteName } from "./types";

// Client-safe route list (mirrors NETWORK_ROUTES in o1key.ts, which is server-only).
export const ROUTE_OPTIONS: { value: RouteName; label: string; base: string }[] = [
  { value: "全球加速", label: "全球加速 · api.o1key.cn", base: "https://api.o1key.cn" },
  { value: "CF加速", label: "CF加速 · cf-api.o1key.com", base: "https://cf-api.o1key.com" },
  { value: "美国直连", label: "美国直连 · api.o1key.com", base: "https://api.o1key.com" },
];

export interface ModelInfo {
  name: ModelName;
  resolutions: Resolution[];
  blurb: string;
}

export const MODELS: ModelInfo[] = [
  { name: "Nano Banana Pro", resolutions: ["1K", "2K", "4K"], blurb: "质量最佳 · 推荐" },
  { name: "Nano Banana 2", resolutions: ["512", "1K", "2K", "4K"], blurb: "支持 512 与极端比例" },
  { name: "Nano Banana", resolutions: ["1K"], blurb: "仅特价" },
];

export const BILLINGS: Billing[] = ["特价", "官方"];

export const ASPECT_RATIOS = ["auto", "1:1", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "9:16", "16:9", "21:9"];

export function resolutionsFor(model: ModelName): Resolution[] {
  return MODELS.find((m) => m.name === model)?.resolutions ?? (["2K"] as Resolution[]);
}

/** Mirror buildModelId's validity rules so the UI can gate invalid combos before spending credits. */
export function comboError(model: ModelName, resolution: Resolution, billing: Billing): string | null {
  if (model === "Nano Banana" && billing === "官方") return "Nano Banana 仅支持特价计费";
  if (model === "Nano Banana 2" && resolution === "512" && billing === "官方") return "512 分辨率仅支持特价计费";
  if (!resolutionsFor(model).includes(resolution)) return `${model} 不支持 ${resolution}`;
  return null;
}
