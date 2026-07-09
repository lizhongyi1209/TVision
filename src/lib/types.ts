// Shared types across client and server.

export type RouteName = "全球加速";
export type Billing = "特价" | "官方";
export type Resolution = "512" | "1K" | "2K" | "4K";
export type ModelName = "Nano Banana Pro" | "Nano Banana 2" | "Nano Banana";

export interface SettingsDefaults {
  model: ModelName;
  resolution: Resolution;
  billing: Billing;
  aspectRatio: string;
}

export interface Settings {
  apiKey: string;
  route: RouteName;
  defaults: SettingsDefaults;
}

export type PublicSettings = Omit<Settings, "apiKey"> & {
  hasApiKey: boolean;
  apiKeyMasked: string;
};

export type JobStatus = "running" | "success" | "failed";

export interface JobStatusResponse {
  id: string;
  status: JobStatus;
  progress: number | null;
  images: string[]; // local media URLs
  error?: string;
}

export interface GenMeta {
  prompt: string;
  model: ModelName;
  resolution: Resolution;
  aspectRatio: string;
  billing: Billing;
  count: number;
  createdAt: number;
}

export interface HistoryItem {
  name: string;
  url: string;
  createdAt: number;
  size: number;
  meta?: GenMeta;
}

export interface GenParams {
  prompt: string;
  model: ModelName;
  resolution: Resolution;
  aspectRatio: string;
  billing: Billing;
  count: number;
}

/** Natural-pixel rect (padded, clamped) a local-repaint crop/composite operates on. */
export interface InpaintBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Live brush selection: a feathered alpha-mask PNG (natural image size) + its bounding box. */
export interface InpaintMask {
  maskUrl: string;
  bboxPx: InpaintBBox;
}

/** Snapshot of the mask/bbox/source image taken at submit time, so a later mask edit
 *  (e.g. the user reopens the brush panel while a job is still running) can't affect
 *  how an in-flight job's results get composited back. */
export interface InpaintJob {
  origSrc: string;
  bboxPx: InpaintBBox;
  maskUrl: string;
}
