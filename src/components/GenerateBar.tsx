"use client";

import { AnimatePresence, motion } from "motion/react";
import { getAction } from "@/lib/actions";
import { ASPECT_RATIOS, BILLINGS, comboError, MODELS, resolutionsFor } from "@/lib/models";
import { useStudio } from "@/lib/store";
import type { Billing, ModelName, Resolution } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Button, Segmented, Select } from "./ui";

export function GenerateBar() {
  const image = useStudio((s) => s.image);
  const params = useStudio((s) => s.params);
  const updateParams = useStudio((s) => s.updateParams);
  const activeActionId = useStudio((s) => s.activeActionId);
  const refImage = useStudio((s) => s.refImage);
  const cancelAction = useStudio((s) => s.cancelAction);
  const openUpload = useStudio((s) => s.openUpload);
  const phase = useStudio((s) => s.phase);
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
  const cErr = comboError(params.model, params.resolution, params.billing);
  const needsRefMissing = !!action?.needsRef && !refImage;
  const canGenerate = !!image && !!params.prompt.trim() && !cErr && !needsRefMissing && !busy;

  function onModel(v: string) {
    const model = v as ModelName;
    const rs = resolutionsFor(model);
    const resolution = rs.includes(params.resolution) ? params.resolution : rs[0];
    let billing = params.billing;
    if (comboError(model, resolution, billing) && !comboError(model, resolution, "特价")) billing = "特价";
    updateParams({ model, resolution, billing });
  }

  async function generate() {
    if (!image) return;
    if (!settings?.hasApiKey) {
      showToast("error", "请先在设置里填入 o1key 令牌");
      openSettings();
      return;
    }
    if (needsRefMissing) {
      showToast("error", action?.refLabel || "请先上传参考图");
      openUpload();
      return;
    }
    if (cErr) {
      showToast("error", cErr);
      return;
    }
    beginSubmit();
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: params.prompt,
          model: params.model,
          resolution: params.resolution,
          aspectRatio: params.aspectRatio,
          billing: params.billing,
          count: params.count,
          baseImage: image.src,
          refImage: refImage || undefined,
        }),
      }).then((r) => r.json());

      if (res.error) {
        setError(res.error);
        setPhase("error");
        showToast("error", res.error);
        return;
      }
      setJobIds((res.jobs as { id: string }[]).map((j) => j.id));
      setPhase("running");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      showToast("error", "提交失败，请检查网络");
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
            {action ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-2 pr-1 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-accent">
                  <Icon name={action.icon} size={13} weight="bold" />
                </span>
                <span className="font-medium text-fg">{action.label}</span>
                <button
                  onClick={cancelAction}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-fg-mute hover:bg-white/10 hover:text-fg"
                  aria-label="取消操作"
                >
                  <Icon name="X" size={13} />
                </button>
              </span>
            ) : (
              <span className="text-sm text-fg-mute">未选操作 · 点击图片选操作，或直接写提示词</span>
            )}

            {action?.needsRef ? (
              refImage ? (
                <button
                  onClick={openUpload}
                  className="group inline-flex items-center gap-2 rounded-full border border-line bg-panel-2 py-1 pl-1 pr-3 text-xs text-fg-dim hover:border-line-2"
                  title="更换参考图"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={refImage} alt="参考" className="h-6 w-6 rounded-full object-cover" />
                  参考图
                  <Icon name="ArrowClockwise" size={12} className="text-fg-mute group-hover:text-fg" />
                </button>
              ) : (
                <button
                  onClick={openUpload}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs text-accent"
                >
                  <Icon name="UploadSimple" size={13} />
                  补上参考图
                </button>
              )
            ) : null}
          </div>

          {/* prompt */}
          <textarea
            value={params.prompt}
            onChange={(e) => updateParams({ prompt: e.target.value })}
            placeholder="描述你想要的效果，或保留操作自动生成的提示词…"
            rows={2}
            className="w-full resize-none rounded-control border border-line bg-panel-2/60 p-3 text-sm leading-relaxed text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
          />

          {/* controls + generate */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Select
              value={params.model}
              onChange={onModel}
              options={MODELS.map((m) => ({ value: m.name, label: m.name }))}
              className="w-[168px]"
            />
            <Select
              value={params.resolution}
              onChange={(v) => updateParams({ resolution: v as Resolution })}
              options={resOptions.map((r) => ({ value: r, label: r }))}
              className="w-[92px]"
            />
            <Select
              value={params.aspectRatio}
              onChange={(v) => updateParams({ aspectRatio: v })}
              options={ASPECT_RATIOS.map((a) => ({ value: a, label: a === "auto" ? "自动比例" : a }))}
              className="w-[116px]"
            />
            <Select
              value={params.billing}
              onChange={(v) => updateParams({ billing: v as Billing })}
              options={BILLINGS.map((b) => ({ value: b, label: b }))}
              className="w-[88px]"
            />
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
