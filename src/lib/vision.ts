// "视觉反推" (visual reverse-engineering): send the canvas image to a
// vision-capable chat model on the same o1key/new-api gateway and get back a
// structured JSON description usable as a standalone text-to-image prompt.
//
// This is deliberately separate from o1key.ts: that module is the async
// image-GENERATION client (submit/poll/download against /async/v1/...). This
// one is a single synchronous call against the gateway's standard
// OpenAI-compatible /v1/chat/completions endpoint — a different API surface
// on the same base URL, used purely for image understanding. Server-only
// (uses fetch + fs). Imported by route handlers.

import { promises as dns } from "dns";
import { getObject, ownsAsset } from "./storage.server.ts";
import * as http from "http";
import * as https from "https";
import { isIP } from "net";
import path from "path";
import { VISION_MODELS } from "./visionModels.ts";

const MEDIA_EXT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const REMOTE_IMAGE_TYPES = new Set(Object.values(MEDIA_EXT_TYPES));
const MAX_REMOTE_IMAGE_BYTES = 14_000_000;
const MAX_LOCAL_IMAGE_BYTES = 14_000_000;
const MAX_REMOTE_REDIRECTS = 3;
const REMOTE_IMAGE_TIMEOUT_MS = 30_000;

export const VISION_CHAT_ENDPOINT = "/v1/chat/completions";

// Server-side timeout for a single vision call. Generous because
// reasoning_effort:"high" on a pro-tier model can genuinely take a while —
// confirmed live: a probe call spent almost its entire (tiny) token budget
// on internal reasoning before being cut off, so a slow real response is
// expected behavior, not a hang.
const VISION_TIMEOUT_MS = 180_000;

const SYSTEM_INSTRUCTION = `Analyze this image as a visual reverse-engineering expert. Extract ALL visually important information and output ONE JSON object (and nothing else) that would let a text-to-image model recreate this image as faithfully as possible.

Use this structure with concrete, specific English values (omit keys that do not apply):
{
  "scene": one-line summary of the image,
  "type": "photo / illustration / 3D render / product shot / ...",
  "main_subject": { identity, clothing, materials, colors, pose, expression, position in frame },
  "secondary_elements": [ ... ],
  "composition": framing, crop, subject placement, negative space, perspective,
  "camera": { angle, shot type, focal length feel, depth of field, lens effects },
  "lighting": { setup, direction, quality, shadows, highlights },
  "color_palette": { dominant colors with approximate hex, accents, overall grade and white balance },
  "materials_textures": notable surface qualities,
  "background": full description,
  "style": aesthetic, era, genre, brand vibe,
  "text_elements": exact visible text with font style, color and placement (empty array if none),
  "mood": atmosphere keywords,
  "quality": resolution and finish descriptors
}

Rules: be exhaustive and precise — name colors with hex estimates, give counts and positions; describe only what is actually visible; write every value in English; output raw JSON only, no markdown fences, no commentary.`;

interface VisionChatBody {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  }>;
  response_format: { type: "json_object" };
  temperature: number;
  // "推理强度" — the new-api gateway's chat-completions parameter for
  // controlling reasoning/thinking depth on models that support it (confirmed
  // against two independent new-api docs: apifox.newapi.ai's ChatCompletionRequest
  // schema and www.newapi.ai's official chat-completions reference — both list
  // reasoning_effort as the sole field for this, enum low/medium/high). This is
  // NOT the same as `thinking_level`, which is a different gateway convention
  // used only by the separate /async/v1/generateImage endpoint.
  reasoning_effort?: "low" | "medium" | "high";
}

function buildVisionBody(imageDataUrl: string, model: string, withReasoning: boolean): VisionChatBody {
  const body: VisionChatBody = {
    model,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this image and produce the JSON described in the system instructions." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  };
  if (withReasoning) body.reasoning_effort = "high";
  return body;
}

/**
 * The canvas image the client sends can be a fresh data: URL (upload / paste
 * / crop), a local /api/media/<file> path (loaded from history or a previous
 * result), or — rarely — an absolute upstream URL (the fallback in
 * /api/jobs/[id] when saving a result to disk failed). Normalize all three
 * into a data: URL: the vision call goes out to the external gateway, which
 * can't reach localhost, so local paths must be read straight off disk.
 */
export function isPrivateOrReservedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b, c] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  if (version === 6) {
    const lower = address.toLowerCase().split("%")[0];
    const mapped = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    if (mapped) return isPrivateOrReservedIp(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isPrivateOrReservedIp(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    }
    if (lower === "::" || lower === "::1") return true;
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00
      || (first & 0xffc0) === 0xfe80
      || (first & 0xffc0) === 0xfec0
      || (first & 0xff00) === 0xff00
      || lower.startsWith("2001:db8:")
      || lower.startsWith("2001:10:")
      || lower.startsWith("2001:20:");
  }
  return true;
}

export function isSupportedImageDataUrl(src: string): boolean {
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(src);
}

function localMediaName(src: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(src, "http://local.invalid");
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith("/api/media/")) return null;
  const encoded = parsed.pathname.slice("/api/media/".length);
  if (!encoded || encoded.includes("/")) return null;
  let name: string;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!name || path.basename(name) !== name || !MEDIA_EXT_TYPES[path.extname(name).toLowerCase()]) return null;
  return name;
}

/** Browser-submitted workflow inputs: self-contained data URLs, or the
 * caller's own /api/media assets — ownership is enforced again at resolve
 * time (readLocalImage), so a foreign name fails the run, never leaks. */
export function isAllowedWorkflowImageSource(src: string): boolean {
  return isSupportedImageDataUrl(src) || localMediaName(src) !== null;
}

async function readLocalImage(uid: string, name: string): Promise<Buffer> {
  // Ownership first: a guessed filename from another tenant must be
  // indistinguishable from a missing file.
  if (!ownsAsset(uid, name)) throw new Error("找不到本地图片文件");
  const bytes = await getObject(uid, name);
  if (!bytes) throw new Error("找不到本地图片文件");
  if (bytes.length > MAX_LOCAL_IMAGE_BYTES) throw new Error("本地图片超过大小上限");
  return bytes;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const normalizedHostname = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const literalFamily = isIP(normalizedHostname);
  const addresses = literalFamily
    ? [{ address: normalizedHostname, family: literalFamily }]
    : await dns.lookup(normalizedHostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new Error("远程图片地址指向私有或保留网络");
  }
  const selected = addresses[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

async function withinDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("远程图片读取超时");
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("远程图片读取超时")), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readRemoteImage(
  url: URL,
  redirectCount = 0,
  deadlineAt = Date.now() + REMOTE_IMAGE_TIMEOUT_MS,
): Promise<{ bytes: Buffer; type: string }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("仅支持 HTTP(S) 图片地址");
  if (url.username || url.password) throw new Error("远程图片地址不能包含认证信息");
  if (redirectCount > MAX_REMOTE_REDIRECTS) throw new Error("远程图片重定向次数过多");
  const resolved = await withinDeadline(resolvePublicAddress(url.hostname), deadlineAt);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    let totalTimer: NodeJS.Timeout | undefined;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      reject(error);
    };
    const finishResolve = (value: { bytes: Buffer; type: string }) => {
      if (settled) return;
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      resolve(value);
    };
    const request = client.get(url, {
      family: resolved.family,
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
      headers: { Accept: "image/png,image/jpeg,image/webp", "User-Agent": "TVision/1.0" },
    }, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return finishReject(new Error("远程图片重定向缺少地址"));
        let redirected: URL;
        try {
          redirected = new URL(location, url);
        } catch {
          return finishReject(new Error("远程图片重定向地址无效"));
        }
        void readRemoteImage(redirected, redirectCount + 1, deadlineAt).then(finishResolve, finishReject);
        return;
      }
      if (status !== 200) {
        response.resume();
        return finishReject(new Error(`无法读取图片 (HTTP ${status})`));
      }
      const type = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!REMOTE_IMAGE_TYPES.has(type)) {
        response.resume();
        return finishReject(new Error("远程地址返回的不是受支持图片"));
      }
      const declaredLength = Number(response.headers["content-length"] || 0);
      if (declaredLength > MAX_REMOTE_IMAGE_BYTES) {
        response.resume();
        return finishReject(new Error("远程图片超过大小上限"));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_REMOTE_IMAGE_BYTES) {
          response.destroy(new Error("远程图片超过大小上限"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        finishResolve({ bytes: Buffer.concat(chunks), type });
      });
      response.on("error", finishReject);
    });
    totalTimer = setTimeout(
      () => request.destroy(new Error("远程图片读取超时")),
      Math.max(1, deadlineAt - Date.now()),
    );
    request.setTimeout(Math.max(1, deadlineAt - Date.now()), () => request.destroy(new Error("远程图片读取超时")));
    request.on("error", finishReject);
  });
}

/** `uid`: required to resolve /api/media/<name> references — the read is
 *  scoped to that tenant's assets. Callers without a tenant context simply
 *  can't reference local media (data URLs / remote URLs still work). */
export async function resolveImageToDataUrl(src: string, uid?: string): Promise<string> {
  if (src.startsWith("data:")) {
    if (!isSupportedImageDataUrl(src)) throw new Error("不支持或无效的图片 data URL");
    return src;
  }

  if (src.startsWith("/")) {
    const name = localMediaName(src);
    if (!name) throw new Error("无法识别的本地图片地址");
    if (!uid) throw new Error("找不到本地图片文件");
    const ext = path.extname(name).toLowerCase();
    const type = MEDIA_EXT_TYPES[ext];
    if (!type) throw new Error("不支持的图片格式");
    const bytes = await readLocalImage(uid, name);
    return `data:${type};base64,${bytes.toString("base64")}`;
  }

  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const remote = await readRemoteImage(new URL(src));
      return `data:${remote.type};base64,${remote.bytes.toString("base64")}`;
    } catch (e) {
      throw new Error(`无法读取图片：${(e as Error)?.message || e}`);
    }
  }

  throw new Error("无法识别的图片格式");
}

/** Thrown by reverseEngineerPrompt on any failure. `message` is a friendly
 *  Chinese string safe for a toast; `detail` (when present) is the raw
 *  upstream response text, meant only for the diagnostics panel. */
export class VisionError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "VisionError";
    this.detail = detail;
  }
}

/** One HTTP call to the gateway, wrapped in a 180s timeout. Returns the raw
 *  status + body text; never throws for a non-200 status (the caller decides
 *  what a given status means), only for network-level failures/timeouts. */
async function callVisionOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageDataUrl: string,
  withReasoning: boolean,
): Promise<{ status: number; text: string }> {
  const url = `${baseUrl}${VISION_CHAT_ENDPOINT}`;
  const body = buildVisionBody(imageDataUrl, model, withReasoning);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function extractContent(text: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  const content = (payload as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  return typeof content === "string" && content ? content : null;
}

/** Call the gateway's chat completions endpoint and return the raw assistant
 *  text content (expected to be a JSON string; the caller decides how to
 *  parse/display it) plus which model actually produced it.
 *
 *  Tries VISION_MODELS in order. For each model, first attempts with
 *  reasoning_effort:"high"; if the gateway rejects that specific request with
 *  HTTP 400 (some models/providers 400 on an unsupported param rather than
 *  silently ignoring it), automatically retries once for that same model
 *  with reasoning_effort omitted entirely, then moves on to the next model in
 *  the list if that also fails. */
export async function reverseEngineerPrompt(
  baseUrl: string,
  apiKey: string,
  imageDataUrl: string,
): Promise<{ content: string; model: string }> {
  let lastMsg = "";
  let lastDetail = "";

  for (const model of VISION_MODELS) {
    let attempt: { status: number; text: string };
    try {
      attempt = await callVisionOnce(baseUrl, apiKey, model, imageDataUrl, true);
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      lastMsg = aborted
        ? `视觉解析超时（超过 ${VISION_TIMEOUT_MS / 1000}s，模型 ${model}）`
        : `网络连接失败：${(e as Error)?.message || e}`;
      lastDetail = String((e as Error)?.stack || e);
      continue;
    }

    if (attempt.status === 400) {
      // Auto-retry once without reasoning_effort — see function doc comment.
      let retry: { status: number; text: string };
      try {
        retry = await callVisionOnce(baseUrl, apiKey, model, imageDataUrl, false);
      } catch (e) {
        const aborted = (e as Error)?.name === "AbortError";
        lastMsg = aborted
          ? `视觉解析超时（超过 ${VISION_TIMEOUT_MS / 1000}s，模型 ${model}）`
          : `网络连接失败：${(e as Error)?.message || e}`;
        lastDetail = String((e as Error)?.stack || e);
        continue;
      }
      if (retry.status === 200) {
        const content = extractContent(retry.text);
        if (content) return { content, model };
        lastMsg = `视觉解析响应缺少内容（模型 ${model}）`;
        lastDetail = retry.text.slice(0, 2000);
        continue;
      }
      lastMsg = `视觉解析请求失败 HTTP ${retry.status}（模型 ${model}，已自动去除 reasoning_effort 参数重试仍失败）`;
      lastDetail = retry.text.slice(0, 2000);
      continue;
    }

    if (attempt.status !== 200) {
      lastMsg = `视觉解析请求失败 HTTP ${attempt.status}（模型 ${model}）`;
      lastDetail = attempt.text.slice(0, 2000);
      continue;
    }

    const content = extractContent(attempt.text);
    if (content) return { content, model };
    lastMsg = `视觉解析响应缺少内容（模型 ${model}）`;
    lastDetail = attempt.text.slice(0, 2000);
  }

  throw new VisionError(lastMsg || "视觉解析失败，所有模型均不可用", lastDetail);
}

export interface NormalizedVisionPrompt {
  text: string;
  /** false when content wasn't valid JSON — the raw text was used as-is. */
  parsed: boolean;
}

/** Best-effort pretty-print: if the model's content is valid JSON, re-format
 *  it for readability; otherwise pass the raw trimmed text through untouched
 *  so the user still gets something usable in the prompt box, with `parsed:
 *  false` so the caller can surface a warning. */
export function normalizeVisionPrompt(content: string): NormalizedVisionPrompt {
  try {
    const parsed = JSON.parse(content);
    return { text: JSON.stringify(parsed, null, 2), parsed: true };
  } catch {
    return { text: content.trim(), parsed: false };
  }
}
