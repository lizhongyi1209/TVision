"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useBatchStore } from "@/lib/batchStore";
import { batchNouns, WEAR_TYPES } from "@/lib/batchPrompts";
import { MAX_BATCH_TASKS } from "@/lib/limits";
import { diag } from "@/lib/logStore";
import { ASPECT_RATIOS, BILLINGS, comboError, GPT_IMAGE_2_RATIOS, MODELS, QUALITY_OPTIONS, resolutionsFor } from "@/lib/models";
import { useStudio } from "@/lib/store";
import type { Billing, ModelName, Quality, Resolution } from "@/lib/types";
import { cn, downloadUrl } from "@/lib/utils";
import { Icon } from "./icons";
import { ModelIcon } from "./modelIcons";
import { Button, Select } from "./ui";

// 批量生成栏（PLAN-BATCH T5）：视觉对齐 GenerateBar 的底部玻璃面板。空闲态是
// 类型/提示词/参数 + 「生成 N 张」；运行态换成总进度条 + 停止；完成态给
// 重试未成功 + 打包下载。运行/停止本身全在 batchStore 引擎里，这里只派发。

export function BatchBar() {
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
  const canGenerate = models.length > 0 && garments.length > 0 && !!prompt.trim() && !cErr && !overCap && !running;

  const finished = cells.filter((c) => c.status === "success" || c.status === "failed").length;
  const successCells = cells.filter((c) => c.status === "success" && !!c.resultUrl);
  const failedCount = cells.filter((c) => c.status === "failed").length;
  const pct = cells.length ? Math.round((finished / cells.length) * 100) : 0;

  // 与 GenerateBar.onModel 相同的联动收敛：分辨率回退到该模型支持的档位，
  // GPT Image 2 不在预设表里的比例回落 auto。
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

  // 打包下载（D10）：把 success 格的本地文件名 + 期望的 zip 内命名交给
  // /api/batch/export，拿回 zip blob 触发下载。resultUrl 一定是
  // /api/media/<file> 形式（batchStore 只存本地落盘地址；上游直链兜底的
  // 情况在批量里按未成功计），非本地地址直接跳过。
  async function exportZip() {
    const files = successCells
      .map((c) => {
        const m = /^\/api\/media\/([^/?#]+)$/.exec(c.resultUrl || "");
        if (!m) return null;
        const g = garments[c.garmentIndex];
        return { file: decodeURIComponent(m[1]), name: `${g?.name ?? nouns.item}-${nouns.base}${c.modelIndex + 1}.png` };
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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
      <AnimatePresence>
        <motion.div
          key="batchbar"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="glass pointer-events-auto w-[min(920px,96vw)] rounded-panel p-3.5"
        >
          {/* 芯片行：批量换装 + 类型 + 计数；运行/完成态换成进度与动作 */}
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-2 pr-3 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-accent">
                <Icon name={nouns.icon} size={13} weight="bold" />
              </span>
              <span className="font-medium text-fg">{nouns.chip}</span>
            </span>

            {running ? (
              <>
                <div className="flex min-w-[160px] flex-1 items-center gap-2.5">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-xs text-fg-dim">
                    已完成 {finished}/{cells.length}
                    {failedCount ? ` · ${failedCount} 张未成功` : ""}
                  </span>
                </div>
                <Button variant="ghost" onClick={stopRun} className="h-8 px-3 text-xs">
                  <Icon name="Square" size={12} weight="fill" />
                  停止
                </Button>
              </>
            ) : done ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-sm text-fg-dim">
                  <Icon name="Check" size={14} weight="bold" className="text-accent" />
                  完成 {successCells.length}/{cells.length} 张
                  {failedCount ? ` · ${failedCount} 张未成功` : ""}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {failedCount ? (
                    <Button variant="ghost" onClick={retryFailed} className="h-8 px-3 text-xs">
                      <Icon name="ArrowClockwise" size={13} />
                      重试未成功
                    </Button>
                  ) : null}
                  {successCells.length ? (
                    <Button variant="ghost" onClick={exportZip} disabled={exporting} className="h-8 px-3 text-xs">
                      <Icon name={exporting ? "CircleNotch" : "DownloadSimple"} size={13} className={exporting ? "animate-spin" : undefined} />
                      打包下载 {successCells.length} 张
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <Select
                  value={promptEdited ? "custom" : wearTypeId}
                  onChange={(v) => {
                    if (v !== "custom") setWearType(v);
                  }}
                  options={[
                    ...WEAR_TYPES.map((w) => ({ value: w.id, label: w.label })),
                    ...(promptEdited ? [{ value: "custom", label: "自定义" }] : []),
                  ]}
                  className="w-[136px]"
                />
                <span className="text-sm text-fg-mute">
                  {models.length && garments.length
                    ? `${models.length} ${nouns.baseUnit}${nouns.base} × ${garments.length} ${nouns.itemUnit}${nouns.item}`
                    : `先在上方添加${nouns.base}和${nouns.item}`}
                </span>
              </>
            )}
          </div>

          {/* 提示词 + 参数（运行中锁定 — D7 的编辑锁同样盖到生成栏） */}
          {running ? null : (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  wearTypeId === "generic"
                    ? `用自己的话描述要怎么替换（第一张是${nouns.base}、第二张是${nouns.item}），或切换上方类型使用预设…`
                    : `${nouns.promptLabel}（切换上方类型会重写这里，也可手动修改）…`
                }
                rows={2}
                className="w-full resize-none rounded-control border border-line bg-panel-2/60 p-3 text-sm leading-relaxed text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
              />

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
                  value={params.aspectRatio}
                  onChange={(v) => updateParams({ aspectRatio: v })}
                  options={ASPECT_RATIOS.map((a) => ({
                    value: a,
                    label: a === "auto" ? "自动比例" : a,
                    disabled: params.model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(a),
                  }))}
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

                <div className="ml-auto flex items-center gap-3">
                  <Button variant="primary" onClick={generate} disabled={!canGenerate} className="px-6">
                    <Icon name="Lightning" size={16} weight="fill" />
                    生成 {total > 0 ? total : ""} 张
                  </Button>
                </div>
              </div>

              {cErr || overCap ? (
                <div className={cn("mt-2 flex items-center gap-1.5 text-xs text-amber-300")}>
                  <Icon name="Warning" size={13} />
                  {cErr || `单次最多 ${MAX_BATCH_TASKS} 张（当前 ${total} 张），请减少${nouns.base}或${nouns.item}分批生成`}
                </div>
              ) : null}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
