"use client";

// Shared file→canvas ingestion for 单图创作, used by the canvas
// (Stage.tsx: drop/click/paste). Central rules: main image stays
// full-resolution, references get downscaled to 1400px, and TVision PNG
// metadata restores the original prompt/params.

import { getAction } from "./actions";
import { MAX_REF_IMAGES } from "./limits";
import { extractImageText, PNG_META_KEYWORD } from "./pngMeta";
import { useStudio } from "./store";
import { parseEmbeddedMeta } from "./templates";
import { fileToDataURL, fileToDownscaledDataURL, loadImage } from "./utils";

/** Keep only image files; toast once if anything else was mixed in. */
export function filterImageFiles(files: File[]): File[] {
  const images = files.filter((f) => !f.type || f.type.startsWith("image/"));
  if (images.length < files.length) useStudio.getState().showToast("error", "请选择图片文件");
  return images;
}

/** PLAN-TEMPLATE: a TVision-generated PNG carries its own recipe (iTXt chunk,
 *  see pngMeta.ts) — restore prompt/params from the ORIGINAL file bytes
 *  (downscaling re-encodes and strips the chunk). Returns whether it restored. */
async function restoreEmbeddedMeta(file: File): Promise<boolean> {
  try {
    const meta = extractImageText(new Uint8Array(await file.arrayBuffer()), PNG_META_KEYWORD);
    const params = meta ? parseEmbeddedMeta(meta) : null;
    if (params) {
      useStudio.getState().updateParams(params);
      useStudio.getState().showToast("success", "检测到 TVision 生成信息，已还原当时的提示词与参数");
      return true;
    }
  } catch {
    // best-effort — the image itself already landed
  }
  return false;
}

/** The canvas reset flow (Stage drop/click/paste): 1st file becomes the
 *  full-resolution main image (resetting action/refs/prompt — see
 *  store.setImage), the rest become reference images. Returns true once the
 *  main image actually landed. */
export async function setMainFromFiles(files: File[]): Promise<boolean> {
  const images = filterImageFiles(files);
  if (!images.length) return false;
  try {
    // setImage must land before addRefs since setImage clears refImages
    // (D5, PLAN-MULTI-REF).
    const [first, ...rest] = images;
    const dataUrl = await fileToDataURL(first);
    const img = await loadImage(dataUrl);
    useStudio.getState().setImage({ src: dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    await restoreEmbeddedMeta(first);
    if (rest.length) {
      // Silent cap, matching the original Stage behavior for bulk drops.
      const capped = rest.slice(0, MAX_REF_IMAGES);
      const refs = await Promise.all(capped.map((f) => fileToDownscaledDataURL(f, 1400, 0.92).then((r) => r.dataUrl)));
      useStudio.getState().addRefs(refs);
    }
    return true;
  } catch {
    useStudio.getState().showToast("error", "读取图片失败");
    return false;
  }
}

/** Add reference images. Three shapes, by current state:
 *  - no main image yet → falls back to the reset flow (1st = main, rest =
 *    refs) with an explanatory toast, so the entry is never a dead end;
 *  - a needsRef preset action is active (换上衣/换裤子/换背景) → single
 *    reference slot, first file replaces it (PresetRefBox semantics);
 *  - free mode → append up to MAX_REF_IMAGES with the cap toast
 *    (FreeRefList semantics), first TVision PNG restores its recipe. */
export async function addRefsFromFiles(files: File[]): Promise<void> {
  const images = filterImageFiles(files);
  if (!images.length) return;
  const studio = useStudio.getState();

  if (!studio.image) {
    const ok = await setMainFromFiles(images);
    if (ok) useStudio.getState().showToast("info", "还没有主图：第 1 张已设为主图，其余作为参考图");
    return;
  }

  const action = getAction(studio.activeActionId);
  try {
    if (action?.needsRef) {
      const { dataUrl } = await fileToDownscaledDataURL(images[0], 1400, 0.92);
      const s = useStudio.getState();
      if (s.refImages.length) s.replaceRef(0, dataUrl);
      else s.addRefs([dataUrl]);
      s.showToast("success", "参考图已就绪");
      return;
    }

    const room = MAX_REF_IMAGES - studio.refImages.length;
    const accepted = images.slice(0, Math.max(0, room));
    if (images.length > accepted.length) studio.showToast("error", `最多添加 ${MAX_REF_IMAGES} 张参考图`);
    if (!accepted.length) return;
    const refs = await Promise.all(accepted.map((f) => fileToDownscaledDataURL(f, 1400, 0.92).then((r) => r.dataUrl)));
    useStudio.getState().addRefs(refs);
    for (const f of accepted) {
      if (await restoreEmbeddedMeta(f)) break;
    }
  } catch {
    useStudio.getState().showToast("error", "读取失败");
  }
}
