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
