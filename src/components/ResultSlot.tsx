"use client";

import { motion, useReducedMotion } from "motion/react";
import { useLogStore } from "@/lib/logStore";
import { useStudio } from "@/lib/store";
import { cn, progressStageLabel, visionProgressStageLabel } from "@/lib/utils";
import { Icon } from "./icons";

// Right-hand canvas slot for the generation lifecycle: a live progress card
// while a job runs, then the freshly generated image once it lands. Mirrors
// RefSlot's layout (connector badge + w-[min(320px,32vw)] column) while busy;
// once a result lands the column widens so it reads as the clear focal point.
// Also doubles as the "视觉反推" analysis slot: same card language (title +
// percentage + stage text, or a red failure card), shown before any
// generation job exists.
export function ResultSlot() {
  const phase = useStudio((s) => s.phase);
  const progress = useStudio((s) => s.progress);
  const error = useStudio((s) => s.error);
  const results = useStudio((s) => s.results);
  const resultIndex = useStudio((s) => s.resultIndex);
  const setResultIndex = useStudio((s) => s.setResultIndex);
  const openResults = useStudio((s) => s.openResults);
  const closeSettings = useStudio((s) => s.closeSettings);
  const closeHistory = useStudio((s) => s.closeHistory);
  const analyzingVision = useStudio((s) => s.analyzingVision);
  const visionProgress = useStudio((s) => s.visionProgress);
  const visionError = useStudio((s) => s.visionError);
  const openDiagnostics = useLogStore((s) => s.openPanel);
  const reduce = useReducedMotion();

  const visionBusy = analyzingVision;
  const visionFailed = !!visionError && !analyzingVision;
  const busy = phase === "submitting" || phase === "running";
  const success = phase === "success" && !!results?.length;
  const failed = phase === "error";
  if (!visionBusy && !visionFailed && !busy && !success && !failed) return null;

  function viewDiagnostics() {
    // Diagnostics joins the same settings/history mutual-exclusion group.
    closeSettings();
    closeHistory();
    openDiagnostics();
  }

  const pct = Math.round(progress * 100);
  const visionPct = Math.round(visionProgress * 100);
  const current = results && results[resultIndex] ? results[resultIndex] : results?.[0];

  return (
    <motion.div
      key="resultslot"
      initial={{ opacity: 0, x: 12, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 12, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="flex items-center gap-4"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-fg-mute">
        <Icon name="ArrowRight" size={15} weight="bold" />
      </span>

      <div
        className={cn(
          "flex flex-col gap-3 transition-all duration-300",
          visionBusy || visionFailed || busy || failed ? "w-[min(320px,32vw)]" : "w-[min(480px,42vw)]",
        )}
      >
        {visionBusy ? (
          <motion.div
            animate={reduce ? undefined : { opacity: [0.85, 1, 0.85] }}
            transition={reduce ? undefined : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="glass flex aspect-[3/4] min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-panel border border-line px-6 text-center"
          >
            <div className="text-sm font-medium text-fg-dim">视觉反推中</div>
            <div className="text-4xl font-medium text-fg">{visionPct}%</div>
            <div className="text-sm text-fg-dim">{visionProgressStageLabel(visionPct)}</div>
            <div className="mt-1 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${visionPct}%` }}
              />
            </div>
          </motion.div>
        ) : visionFailed ? (
          <div className="glass flex aspect-[3/4] min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-panel border border-line px-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-300">
              <Icon name="Warning" size={20} weight="bold" />
            </span>
            <div className="text-base font-medium text-fg">反推失败</div>
            <p className="line-clamp-3 text-sm leading-relaxed text-fg-dim">{visionError || "未知错误，请重试"}</p>
            <button
              type="button"
              onClick={viewDiagnostics}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-line-2 hover:text-fg"
            >
              <Icon name="Pulse" size={13} />
              查看诊断台
            </button>
          </div>
        ) : busy ? (
          <motion.div
            animate={reduce ? undefined : { opacity: [0.85, 1, 0.85] }}
            transition={reduce ? undefined : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="glass flex aspect-[3/4] min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-panel border border-line px-6 text-center"
          >
            <div className="text-4xl font-medium text-fg">{pct}%</div>
            <div className="text-sm text-fg-dim">{progressStageLabel(pct)}</div>
            <div className="mt-1 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </motion.div>
        ) : failed ? (
          <div className="glass flex aspect-[3/4] min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-panel border border-line px-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-300">
              <Icon name="Warning" size={20} weight="bold" />
            </span>
            <div className="text-base font-medium text-fg">生成失败</div>
            <p className="line-clamp-3 text-sm leading-relaxed text-fg-dim">{error || "未知错误，请重试"}</p>
            <button
              type="button"
              onClick={viewDiagnostics}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-line-2 hover:text-fg"
            >
              <Icon name="Pulse" size={13} />
              查看诊断台
            </button>
          </div>
        ) : current ? (
          <>
            <button
              type="button"
              onClick={openResults}
              className="group relative overflow-hidden rounded-panel border border-line shadow-[0_10px_34px_-12px_rgba(0,0,0,0.5)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current} alt="生成结果" className="max-h-[62vh] w-full object-contain" />
              <span className="absolute left-2.5 top-2.5 rounded-full bg-black/50 px-2.5 py-1 text-xs text-fg backdrop-blur-sm">
                生成结果
              </span>
              <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 text-sm text-fg opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
                <Icon name="ArrowsLeftRight" size={15} />
                查看对比
              </div>
            </button>

            {results && results.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto">
                {results.map((r, i) => (
                  <button
                    key={r}
                    onClick={() => setResultIndex(i)}
                    className={cn(
                      "h-12 w-12 shrink-0 overflow-hidden rounded-control border transition-all",
                      i === resultIndex ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-2",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r} alt={`结果 ${i + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </motion.div>
  );
}
