"use client";

import { motion, useMotionValue, useTransform } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

// Drag-anywhere before/after compare. Uses a motion value (no per-frame React
// re-renders) driven by pointer position; honors reduced motion implicitly (no
// automatic animation, only direct manipulation).
export function CompareSlider({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = useMotionValue(50);
  const clip = useTransform(pct, (p) => `inset(0 ${100 - p}% 0 0)`);
  const left = useTransform(pct, (p) => `${p}%`);

  const dragging = useRef(false);
  const setFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    pct.set(Math.max(0, Math.min(100, p)));
  };

  return (
    <div
      ref={ref}
      className={cn("relative select-none overflow-hidden rounded-panel", className)}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFromClientX(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {/* after (full) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="生成结果" className="pointer-events-none block h-full w-full object-contain" draggable={false} />
      {/* before (clipped to the left of the divider) */}
      <motion.div className="absolute inset-0" style={{ clipPath: clip, WebkitClipPath: clip }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt="原图" className="pointer-events-none block h-full w-full object-contain" draggable={false} />
      </motion.div>

      {/* labels */}
      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-fg backdrop-blur">
        原图
      </div>
      <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-accent backdrop-blur">
        生成
      </div>

      {/* divider + handle */}
      <motion.div className="absolute inset-y-0 z-10 w-px bg-white/70 shadow-[0_0_12px_rgba(0,0,0,0.6)]" style={{ left }}>
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-black/50 backdrop-blur">
            <div className="flex gap-0.5">
              <span className="h-3 w-0.5 rounded bg-white/80" />
              <span className="h-3 w-0.5 rounded bg-white/80" />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
