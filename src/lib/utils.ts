import { clsx, type ClassValue } from "clsx";
import type { InpaintJob } from "./types";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
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

/** Crop a region (natural-pixel rect) out of an image src into a JPEG data URL. Browser-only. */
export async function cropImageToDataURL(
  src: string,
  rect: { x: number; y: number; width: number; height: number },
  quality = 0.94,
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
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width: sw, height: sh };
}

/**
 * Composite one local-repaint result block back onto the original image at its
 * bounding box: stretch the (arbitrary-size) result into the bbox, gate its
 * edges through the matching crop of the feathered alpha mask
 * (globalCompositeOperation "destination-in"), then paste that feathered block
 * onto a full copy of the original image. Throws on any decode/canvas failure —
 * callers should fall back to the raw, uncomposited result on a per-image basis
 * rather than failing an entire batch (see Studio.tsx's polling `finish()`).
 */
export async function compositeInpaintResult(job: InpaintJob, resultSrc: string): Promise<string> {
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

  return main.toDataURL("image/jpeg", 0.94);
}
