"use client";

import { motion, useReducedMotion } from "motion/react";
import { useStudio } from "@/lib/store";
import { cn, progressStageLabel } from "@/lib/utils";
import { Icon } from "./icons";

// Right-hand canvas slot for the generation lifecycle: a live progress card
// while a job runs, then the freshly generated image once it lands. Mirrors
// RefSlot's layout (connector badge + w-[min(320px,32vw)] column) while busy;
// once a result lands the column widens so it reads as the clear focal point.
export function ResultSlot() {
  const phase = useStudio((s) => s.phase);
  const progress = useStudio((s) => s.progress);
  const results = useStudio((s) => s.results);
  const resultIndex = useStudio((s) => s.resultIndex);
  const setResultIndex = useStudio((s) => s.setResultIndex);
  const openResults = useStudio((s) => s.openResults);
  const reduce = useReducedMotion();

  const busy = phase === "submitting" || phase === "running";
  const success = phase === "success" && !!results?.length;
  if (!busy && !success) return null;

  const pct = Math.round(progress * 100);
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
          busy ? "w-[min(320px,32vw)]" : "w-[min(480px,42vw)]",
        )}
      >
        {busy ? (
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
