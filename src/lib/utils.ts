import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Crop a region (natural-pixel rect) out of an image src into a JPEG data URL. Browser-only. */
export async function cropImageToDataURL(
  src: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<DownscaledImage> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("加载图片失败"));
    img.src = src;
  });
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
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.94), width: sw, height: sh };
}
