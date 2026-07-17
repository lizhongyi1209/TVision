"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { getAction } from "@/lib/actions";
import { diag } from "@/lib/logStore";
import { ASPECT_RATIOS, BILLINGS, comboError, GPT_IMAGE_2_RATIOS, MODELS, QUALITY_OPTIONS, resolutionsFor } from "@/lib/models";
import { useStudio } from "@/lib/store";
import type { Billing, InpaintJob, ModelName, Quality, Resolution } from "@/lib/types";
import { cn, cropImageToDataURL, downscaleImageSrc, fakeVisionProgressCurve } from "@/lib/utils";
import { VISION_MODELS } from "@/lib/visionModels";
import { Icon } from "./icons";
import { ModelIcon } from "./modelIcons";
import { Button, Segmented, Select } from "./ui";

export function GenerateBar() {
  const image = useStudio((s) => s.image);
  const params = useStudio((s) => s.params);
  const updateParams = useStudio((s) => s.updateParams);
  const activeActionId = useStudio((s) => s.activeActionId);
  const refImages = useStudio((s) => s.refImages);
  const inpaintMask = useStudio((s) => s.inpaintMask);
  const setInpaintJob = useStudio((s) => s.setInpaintJob);
  const openBrushPanel = useStudio((s) => s.openBrushPanel);
  const clearInpaint = useStudio((s) => s.clearInpaint);
  const cancelAction = useStudio((s) => s.cancelAction);
  const phase = useStudio((s) => s.phase);
  const analyzingVision = useStudio((s) => s.analyzingVision);
  const visionStartedAt = useStudio((s) => s.visionStartedAt);
  const visionRequestId = useStudio((s) => s.visionRequestId);
  const beginVisionAnalysis = useStudio((s) => s.beginVisionAnalysis);
  const setVisionProgress = useStudio((s) => s.setVisionProgress);
  const finishVisionAnalysis = useStudio((s) => s.finishVisionAnalysis);
  const failVisionAnalysis = useStudio((s) => s.failVisionAnalysis);
  const settings = useStudio((s) => s.settings);
  const openSettings = useStudio((s) => s.openSettings);
  const showToast = useStudio((s) => s.showToast);
  const beginSubmit = useStudio((s) => s.beginSubmit);
  const setJobIds = useStudio((s) => s.setJobIds);
  const setPhase = useStudio((s) => s.setPhase);
  const setError = useStudio((s) => s.setError);

  const action = getAction(activeActionId);
  const busy = phase === "submitting" || phase === "running";
  const resOptions = resolutionsFor(params.model);
  const cErr = comboError(params.model, params.resolution, params.billing, params.aspectRatio);
  const needsRefMissing = !!action?.needsRef && refImages.length === 0;
  const requiredMaskMissing = !!action?.usesBrush && !inpaintMask;
  const canGenerate =
    !!image &&
    (!!params.prompt.trim() || !!action?.textToImage) &&
    !cErr &&
    !needsRefMissing &&
    !requiredMaskMissing &&
    !busy &&
    !analyzingVision;

  // "视觉反推" fetch orchestration. Lives here (not RadialMenu, which
  // unmounts the instant a pill is clicked) because GenerateBar's parent
  // always renders it — only this component's own return value is
  // conditionally null (below, after every hook), so its effects stay live
  // and reactive regardless of whether `image` is currently set. Keying on
  // [activeActionId, image?.src, visionRequestId] and aborting on cleanup
  // covers every required cancellation trigger through one mechanism:
  // cancelAction (activeActionId -> null), setImage/换图 (image?.src
  // changes), switching to a different action, and true unmount.
  useEffect(() => {
    const currentAction = getAction(activeActionId);
    if (!currentAction?.visionAnalysis || !image) return;
    if (!useStudio.getState().settings?.hasApiKey) {
      showToast("error", "请先在设置里填入 o1key 令牌");
      openSettings();
      return;
    }

    const controller = new AbortController();
    // Belt-and-suspenders alongside AbortController: if the fetch settles in
    // the narrow window between deps changing and abort() actually taking
    // effect, this flag still stops us writing a stale result to the store.
    // Same pattern already used by Studio.tsx's polling effect.
    let cancelled = false;
    const startedAt = Date.now();
    const imgSrc = image.src;

    beginVisionAnalysis();
    diag("info", "视觉反推", `开始解析图片（模型 ${VISION_MODELS[0]}）`);

    (async () => {
      try {
        const { dataUrl: submitSrc } = await downscaleImageSrc(imgSrc, 1600, 0.92);
        const res = await fetch("/api/reverse-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: submitSrc }),
          signal: controller.signal,
        }).then((r) => r.json());

        if (cancelled) return;

        if (res.error) {
          failVisionAnalysis(res.error);
          showToast("error", res.error);
          diag("error", "视觉反推", "解析失败", res.detail || res.error);
          return;
        }

        const prompt = res.prompt || "";
        updateParams({ prompt });
        finishVisionAnalysis();
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        diag(
          "info",
          "视觉反推",
          `解析完成，耗时 ${secs}s，提示词 ${prompt.length} 字（模型 ${res.model || "?"}）`,
          prompt,
        );
        if (res.parseWarning) {
          showToast("info", "解析结果不是标准 JSON，已原样填入，请检查提示词");
          diag("warn", "视觉反推", "解析结果不是标准 JSON，已原样填入");
        } else {
          showToast("success", "反推完成，请确认提示词后点击生成");
        }
      } catch (e) {
        if (cancelled || (e as Error)?.name === "AbortError") return;
        failVisionAnalysis("解析失败，请检查网络");
        showToast("error", "解析失败，请检查网络");
        diag("error", "视觉反推", "解析请求失败", (e as Error)?.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeActionId, image?.src, visionRequestId]);

  // Fake-progress ticker for the vision-analysis card (ResultSlot), mirroring
  // Studio.tsx's generation-progress ticker: a plain time-based curve, since
  // vision analysis has no server-side status to poll.
  const visionStartedAtRef = useRef(visionStartedAt);
  visionStartedAtRef.current = visionStartedAt;
  useEffect(() => {
    if (!analyzingVision) return;
    const tick = () => {
      const started = visionStartedAtRef.current;
      if (!started) return;
      const seconds = (Date.now() - started) / 1000;
      setVisionProgress(fakeVisionProgressCurve(seconds) / 100);
    };
    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzingVision]);

  function onModel(v: string) {
    const model = v as ModelName;
    const rs = resolutionsFor(model);
    const resolution = rs.includes(params.resolution) ? params.resolution : rs[0];
    let billing = params.billing;
    if (comboError(model, resolution, billing) && !comboError(model, resolution, "特价")) billing = "特价";
    // GPT Image 2 has no aspect_ratio param — fall back to "auto" when the
    // ratio carried over from the previous model isn't in its preset table.
    let aspectRatio = params.aspectRatio;
    if (model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(aspectRatio)) {
      aspectRatio = "auto";
      showToast("info", "已调整为 GPT Image 2 支持的比例");
    }
    updateParams({ model, resolution, billing, aspectRatio });
  }

  async function generate() {
    if (!image) return;
    if (action?.textToImage && !params.prompt.trim()) {
      showToast("error", "请先完成视觉反推或输入提示词");
      return;
    }
    if (!settings?.hasApiKey) {
      showToast("error", "请先在设置里填入 o1key 令牌");
      openSettings();
      return;
    }
    if (needsRefMissing) {
      showToast("error", action?.refLabel || "请先上传参考图");
      return;
    }
    if (requiredMaskMissing) {
      showToast("error", "请先涂抹要移除的物品");
      openBrushPanel(true);
      return;
    }
    if (cErr) {
      showToast("error", cErr);
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
        showToast("error", "请先在对话框写明这块区域要改成什么");
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
        showToast("error", "裁剪涂抹区域失败，请重试");
        return;
      }
    } else if (!action?.textToImage) {
      try {
        submitImage = (await downscaleImageSrc(image.src, 1800, 0.94)).dataUrl;
      } catch {
        showToast("error", "读取图片失败，请重试");
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
    if (pendingInpaintJob) setInpaintJob(pendingInpaintJob);

    beginSubmit();
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

      if (res.error) {
        setError(res.error);
        setPhase("error");
        showToast("error", res.error);
        diag("error", "提交", "提交失败", res.error);
        return;
      }
      const ids = (res.jobs as { id: string }[]).map((j) => j.id);
      setJobIds(ids);
      setPhase("running");
      diag("info", "提交", `已创建 ${ids.length} 个任务`, ids.join("\n"));
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      showToast("error", "提交失败，请检查网络");
      diag("error", "提交", "提交失败，请检查网络", (e as Error)?.message || String(e));
    }
  }

  if (!image) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
      <AnimatePresence>
        <motion.div
          key="genbar"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="glass pointer-events-auto w-[min(920px,96vw)] rounded-panel p-3.5"
        >
          {/* action chip + reference */}
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {inpaintMask && !action ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-2 pr-1 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-accent">
                  <Icon name="PaintBrush" size={13} weight="bold" />
                </span>
                <span className="font-medium text-fg">局部重绘</span>
                <button
                  onClick={clearInpaint}
                  disabled={busy}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-fg-mute hover:bg-white/10 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
                  aria-label="取消局部重绘"
                >
                  <Icon name="X" size={13} />
                </button>
              </span>
            ) : action ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-2 pr-1 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-accent">
                  <Icon
                    name={analyzingVision && action.visionAnalysis ? "CircleNotch" : action.icon}
                    size={13}
                    weight="bold"
                    className={analyzingVision && action.visionAnalysis ? "animate-spin" : undefined}
                  />
                </span>
                <span className="font-medium text-fg">{action.label}</span>
                <button
                  onClick={cancelAction}
                  disabled={busy}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-fg-mute hover:bg-white/10 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
                  aria-label="取消操作"
                >
                  <Icon name="X" size={13} />
                </button>
              </span>
            ) : refImages.length > 0 ? (
              <span className="text-sm text-fg-mute">
                自由创作 · 已附 {refImages.length} 张参考图（提示词可用"第 2 张图"指代）
              </span>
            ) : (
              <span className="text-sm text-fg-mute">未选操作 · 点击图片选操作，或直接写提示词</span>
            )}
            {action?.textToImage ? (
              <span className="text-xs text-fg-mute">仅用下方文字提示词生成，不使用原图作为参考</span>
            ) : null}
            {action?.usesBrush ? (
              <span className="text-xs text-fg-mute">
                {inpaintMask ? "已选择移除区域，可微调提示词后生成" : "请先涂抹要移除的物品"}
              </span>
            ) : null}
          </div>

          {/* prompt */}
          <div className="relative">
            <textarea
              value={params.prompt}
              onChange={(e) => updateParams({ prompt: e.target.value })}
              placeholder={analyzingVision ? "AI 正在解析图片，请稍候…" : "描述你想要的效果，或保留操作自动生成的提示词…"}
              rows={2}
              disabled={analyzingVision}
              className={cn(
                "w-full resize-none rounded-control border border-line bg-panel-2/60 p-3 text-sm leading-relaxed text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none",
                analyzingVision && "cursor-not-allowed opacity-60",
              )}
            />
            {analyzingVision ? (
              <span className="pointer-events-none absolute right-3 top-3 text-accent">
                <Icon name="CircleNotch" size={16} className="animate-spin" />
              </span>
            ) : null}
          </div>

          {/* controls + generate */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Select
              value={params.model}
              onChange={onModel}
              options={MODELS.map((m) => ({
                value: m.name,
                label: m.name,
                hint: m.blurb,
                icon: <ModelIcon model={m.name} size={16} />,
              }))}
              className="w-[184px]"
            />
            <Select
              value={params.resolution}
              onChange={(v) => updateParams({ resolution: v as Resolution })}
              options={resOptions.map((r) => ({ value: r, label: r }))}
              className="w-[92px]"
            />
            <Select
              value={inpaintMask ? "auto" : params.aspectRatio}
              onChange={(v) => updateParams({ aspectRatio: v })}
              options={
                inpaintMask
                  ? [{ value: "auto", label: "按涂抹区域" }]
                  : ASPECT_RATIOS.map((a) => ({
                      value: a,
                      label: a === "auto" ? "自动比例" : a,
                      disabled: params.model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(a),
                    }))
              }
              disabled={!!inpaintMask}
              className="w-[116px]"
            />
            <Select
              value={params.billing}
              onChange={(v) => updateParams({ billing: v as Billing })}
              options={BILLINGS.map((b) => ({ value: b, label: b }))}
              className="w-[88px]"
            />
            {params.model === "GPT Image 2" ? (
              <Select
                value={params.quality}
                onChange={(v) => updateParams({ quality: v as Quality })}
                options={QUALITY_OPTIONS}
                className="w-[88px]"
              />
            ) : null}
            <Segmented
              value={params.count}
              onChange={(v) => updateParams({ count: v })}
              options={[1, 2, 3, 4].map((n) => ({ value: n, label: `×${n}` }))}
            />

            <div className="ml-auto flex items-center gap-3">
              <Button variant="primary" onClick={generate} disabled={!canGenerate} className="px-6">
                {busy ? (
                  <>
                    <Icon name="CircleNotch" size={16} className="animate-spin" />
                    生成中
                  </>
                ) : (
                  <>
                    <Icon name="Lightning" size={16} weight="fill" />
                    生成
                  </>
                )}
              </Button>
            </div>
          </div>

          {cErr ? (
            <div className={cn("mt-2 flex items-center gap-1.5 text-xs text-amber-300")}>
              <Icon name="Warning" size={13} />
              {cErr}
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
