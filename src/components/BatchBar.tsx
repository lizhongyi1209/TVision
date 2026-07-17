"use client";

import { useState } from "react";
import { batchNouns, WEAR_TYPES } from "@/lib/batchPrompts";
import { useBatchStore } from "@/lib/batchStore";
import { MAX_BATCH_TASKS } from "@/lib/limits";
import { diag } from "@/lib/logStore";
import { ASPECT_RATIOS, BILLINGS, comboError, GPT_IMAGE_2_RATIOS, MODELS, QUALITY_OPTIONS, resolutionsFor } from "@/lib/models";
import { useStudio } from "@/lib/store";
import type { Billing, ModelName, Quality, Resolution } from "@/lib/types";
import { cn, downloadUrl } from "@/lib/utils";
import { Icon } from "./icons";
import { ModelIcon } from "./modelIcons";
import { Button, Segmented, Select } from "./ui";

// Persistent batch settings rail. It replaces the old bottom floating bar so
// task configuration, run state, and primary actions stay in one predictable
// place while the right side is reserved for assets and results.
export function BatchSettingsPanel({ busy = false }: { busy?: boolean }) {
  const models = useBatchStore((s) => s.models);
  const garments = useBatchStore((s) => s.garments);
  const wearTypeId = useBatchStore((s) => s.wearTypeId);
  const prompt = useBatchStore((s) => s.prompt);
  const promptEdited = useBatchStore((s) => s.promptEdited);
  const params = useBatchStore((s) => s.params);
  const cells = useBatchStore((s) => s.cells);
  const runState = useBatchStore((s) => s.runState);
  const setWearType = useBatchStore((s) => s.setWearType);
  const setPrompt = useBatchStore((s) => s.setPrompt);
  const updateParams = useBatchStore((s) => s.updateParams);
  const startRun = useBatchStore((s) => s.startRun);
  const stopRun = useBatchStore((s) => s.stopRun);
  const retryFailed = useBatchStore((s) => s.retryFailed);

  const settings = useStudio((s) => s.settings);
  const openSettings = useStudio((s) => s.openSettings);
  const showToast = useStudio((s) => s.showToast);

  const [exporting, setExporting] = useState(false);

  const total = models.length * garments.length;
  const running = runState === "running";
  const done = runState === "done";
  const nouns = batchNouns(wearTypeId);
  const resOptions = resolutionsFor(params.model);
  const cErr = comboError(params.model, params.resolution, params.billing, params.aspectRatio);
  const overCap = total > MAX_BATCH_TASKS;
  const canGenerate = models.length > 0 && garments.length > 0 && !!prompt.trim() && !cErr && !overCap && !running && !busy;

  const finished = cells.filter((c) => c.status === "success" || c.status === "failed").length;
  const successCells = cells.filter((c) => c.status === "success" && !!c.resultUrl);
  const failedCount = cells.filter((c) => c.status === "failed").length;
  const pct = cells.length ? Math.round((finished / cells.length) * 100) : 0;

  function onModel(v: string) {
    const model = v as ModelName;
    const rs = resolutionsFor(model);
    const resolution = rs.includes(params.resolution) ? params.resolution : rs[0];
    let billing = params.billing;
    if (comboError(model, resolution, billing) && !comboError(model, resolution, "特价")) billing = "特价";
    let aspectRatio = params.aspectRatio;
    if (model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(aspectRatio)) {
      aspectRatio = "auto";
      showToast("info", "已调整为 GPT Image 2 支持的比例");
    }
    updateParams({ model, resolution, billing, aspectRatio });
  }

  function generate() {
    if (!settings?.hasApiKey) {
      showToast("error", "请先在设置里填入 o1key 令牌");
      openSettings();
      return;
    }
    if (cErr) {
      showToast("error", cErr);
      return;
    }
    diag(
      "info",
      "批量工坊",
      "提交批量生成",
      JSON.stringify(
        {
          models: models.length,
          garments: garments.length,
          wearType: promptEdited ? "自定义" : (WEAR_TYPES.find((w) => w.id === wearTypeId)?.label ?? wearTypeId),
          model: params.model,
          resolution: params.resolution,
          aspectRatio: params.aspectRatio,
          billing: params.billing,
          quality: params.model === "GPT Image 2" ? params.quality : undefined,
        },
        null,
        2,
      ),
    );
    startRun();
  }

  async function exportZip() {
    const files = successCells
      .map((c) => {
        const m = /^\/api\/media\/([^/?#]+)$/.exec(c.resultUrl || "");
        if (!m) return null;
        const g = garments[c.garmentIndex];
        const cellNouns = batchNouns(c.wearTypeId);
        return { file: decodeURIComponent(m[1]), name: `${g?.name ?? cellNouns.item}-${cellNouns.base}${c.modelIndex + 1}.png` };
      })
      .filter((x): x is { file: string; name: string } => !!x);
    if (!files.length) {
      showToast("error", "没有可下载的结果");
      return;
    }
    setExporting(true);
    try {
      const res = await fetch("/api/batch/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      downloadUrl(url, `tvision-batch-${Date.now()}.zip`);
      URL.revokeObjectURL(url);
      diag("info", "批量工坊", `打包下载 ${files.length} 张`);
    } catch (e) {
      showToast("error", "打包下载失败，可逐张下载");
      diag("error", "批量工坊", "打包下载失败", (e as Error)?.message || String(e));
    } finally {
      setExporting(false);
    }
  }

  const statusLabel = running ? "运行中" : done ? "已完成" : "未运行";

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-panel/55 lg:h-full lg:w-[304px] lg:border-b-0 lg:border-r">
      <div className="px-4 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-medium text-fg">任务设置</div>
            <div className="mt-0.5 text-[11px] text-fg-mute">{nouns.chip}</div>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-1 text-[10px] font-medium",
              running || done ? "bg-accent/12 text-accent" : "bg-white/[0.05] text-fg-mute",
            )}
          >
            {statusLabel}
          </span>
        </div>

        <fieldset disabled={running} className={cn("space-y-4", running && "opacity-55")}>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium tracking-wide text-fg-mute">任务类型</span>
            <Select
              value={promptEdited ? "custom" : wearTypeId}
              onChange={(v) => {
                if (v !== "custom") setWearType(v);
              }}
              options={[
                ...WEAR_TYPES.map((w) => ({ value: w.id, label: w.label })),
                ...(promptEdited ? [{ value: "custom", label: "自定义" }] : []),
              ]}
              className="w-full"
              disabled={running}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium tracking-wide text-fg-mute">提示词</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                wearTypeId === "generic"
                  ? `描述${nouns.base}与${nouns.item}之间的替换关系…`
                  : `${nouns.promptLabel}（切换类型会重写，也可手动修改）…`
              }
              rows={5}
              disabled={running}
              className="w-full resize-none rounded-control border border-line bg-panel-2/60 p-3 text-sm leading-relaxed text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none disabled:cursor-not-allowed"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium tracking-wide text-fg-mute">生成模型</span>
            <Select
              value={params.model}
              onChange={onModel}
              options={MODELS.map((m) => ({
                value: m.name,
                label: m.name,
                hint: m.blurb,
                icon: <ModelIcon model={m.name} size={16} />,
              }))}
              className="w-full"
              disabled={running}
            />
          </label>

          <div className="flex flex-col items-start gap-1.5">
            <span className="text-[11px] font-medium tracking-wide text-fg-mute">分辨率</span>
            <Segmented
              value={params.resolution}
              onChange={(v) => updateParams({ resolution: v as Resolution })}
              options={resOptions.map((r) => ({ value: r, label: r }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0 space-y-1.5">
              <span className="text-[11px] font-medium tracking-wide text-fg-mute">画面比例</span>
              <Select
                value={params.aspectRatio}
                onChange={(v) => updateParams({ aspectRatio: v })}
                options={ASPECT_RATIOS.map((a) => ({
                  value: a,
                  label: a === "auto" ? "自动" : a,
                  disabled: params.model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(a),
                }))}
                className="w-full"
                disabled={running}
              />
            </label>
            <label className="block min-w-0 space-y-1.5">
              <span className="text-[11px] font-medium tracking-wide text-fg-mute">计费线路</span>
              <Select
                value={params.billing}
                onChange={(v) => updateParams({ billing: v as Billing })}
                options={BILLINGS.map((b) => ({ value: b, label: b }))}
                className="w-full"
                disabled={running}
              />
            </label>
          </div>

          {params.model === "GPT Image 2" ? (
            <label className="block space-y-1.5">
              <span className="text-[11px] font-medium tracking-wide text-fg-mute">生成质量</span>
              <Select
                value={params.quality}
                onChange={(v) => updateParams({ quality: v as Quality })}
                options={QUALITY_OPTIONS}
                className="w-full"
                disabled={running}
              />
            </label>
          ) : null}
        </fieldset>

        {cErr || overCap ? (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-relaxed text-amber-300">
            <Icon name="Warning" size={14} className="mt-0.5 shrink-0" />
            <span>{cErr || `单次最多 ${MAX_BATCH_TASKS} 张（当前 ${total} 张），请减少${nouns.base}或${nouns.item}分批生成`}</span>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line bg-ink/35 p-4">
        <div className="mb-3 flex items-start justify-between gap-3 text-sm">
          <span className="text-fg-mute">任务规模</span>
          <span className="text-right font-medium text-fg">
            {models.length} {nouns.baseUnit}{nouns.base} × {garments.length} {nouns.itemUnit}{nouns.item}
            <span className="mt-0.5 block text-xs font-normal text-fg-mute">共 {total} 张</span>
          </span>
        </div>

        {running ? (
          <div className="space-y-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-fg-dim">
              <span>已完成 {finished}/{cells.length}</span>
              <span>{failedCount ? `${failedCount} 张未成功` : `${pct}%`}</span>
            </div>
            <Button variant="ghost" onClick={stopRun} className="w-full rounded-control">
              <Icon name="Square" size={13} weight="fill" />
              停止
            </Button>
          </div>
        ) : done ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-fg-dim">
              <Icon name="Check" size={14} weight="bold" className="text-accent" />
              成功 {successCells.length}/{cells.length}
              {failedCount ? ` · ${failedCount} 张未成功` : ""}
            </div>
            {failedCount ? (
              <Button variant="ghost" onClick={retryFailed} disabled={busy} className="w-full rounded-control">
                <Icon name="ArrowClockwise" size={14} />
                重试未成功
              </Button>
            ) : null}
            {successCells.length ? (
              <Button variant="primary" onClick={exportZip} disabled={exporting} className="w-full rounded-control">
                <Icon name={exporting ? "CircleNotch" : "DownloadSimple"} size={15} className={exporting ? "animate-spin" : undefined} />
                打包下载 {successCells.length} 张
              </Button>
            ) : null}
            <Button variant="ghost" onClick={generate} disabled={!canGenerate} className="w-full rounded-control">
              <Icon name="Lightning" size={15} weight="fill" />
              重新生成全部 {total > 0 ? `${total} 张` : ""}
            </Button>
          </div>
        ) : (
          <Button variant="primary" onClick={generate} disabled={!canGenerate} className="w-full rounded-control">
            <Icon name="Lightning" size={16} weight="fill" />
            生成 {total > 0 ? `${total} 张` : ""}
          </Button>
        )}
      </div>
    </aside>
  );
}
