"use client";

// The single-studio submit flow, extracted from GenerateBar.tsx so the 生成
// button's validation + preprocessing + POST can live in one reusable place.
// Reads everything from the stores at call time — no component state involved.

import { getAction } from "./actions";
import { diag } from "./logStore";
import { comboError } from "./models";
import { useStudio } from "./store";
import type { InpaintJob } from "./types";
import { cropImageToDataURL, downscaleImageSrc } from "./utils";

/** Everything the 生成 button needs to decide enabled/disabled, derived in
 *  one place so GenerateBar and the recipe card can't disagree. */
export function generateReadiness() {
  const s = useStudio.getState();
  const action = getAction(s.activeActionId);
  const cErr = comboError(s.params.model, s.params.resolution, s.params.billing, s.params.aspectRatio);
  const needsRefMissing = !!action?.needsRef && s.refImages.length === 0;
  const requiredMaskMissing = !!action?.usesBrush && !s.inpaintMask;
  const busy = s.phase === "submitting" || s.phase === "running";
  const canGenerate =
    !!s.image &&
    (!!s.params.prompt.trim() || !!action?.textToImage) &&
    !cErr &&
    !needsRefMissing &&
    !requiredMaskMissing &&
    !busy &&
    !s.analyzingVision;
  return { action, cErr, needsRefMissing, requiredMaskMissing, busy, canGenerate };
}

/** Validate + preprocess + submit the current canvas state as a generation
 *  job set. All outcomes (validation toasts, error phase, running phase) are
 *  written straight into the stores; resolves once the submission round-trip
 *  settles. Safe to call from any component. */
export async function generate(): Promise<void> {
  const studio = useStudio.getState();
  const { image, params, activeActionId, refImages, inpaintMask, settings } = studio;
  const action = getAction(activeActionId);
  const { cErr, needsRefMissing, requiredMaskMissing } = generateReadiness();

  if (!image) return;
  if (action?.textToImage && !params.prompt.trim()) {
    studio.showToast("error", "请先完成视觉反推或输入提示词");
    return;
  }
  if (!settings?.hasApiKey) {
    studio.showToast("error", "请先在设置里填入 o1key 令牌");
    studio.openSettings();
    return;
  }
  if (needsRefMissing) {
    studio.showToast("error", action?.refLabel || "请先上传参考图");
    return;
  }
  if (requiredMaskMissing) {
    studio.showToast("error", "请先涂抹要移除的物品");
    studio.openBrushPanel(true);
    return;
  }
  if (cErr) {
    studio.showToast("error", cErr);
    return;
  }

  // Local repaint (brush selection active): crop just the padded bbox and
  // submit that instead of the full canvas image; aspectRatio is forced to
  // "auto" since the crop's own arbitrary aspect ratio must not get stretched
  // to whatever ratio the (unrelated, now-disabled) selector last held.
  let submitImage = image.src;
  let submitAspect = params.aspectRatio;
  let pendingInpaintJob: InpaintJob | null = null;
  const submitSnapshot = {
    imageSrc: image.src,
    actionId: activeActionId,
    mask: inpaintMask,
  };
  if (inpaintMask) {
    if (!params.prompt.trim()) {
      studio.showToast("error", "请先在对话框写明这块区域要改成什么");
      return;
    }
    try {
      const cropped = await cropImageToDataURL(
        image.src,
        { x: inpaintMask.bboxPx.x, y: inpaintMask.bboxPx.y, width: inpaintMask.bboxPx.w, height: inpaintMask.bboxPx.h },
        0.92,
      );
      submitImage = cropped.dataUrl;
      if (Math.max(cropped.width, cropped.height) > 2048) {
        submitImage = (await downscaleImageSrc(cropped.dataUrl, 2048, 0.92)).dataUrl;
      }
      submitAspect = "auto";
      // Snapshot now, not read live at composite time: if the user reopens
      // the brush panel while this job is still running, inpaintMask could
      // change before results land — the composite step must use the mask
      // that was actually submitted.
      pendingInpaintJob = { origSrc: image.src, bboxPx: inpaintMask.bboxPx, maskUrl: inpaintMask.maskUrl };
      diag(
        "info",
        action?.label ?? "局部重绘",
        `提交${action?.label ?? "局部重绘"}`,
        JSON.stringify(
          {
            bboxAreaRatio: Number(
              ((inpaintMask.bboxPx.w * inpaintMask.bboxPx.h) / (image.width * image.height)).toFixed(3),
            ),
            promptLength: params.prompt.trim().length,
          },
          null,
          2,
        ),
      );
    } catch {
      studio.showToast("error", "裁剪涂抹区域失败，请重试");
      return;
    }
  } else if (!action?.textToImage) {
    try {
      submitImage = (await downscaleImageSrc(image.src, 1800, 0.94)).dataUrl;
    } catch {
      studio.showToast("error", "读取图片失败，请重试");
      return;
    }
  }

  // Cropping/downscaling can take noticeable time for large images. If the
  // user cancels, changes the image, or repaints the mask during that await,
  // discard this stale submission before it can create a billable job.
  const latest = useStudio.getState();
  if (
    latest.image?.src !== submitSnapshot.imageSrc ||
    latest.activeActionId !== submitSnapshot.actionId ||
    latest.inpaintMask !== submitSnapshot.mask
  ) {
    diag("info", "提交", "已取消过期的生成请求", "图片或编辑选区在预处理期间发生变化");
    return;
  }
  if (pendingInpaintJob) latest.setInpaintJob(pendingInpaintJob);

  latest.beginSubmit();
  diag(
    "info",
    "提交",
    "提交生成请求",
    JSON.stringify(
      {
        action: inpaintMask ? (action?.label ?? "局部重绘") : (action?.label ?? "自由提示词"),
        model: params.model,
        resolution: params.resolution,
        aspectRatio: submitAspect,
        billing: params.billing,
        count: params.count,
        quality: params.model === "GPT Image 2" ? params.quality : undefined,
        refs: refImages.length,
      },
      null,
      2,
    ),
  );
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: params.prompt,
        model: params.model,
        resolution: params.resolution,
        aspectRatio: submitAspect,
        billing: params.billing,
        count: params.count,
        quality: params.model === "GPT Image 2" ? params.quality : undefined,
        baseImage: action?.textToImage ? undefined : submitImage,
        refImages: refImages.length && !inpaintMask ? refImages : undefined,
        textOnly: action?.textToImage || undefined,
      }),
    }).then((r) => r.json());

    const live = useStudio.getState();
    if (res.error) {
      live.setError(res.error);
      live.setPhase("error");
      live.showToast("error", res.error);
      diag("error", "提交", "提交失败", res.error);
      return;
    }
    const ids = (res.jobs as { id: string }[]).map((j) => j.id);
    live.setJobIds(ids);
    live.setPhase("running");
    diag("info", "提交", `已创建 ${ids.length} 个任务`, ids.join("\n"));
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const live = useStudio.getState();
    live.setError(msg);
    live.setPhase("error");
    live.showToast("error", "提交失败，请检查网络");
    diag("error", "提交", "提交失败，请检查网络", msg);
  }
}
