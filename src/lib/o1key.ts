// TypeScript port of the o1key Nano Banana async image API client.
// Faithful to scripts/generate_image.py from the o1key-nano-banana skill:
//   POST {base}/async/v1/generateImage      -> task_id
//   GET  {base}/async/v1/tasks/{task_id}     -> poll until success / failure
// Server-only module (uses fetch + Buffer). Imported by route handlers.

import type { RouteName } from "./types";

export const NETWORK_ROUTES: Record<RouteName, string> = {
  全球加速: "https://api.o1key.cn",
  CF加速: "https://cf-api.o1key.com",
  美国直连: "https://api.o1key.com",
};
export const DEFAULT_ROUTE: RouteName = "全球加速";

export const SUBMIT_ENDPOINT = "/async/v1/generateImage";
export const TASK_ENDPOINT = "/async/v1/tasks/";
export const MAX_BODY_BYTES = 20_000_000; // 20 MB — server rejects larger payloads

const MODEL_ID_MAP: Record<string, string> = {
  "Nano Banana Pro": "nano-banana-pro",
  "Nano Banana 2": "nano-banana-2",
  "Nano Banana": "nano-banana",
};
const RESOLUTION_KEY_MAP: Record<string, string> = { "512": "0.5k", "1K": "1k", "2K": "2k", "4K": "4k" };

const SUCCESS = new Set(["success", "succeed", "succeeded", "completed", "done", "finished"]);
const FAILURE = new Set([
  "failure", "fail", "failed", "error", "expired", "timeout", "timed_out",
  "cancel", "canceled", "cancelled", "rejected",
]);
const RUNNING = new Set([
  "submitted", "queued", "pending", "running", "processing", "in_progress", "in-progress", "created",
]);

export function resolveBaseUrl(route: RouteName, override?: string): string {
  if (override && override.trim()) return override.trim().replace(/\/+$/, "");
  return NETWORK_ROUTES[route] ?? NETWORK_ROUTES[DEFAULT_ROUTE];
}

/**
 * Translate a friendly model name + resolution + billing into the API model id.
 * A value that already looks like a raw id (nano-banana-*) passes through untouched.
 */
export function buildModelId(modelName: string, resolution: string, billing: string): string {
  if (!(modelName in MODEL_ID_MAP) && modelName.toLowerCase().startsWith("nano-banana")) {
    return modelName;
  }
  const base = MODEL_ID_MAP[modelName] ?? "nano-banana-pro";
  const isOfficial = billing === "官方" || billing === "official";

  if (base === "nano-banana") {
    if (isOfficial) throw new Error('模型 "Nano Banana" 仅支持特价计费');
    return "nano-banana";
  }
  const resKey = RESOLUTION_KEY_MAP[resolution] ?? "2k";

  if (base === "nano-banana-pro" && resKey === "1k" && !isOfficial) return "nano-banana-pro";
  if (base === "nano-banana-2" && resKey === "0.5k") {
    if (isOfficial) throw new Error("Nano Banana 2 的 512 分辨率仅支持特价计费");
    return "nano-banana-2-0.5k";
  }
  let id = `${base}-${resKey}`;
  if (isOfficial) id += "-official";
  return id;
}

export interface SubmitBody {
  model: string;
  prompt: string;
  size: string;
  aspect_ratio?: string;
  images?: string[];
  google_search?: boolean;
}

export function buildSubmitBody(opts: {
  modelId: string;
  prompt: string;
  resolution: string;
  aspectRatio?: string;
  images?: string[];
  googleSearch?: boolean;
}): SubmitBody {
  const body: SubmitBody = {
    model: opts.modelId,
    prompt: opts.prompt,
    size: opts.resolution === "512" ? "512px" : opts.resolution,
  };
  const ar = opts.aspectRatio;
  if (ar && ar !== "auto" && ar !== "智能" && ar !== "") body.aspect_ratio = ar;
  if (opts.images && opts.images.length) body.images = opts.images;
  if (opts.googleSearch) body.google_search = true;
  return body;
}

// ── Robust payload scanning (mirrors the node/script) ────────────────────────

function* payloadSources(payload: unknown): Generator<Record<string, unknown>> {
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || Array.isArray(cur) || seen.has(cur)) continue;
    seen.add(cur);
    const rec = cur as Record<string, unknown>;
    yield rec;
    for (const key of ["data", "result", "response", "output", "task_result", "content"]) {
      const v = rec[key];
      if (v && typeof v === "object" && !Array.isArray(v)) queue.push(v);
    }
  }
}

export function extractTaskId(payload: unknown): string {
  for (const src of payloadSources(payload)) {
    for (const key of ["task_id", "taskId", "id"]) {
      const v = src[key];
      if (v) return String(v);
    }
  }
  throw new Error("提交响应中未找到 task_id: " + JSON.stringify(payload).slice(0, 300));
}

function extractStatusRaw(payload: unknown): string {
  const found: string[] = [];
  for (const src of payloadSources(payload)) {
    for (const key of ["status", "task_status", "state", "task_state"]) {
      const v = src[key];
      if (v != null && String(v).trim()) found.push(String(v).trim());
    }
  }
  for (const s of found) if (FAILURE.has(s.toLowerCase())) return s;
  for (const s of found) if (RUNNING.has(s.toLowerCase())) return s;
  for (const s of found) if (SUCCESS.has(s.toLowerCase())) return s;
  return found[0] ?? "";
}

function normalizeStatus(raw: string): "running" | "success" | "failed" {
  const s = (raw || "").toLowerCase();
  if (FAILURE.has(s) || ["fail", "error", "reject", "timeout", "cancel"].some((t) => s.includes(t))) {
    return "failed";
  }
  if (SUCCESS.has(s)) return "success";
  return "running"; // unknown but non-terminal -> keep polling
}

function extractProgress(payload: unknown): number | null {
  for (const src of payloadSources(payload)) {
    for (const key of ["progress", "percentage", "percent"]) {
      const v = src[key];
      if (typeof v === "number") return v > 1 ? v / 100 : v;
    }
  }
  return null;
}

function extractErrorMessage(payload: unknown): string {
  for (const src of payloadSources(payload)) {
    const err = src["error"];
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      for (const key of ["message", "msg", "detail", "reason", "code"]) if (e[key]) return String(e[key]);
    } else if (err) {
      return String(err);
    }
    for (const key of [
      "fail_reason", "failure_reason", "task_status_msg", "status_msg",
      "error_message", "message", "msg", "reason", "detail",
    ]) {
      if (src[key]) return String(src[key]);
    }
  }
  return "未知错误";
}

export interface ResultImage {
  kind: "url" | "b64";
  value: string;
}

export function extractResultImages(payload: unknown): ResultImage[] {
  const out: ResultImage[] = [];
  const seen = new Set<string>();
  const addUrl = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("http") && !seen.has(v)) {
      seen.add(v);
      out.push({ kind: "url", value: v });
    }
  };
  const addB64 = (v: unknown) => {
    if (typeof v === "string" && v && !seen.has(v)) {
      seen.add(v);
      out.push({ kind: "b64", value: v });
    }
  };
  const handleItem = (item: unknown) => {
    if (typeof item === "string") {
      if (item.startsWith("http")) addUrl(item);
      else if (item.startsWith("data:image")) addB64(item.split(",", 2)[1]);
      return;
    }
    if (!item || typeof item !== "object") return;
    const it = item as Record<string, unknown>;
    for (const k of ["url", "image_url", "result_url", "download_url"]) addUrl(it[k]);
    for (const k of ["b64_json", "base64", "image_base64"]) if (it[k]) addB64(String(it[k]));
    for (const ik of ["inline_data", "inlineData"]) {
      const inl = it[ik];
      if (inl && typeof inl === "object" && (inl as Record<string, unknown>).data) {
        addB64(String((inl as Record<string, unknown>).data));
      }
    }
  };
  for (const src of payloadSources(payload)) {
    for (const k of ["image_url", "result_url", "url", "download_url"]) addUrl(src[k]);
    for (const k of ["images", "output_images", "outputs"]) {
      const v = src[k];
      if (Array.isArray(v)) for (const item of v) handleItem(item);
      else if (v) handleItem(v);
    }
  }
  return out;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

export async function submitTask(baseUrl: string, apiKey: string, body: SubmitBody): Promise<string> {
  const url = `${baseUrl}${SUBMIT_ENDPOINT}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `网络连接失败，无法连接 ${url}：${(e as Error)?.message || e}。请在设置里换一条线路（CF加速 / 美国直连），或检查网络。`,
    );
  }
  const text = await res.text();
  if (![200, 201, 202].includes(res.status)) {
    throw new Error(`提交失败 HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("提交响应非 JSON: " + text.slice(0, 300));
  }
  return extractTaskId(payload);
}

export interface PollResult {
  status: "running" | "success" | "failed";
  progress: number | null;
  images: ResultImage[];
  error?: string;
}

export async function pollTaskOnce(baseUrl: string, apiKey: string, taskId: string): Promise<PollResult> {
  const url = `${baseUrl}${TASK_ENDPOINT}${encodeURIComponent(taskId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`查询任务失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("查询响应非 JSON");
  }
  const status = normalizeStatus(extractStatusRaw(payload) || "UNKNOWN");
  const progress = extractProgress(payload);
  if (status === "failed") return { status, progress, images: [], error: extractErrorMessage(payload) };
  if (status === "success") return { status, progress, images: extractResultImages(payload) };
  return { status: "running", progress, images: [] };
}

/** Download a result image (URL or base64) into bytes + a file extension. */
export async function fetchResultBytes(img: ResultImage, apiKey: string): Promise<{ bytes: Buffer; ext: string }> {
  if (img.kind === "url") {
    let res: Response;
    try {
      res = await fetch(img.value, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) throw new Error("auth fetch failed");
    } catch {
      res = await fetch(img.value); // result URLs are often pre-signed and reject the auth header
    }
    const ab = await res.arrayBuffer();
    const ctype = (res.headers.get("content-type") || "image/png").split(";")[0].trim();
    const ext = ctype.includes("jpeg") || ctype.includes("jpg") ? ".jpg" : ctype.includes("webp") ? ".webp" : ".png";
    return { bytes: Buffer.from(ab), ext };
  }
  const bytes = Buffer.from(img.value, "base64");
  let ext = ".png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ext = ".jpg";
  else if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") ext = ".webp";
  return { bytes, ext };
}
