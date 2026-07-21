import { clsx, type ClassValue } from "clsx";
import type { InpaintJob } from "./types";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Strip a trailing file extension for display labels (batch workshop tile
 *  badges, download/note names) — "红色连衣裙.jpg" -> "红色连衣裙". Files with
 *  no recognized extension pass through untouched. */
export function stripExt(filename: string): string {
  return filename.replace(/\.(png|jpe?g|webp|gif|bmp|avif)$/i, "");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** HH:MM:SS (24h, local time) — used by the diagnostics log list. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface DownscaledImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Read a file/blob as-is into a data URL — no re-encoding, no resizing. Browser-only. */
export function fileToDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale + recompress an image to a JPEG data URL under a max dimension.
 * Keeps request bodies small (the o1key server caps payloads at 20 MB). Transparent
 * areas are flattened onto white, which suits e-commerce product refs. Browser-only.
 */
export async function fileToDownscaledDataURL(
  file: File | Blob,
  maxDim = 1600,
  quality = 0.92,
): Promise<DownscaledImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error("无法创建画布上下文");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl, width: w, height: h };
}

/**
 * Piecewise-linear "believable wait" curve for a single image, tuned to a
 * 20-60s real generation time. Returns a percentage 0-96 (never hits 100 on
 * its own — the caller snaps to 100 once the job actually finishes).
 */
export function fakeProgressCurve(seconds: number): number {
  const t = Math.max(0, seconds);
  if (t <= 2) return (t / 2) * 8;
  if (t <= 15) return 8 + ((t - 2) / 13) * (45 - 8);
  if (t <= 40) return 45 + ((t - 15) / 25) * (78 - 45);
  if (t <= 70) return 78 + ((t - 40) / 30) * (90 - 78);
  return Math.min(96, 90 + (t - 70) * 0.08);
}

/** Coarse "what's happening" copy for the fake-progress bar. progress is 0-100. */
export function progressStageLabel(progress: number): string {
  if (progress < 15) return "正在理解图片…";
  if (progress < 50) return "正在构图…";
  if (progress < 85) return "正在绘制细节…";
  return "即将完成…";
}

/**
 * Same idea as fakeProgressCurve, tuned for "视觉反推" (vision analysis)
 * instead of image generation: typically 30-60s rather than 20-60s, and
 * capped at 95 (not 96) — the caller snaps to 100 the instant the real
 * response lands (finishVisionAnalysis sets visionProgress to 1).
 */
export function fakeVisionProgressCurve(seconds: number): number {
  const t = Math.max(0, seconds);
  if (t <= 2) return (t / 2) * 10;
  if (t <= 10) return 10 + ((t - 2) / 8) * (35 - 10);
  if (t <= 30) return 35 + ((t - 10) / 20) * (70 - 35);
  if (t <= 55) return 70 + ((t - 30) / 25) * (90 - 70);
  return Math.min(95, 90 + (t - 55) * 0.1);
}

/** Stage copy for the vision-analysis progress card. progress is 0-100. */
export function visionProgressStageLabel(progress: number): string {
  if (progress < 25) return "读取画面…";
  if (progress < 55) return "分析构图与光影…";
  if (progress < 85) return "提取色彩与材质…";
  return "整理提示词…";
}

export interface GridPacking {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

/**
 * Choose a column count for `n` uniform tiles inside a `w`×`h` box (with
 * `gap` between tiles) that maximizes the tile's shorter edge — the
 * "everything fits on screen at the largest readable size, never scrolls"
 * packing used by the batch workshop's garment wall (PLAN-BATCH D6:
 * "枚举列数取「最小格边长最大」的方案"). Enumerates every column count from 1
 * to n (O(n), n is capped at MAX_BATCH_GARMENTS + 1 by the caller) and keeps
 * whichever minimizes wasted space. Returns a zero-size 1×1 box for n<=0 or
 * a box with no room, rather than throwing.
 */
export function packGrid(n: number, w: number, h: number, gap = 8): GridPacking {
  if (n <= 0 || w <= 0 || h <= 0) return { cols: 1, rows: 1, cellW: 0, cellH: 0 };
  let best: GridPacking = { cols: 1, rows: n, cellW: w, cellH: Math.max(0, (h - gap * (n - 1)) / n) };
  let bestEdge = Math.min(best.cellW, best.cellH);
  for (let cols = 2; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = Math.max(0, (w - gap * (cols - 1)) / cols);
    const cellH = Math.max(0, (h - gap * (rows - 1)) / rows);
    const edge = Math.min(cellW, cellH);
    if (edge > bestEdge) {
      bestEdge = edge;
      best = { cols, rows, cellW, cellH };
    }
  }
  return best;
}

export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Load an <img> element from a src (data URL or same-origin URL), resolving once
 *  decoded. Browser-only. Shared by every canvas helper below that needs pixel data. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("加载图片失败"));
    img.src = src;
  });
}

/** Crop a region (natural-pixel rect) out of an image src into a JPEG (default) or
 *  PNG data URL. PNG mode skips the white-background fill and preserves alpha;
 *  quality is ignored in that case. Browser-only. */
export async function cropImageToDataURL(
  src: string,
  rect: { x: number; y: number; width: number; height: number },
  quality = 0.94,
  format: "image/jpeg" | "image/png" = "image/jpeg",
): Promise<DownscaledImage> {
  const img = await loadImage(src);
  const sx = Math.min(Math.max(0, Math.round(rect.x)), img.naturalWidth - 1);
  const sy = Math.min(Math.max(0, Math.round(rect.y)), img.naturalHeight - 1);
  const sw = Math.max(1, Math.min(Math.round(rect.width), img.naturalWidth - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height), img.naturalHeight - sy));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  if (format === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const dataUrl = format === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
  return { dataUrl, width: sw, height: sh };
}

/**
 * Composite an ordered list of sticker overlays onto a base image, at the
 * base image's own natural resolution (display size is irrelevant — the
 * caller only ever hands over percentage-based geometry). Each sticker's
 * width is `wFrac` of the base's natural width, height keeps the sticker's
 * own aspect ratio, and it's placed/rotated around its center (`cx`/`cy`,
 * fractions of the base). Draw order follows array order, so later stickers
 * land on top. Browser-only; not covered by unit tests for the same reason
 * as cropImageToDataURL (canvas has no jsdom implementation).
 */
export async function compositeStickersToDataURL(
  baseSrc: string,
  stickers: { src: string; cx: number; cy: number; wFrac: number; rotation: number }[],
): Promise<{ dataUrl: string; width: number; height: number }> {
  const base = await loadImage(baseSrc);
  const baseNatW = base.naturalWidth;
  const baseNatH = base.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = baseNatW;
  canvas.height = baseNatH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.drawImage(base, 0, 0, baseNatW, baseNatH);

  const images = await Promise.all(stickers.map((s) => loadImage(s.src)));
  stickers.forEach((s, i) => {
    const img = images[i];
    const drawW = s.wFrac * baseNatW;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(s.cx * baseNatW, s.cy * baseNatH);
    ctx.rotate(s.rotation);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  });

  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, width: baseNatW, height: baseNatH };
}

/**
 * Downscale + recompress an already full-resolution canvas src (data URL or
 * same-origin URL) to a JPEG data URL under a max dimension. Unlike
 * fileToDownscaledDataURL (which shrinks a freshly-picked File), this sits at
 * the network/submit boundary only — the canvas itself keeps the original,
 * full-resolution image; this produces a separate, smaller copy just for the
 * request payload. Transparent areas are flattened onto white. Browser-only.
 */
export async function downscaleImageSrc(
  src: string,
  maxDim = 1600,
  quality = 0.92,
): Promise<DownscaledImage> {
  const img = await loadImage(src);
  const { naturalWidth: width, naturalHeight: height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl, width: w, height: h };
}

/**
 * Extract up to `maxFrames` evenly-spaced JPEG frames from a video for models
 * without native video input (see agentModels.modelSupportsVideo — Gemini
 * gets the raw video instead). Short clips get roughly one frame per second
 * so a 3s video doesn't produce 8 near-identical frames. Throws when the
 * browser can't decode the container (e.g. avi/wmv) — callers degrade to
 * "Gemini only" for that attachment. Browser-only.
 */
export async function extractVideoFrames(
  src: string,
  maxFrames = 8,
  maxDim = 768,
  quality = 0.8,
): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("视频解码失败"));
  });
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长");
  const count = Math.min(maxFrames, Math.max(2, Math.ceil(duration)));

  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    // Mid-slot sampling; nudge off the exact end so the last seek resolves.
    const t = Math.min(((i + 0.5) / count) * duration, Math.max(0, duration - 0.05));
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("视频解码失败"));
      video.currentTime = t;
    });
    ctx.drawImage(video, 0, 0, w, h);
    frames.push(canvas.toDataURL("image/jpeg", quality));
  }
  video.removeAttribute("src");
  video.load();
  return frames;
}

/**
 * Capture a single full-resolution frame from a video at time `t` (seconds) as
 * a JPEG File — used by the "extract frame" feature to turn a reference video's
 * first/last frame, or a generated clip's final frame, into a picture that can
 * be dropped straight into a start/end/reference slot. Unlike
 * extractVideoFrames this keeps the video's native pixel size (frame slots
 * enforce their own 300-6000px / 0.4-2.5 ratio limits downstream) and returns a
 * File so it flows through the same prepareImageAsset path as an uploaded image.
 *
 * Throws "无法读取该视频（可能是跨域直链）…" when the source is a cross-origin
 * remote URL whose server sends no CORS headers: drawing it taints the canvas
 * and toBlob/toDataURL then throws a SecurityError. Callers should point the
 * user at the locally-saved copy (blob URL / same-origin output) instead.
 * Browser-only.
 */
export async function captureVideoFrameAt(
  src: string,
  t: number,
  quality = 0.92,
): Promise<File> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = src;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("视频解码失败"));
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长");

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error("无法读取视频尺寸");
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");

    // Clamp a hair inside [0, duration] so seeking to the very last frame still
    // resolves onseeked (an exact-end seek can hang on some decoders).
    const target = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("视频解码失败"));
      video.currentTime = target;
    });

    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
      } catch {
        // Tainted canvas (cross-origin source without CORS) throws synchronously.
        resolve(null);
      }
    });
    if (!blob) throw new Error("无法读取该视频（可能是跨域直链），请使用已保存到本地的视频再提取");
    return new File([blob], `frame-${Math.round(target * 1000)}.jpg`, { type: "image/jpeg" });
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * Composite one local-repaint result block back onto the original image at its
 * bounding box: stretch the (arbitrary-size) result into the bbox, gate its
 * edges through the matching crop of the feathered alpha mask
 * (globalCompositeOperation "destination-in"), then paste that feathered block
 * onto a full copy of the original image. Throws on any decode/canvas failure —
 * callers should fall back to the raw, uncomposited result on a per-image basis
 * rather than failing an entire batch (see Studio.tsx's polling `finish()`).
 * The output canvas keeps the original image's exact pixel dimensions
 * (orig.naturalWidth × orig.naturalHeight) and is exported as a lossless PNG
 * blob (not re-compressed JPEG), so the composited result never loses
 * resolution or gains new compression artifacts versus the source.
 */
export async function compositeInpaintResult(
  job: InpaintJob,
  resultSrc: string,
): Promise<{ url: string; blob: Blob }> {
  const [orig, mask, result] = await Promise.all([loadImage(job.origSrc), loadImage(job.maskUrl), loadImage(resultSrc)]);
  const { x, y, w, h } = job.bboxPx;

  const block = document.createElement("canvas");
  block.width = w;
  block.height = h;
  const bctx = block.getContext("2d");
  if (!bctx) throw new Error("无法创建画布上下文");
  bctx.drawImage(result, 0, 0, w, h);
  bctx.globalCompositeOperation = "destination-in";
  // Crop just the bbox region out of the full-image mask (source rect) onto
  // the block (dest rect) — both are w×h, so this is an unstretched 1:1 copy
  // that lines the mask's feathered edge up with the actual crop boundary.
  bctx.drawImage(mask, x, y, w, h, 0, 0, w, h);

  const main = document.createElement("canvas");
  main.width = orig.naturalWidth;
  main.height = orig.naturalHeight;
  const mctx = main.getContext("2d");
  if (!mctx) throw new Error("无法创建画布上下文");
  mctx.drawImage(orig, 0, 0);
  mctx.drawImage(block, x, y);

  const blob = await new Promise<Blob | null>((resolve) => main.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("导出合成图失败");
  return { url: URL.createObjectURL(blob), blob };
}
