import { randomUUID } from "node:crypto";

export type UploadMediaKind = "image" | "video" | "audio";

type MediaSpec = {
  kind: UploadMediaKind;
  contentType: string;
  extension: string;
  maxBytes: number;
};

export class MediaValidationError extends Error {}

const MB = 1024 * 1024;
const MEDIA_TYPES: Record<string, MediaSpec> = {
  "image/jpeg": { kind: "image", contentType: "image/jpeg", extension: "jpg", maxBytes: 30 * MB },
  "image/jpg": { kind: "image", contentType: "image/jpeg", extension: "jpg", maxBytes: 30 * MB },
  "image/png": { kind: "image", contentType: "image/png", extension: "png", maxBytes: 30 * MB },
  "image/webp": { kind: "image", contentType: "image/webp", extension: "webp", maxBytes: 30 * MB },
  "image/bmp": { kind: "image", contentType: "image/bmp", extension: "bmp", maxBytes: 30 * MB },
  "image/tiff": { kind: "image", contentType: "image/tiff", extension: "tiff", maxBytes: 30 * MB },
  "image/gif": { kind: "image", contentType: "image/gif", extension: "gif", maxBytes: 30 * MB },
  "image/heic": { kind: "image", contentType: "image/heic", extension: "heic", maxBytes: 30 * MB },
  "image/heif": { kind: "image", contentType: "image/heif", extension: "heif", maxBytes: 30 * MB },
  "video/mp4": { kind: "video", contentType: "video/mp4", extension: "mp4", maxBytes: 200 * MB },
  "video/quicktime": { kind: "video", contentType: "video/quicktime", extension: "mov", maxBytes: 200 * MB },
  "audio/wav": { kind: "audio", contentType: "audio/wav", extension: "wav", maxBytes: 15 * MB },
  "audio/x-wav": { kind: "audio", contentType: "audio/wav", extension: "wav", maxBytes: 15 * MB },
  "audio/mpeg": { kind: "audio", contentType: "audio/mpeg", extension: "mp3", maxBytes: 15 * MB },
  "audio/mp3": { kind: "audio", contentType: "audio/mpeg", extension: "mp3", maxBytes: 15 * MB },
};

const EXTENSION_TYPES: Record<string, string> = Object.fromEntries(
  Object.values(MEDIA_TYPES).map((spec) => [spec.extension, spec.contentType]),
);

export type PresignResult = {
  uploadUrl: string;
  publicUrl: string;
  method: "PUT" | "POST";
  provider: string;
  headers: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parsePresignResult(payload: unknown): PresignResult {
  if (!isRecord(payload)) throw new Error("预签名响应格式异常");
  const candidates = [payload, payload.data, payload.result].filter(isRecord);
  for (const candidate of candidates) {
    const uploadUrl = candidate.upload_url ?? candidate.uploadUrl;
    const publicUrl = candidate.public_url ?? candidate.publicUrl ?? candidate.url;
    if (typeof uploadUrl !== "string" || typeof publicUrl !== "string") continue;

    const rawMethod = String(candidate.method ?? "PUT").toUpperCase();
    if (rawMethod !== "PUT" && rawMethod !== "POST") {
      throw new Error(`不支持的素材上传方法: ${rawMethod}`);
    }
    const headers = isRecord(candidate.headers)
      ? Object.fromEntries(
          Object.entries(candidate.headers)
            .filter(([, value]) => value != null)
            .map(([key, value]) => [key, String(value)]),
        )
      : {};
    return {
      uploadUrl,
      publicUrl,
      method: rawMethod,
      provider: String(candidate.provider ?? "r2").toLowerCase(),
      headers,
    };
  }
  throw new Error("预签名响应缺少上传地址或公网地址");
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

export function buildPresignedUploadHeaders(
  presign: PresignResult,
  contentType: string,
  apiKey: string,
): Record<string, string> {
  const headers = { ...presign.headers };
  if (!hasHeader(headers, "content-type")) headers["Content-Type"] = contentType;
  if (presign.provider === "local") {
    if (!hasHeader(headers, "authorization")) headers.Authorization = `Bearer ${apiKey}`;
  } else {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization") delete headers[key];
    }
  }
  return headers;
}

/** 按魔数嗅探真实格式。用于纠正「扩展名 / 声明类型与内容不符」的文件
 *  （典型：生成服务返回 JPEG 字节但下载时命名为 .png，再上传时浏览器按
 *  扩展名声明 image/png）。识别不出返回 null。 */
export function detectContentType(bytes: Uint8Array): string | null {
  const has = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, length: number) => Buffer.from(bytes.slice(start, start + length)).toString("ascii");
  if (has(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "RF64" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "II*\0" || ascii(0, 4) === "MM\0*") return "image/tiff";
  if (ascii(4, 4) === "ftyp") {
    // ISO-BMFF 家族靠 major brand 区分：HEIC/HEIF 图片、QuickTime、MP4
    const brand = ascii(8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  if (["moov", "mdat", "wide", "free", "skip"].includes(ascii(4, 4))) return "video/quicktime";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, 2) === "BM") return "image/bmp"; // 2 字节弱签名放最后，避免误吞
  return null;
}

export function validateMediaSignature(bytes: Uint8Array, contentType: string, filename?: string): void {
  const has = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, length: number) => Buffer.from(bytes.slice(start, start + length)).toString("ascii");
  let valid = false;
  switch (contentType) {
    case "image/jpeg": valid = has(0xff, 0xd8, 0xff); break;
    case "image/png": valid = has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a); break;
    case "image/webp": valid = ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP"; break;
    case "image/bmp": valid = ascii(0, 2) === "BM"; break;
    case "image/tiff": valid = (ascii(0, 4) === "II*\0") || (ascii(0, 4) === "MM\0*"); break;
    case "image/gif": valid = ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a"; break;
    case "image/heic":
    case "image/heif":
    case "video/mp4":
      valid = ascii(4, 4) === "ftyp";
      break;
    case "video/quicktime":
      valid = ["ftyp", "moov", "mdat", "wide"].includes(ascii(4, 4));
      break;
    case "audio/wav": valid = ["RIFF", "RF64"].includes(ascii(0, 4)) && ascii(8, 4) === "WAVE"; break;
    case "audio/mpeg":
      valid = ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
      break;
  }
  if (!valid) {
    // 带上文件名 + 声明类型 + 实际文件头，方便定位是哪个文件、真实格式是什么
    const head = Buffer.from(bytes.slice(0, 12)).toString("hex");
    throw new MediaValidationError(
      `素材文件内容与声明格式不一致${filename ? `（${filename}）` : ""}：声明 ${contentType}，文件头 ${head}`,
    );
  }
}

function resolveMediaSpec(file: Blob & { name?: string }): MediaSpec {
  const declared = (file.type || "").toLowerCase().split(";", 1)[0];
  let spec = MEDIA_TYPES[declared];
  if (!spec && file.name) {
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    const fallbackType = EXTENSION_TYPES[extension];
    if (fallbackType) spec = MEDIA_TYPES[fallbackType];
  }
  if (!spec) {
    throw new MediaValidationError("仅支持图片、MP4/MOV 视频和 WAV/MP3 音频素材");
  }
  if (file.size <= 0) throw new MediaValidationError("素材文件为空");
  if (file.size > spec.maxBytes) {
    throw new MediaValidationError(
      `${spec.kind === "image" ? "图片" : spec.kind === "video" ? "视频" : "音频"}大小 ` +
      `${(file.size / MB).toFixed(1)}MB 超过 ${spec.maxBytes / MB}MB 上限`,
    );
  }
  return spec;
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 校验 + 读取字节 + 定型（含魔数嗅探纠正声明类型），产出随机文件名。
 *  R2 直传与上游网关上传共用同一套校验，避免两处逻辑漂移。 */
async function validateAndReadMedia(
  file: Blob & { name?: string },
): Promise<{ bytes: Buffer; spec: MediaSpec; filename: string }> {
  let spec = resolveMediaSpec(file);
  const bytes = Buffer.from(await file.arrayBuffer());
  // 声明类型与真实内容不符时，以魔数嗅探结果为准（同一 kind 内纠正，比如
  // .png 实为 JPEG 的生成图下载件）。跨 kind（比如 .png 实为 MP4）仍然拒绝。
  const sniffed = detectContentType(bytes);
  if (sniffed && sniffed !== spec.contentType) {
    const sniffedSpec = MEDIA_TYPES[sniffed];
    if (sniffedSpec && sniffedSpec.kind === spec.kind) spec = sniffedSpec;
  }
  const filename = `${randomUUID()}.${spec.extension}`;
  validateMediaSignature(bytes, spec.contentType, file.name);
  return { bytes, spec, filename };
}

/** 参考素材直传本项目 R2 的 inputs/ 空间，返回上游可抓取的预签名 URL。
 *  与生成结果（outputs/）分开存放，不进资产列表、不占租户配额。 */
export async function uploadMediaToR2(options: {
  file: Blob & { name?: string };
  uid: string;
}): Promise<{ url: string; kind: UploadMediaKind }> {
  const { bytes, spec, filename } = await validateAndReadMedia(options.file);
  const { putInputObject } = await import("./storage.server.ts");
  const url = await putInputObject(options.uid, filename, bytes, spec.contentType);
  return { url, kind: spec.kind };
}

export async function uploadMediaFile(options: {
  file: Blob & { name?: string };
  baseUrl: string;
  apiKey: string;
}): Promise<{ url: string; kind: UploadMediaKind }> {
  const { file, baseUrl, apiKey } = options;
  const { bytes, spec, filename } = await validateAndReadMedia(file);

  const presignResponse = await fetch(`${baseUrl}/v1/storage/presign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, content_type: spec.contentType, size: file.size }),
    signal: withTimeout(10_000),
  });
  const presignText = await presignResponse.text();
  if (!presignResponse.ok) {
    throw new Error(`预签名失败 (${presignResponse.status}): ${presignText.slice(0, 200)}`);
  }

  let presignPayload: unknown;
  try {
    presignPayload = JSON.parse(presignText);
  } catch {
    throw new Error("预签名响应不是有效 JSON");
  }
  const presign = parsePresignResult(presignPayload);
  const uploadUrl = new URL(presign.uploadUrl, baseUrl).toString();
  const headers = buildPresignedUploadHeaders(presign, spec.contentType, apiKey);

  let lastError: unknown;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const response = await fetch(uploadUrl, {
        method: presign.method,
        headers,
        body: new Uint8Array(bytes),
        signal: withTimeout(180_000),
      });
      if (![200, 201, 204].includes(response.status)) {
        const text = await response.text();
        throw new Error(`素材上传失败 (${response.status}): ${text.slice(0, 200)}`);
      }
      return { url: presign.publicUrl, kind: spec.kind };
    } catch (error) {
      // HTTP failures are deterministic; only retry connection/timeout errors.
      if (error instanceof Error && error.message.startsWith("素材上传失败")) throw error;
      lastError = error;
      if (attempt === 3) break;
      await sleep(2_000 * 2 ** attempt);
    }
  }
  throw new Error(`素材上传失败（已重试 3 次）: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
