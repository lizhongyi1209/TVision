"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";

function ProgressRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, value)));
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

// The placed photo: springs in, tilts subtly toward the pointer (motion values,
// no per-frame re-render), toggles the radial menu on click, and shows a filmic
// scan + progress overlay while a job runs.
export function ImageNode() {
  const image = useStudio((s) => s.image);
  const menuOpen = useStudio((s) => s.menuOpen);
  const openMenu = useStudio((s) => s.openMenu);
  const closeMenu = useStudio((s) => s.closeMenu);
  const activeActionId = useStudio((s) => s.activeActionId);
  const phase = useStudio((s) => s.phase);
  const progress = useStudio((s) => s.progress);
  const reduce = useReducedMotion();
  const busy = phase === "submitting" || phase === "running";

  const mvX = useMotionValue(0);
  const mvY = useMotionValue(0);
  const rotY = useSpring(useTransform(mvX, [-0.5, 0.5], reduce ? [0, 0] : [-7, 7]), { stiffness: 150, damping: 18 });
  const rotX = useSpring(useTransform(mvY, [-0.5, 0.5], reduce ? [0, 0] : [7, -7]), { stiffness: 150, damping: 18 });

  if (!image) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 24 }}
      onPointerMove={(e) => {
        if (reduce || busy) return;
        const r = e.currentTarget.getBoundingClientRect();
        mvX.set((e.clientX - r.left) / r.width - 0.5);
        mvY.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => {
        mvX.set(0);
        mvY.set(0);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (busy) return;
        if (menuOpen) closeMenu();
        else openMenu();
      }}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 1100 }}
      className="relative inline-block cursor-pointer rounded-panel"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt="画布图片"
        draggable={false}
        className="block max-h-[max(240px,calc(100dvh-380px))] max-w-[min(72vw,760px)] rounded-panel shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)]"
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-0 rounded-panel ring-1 transition-all duration-300",
          menuOpen ? "ring-accent/70" : "ring-white/10",
        )}
      />

      {!busy && !menuOpen && !activeActionId ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="glass pointer-events-none absolute -bottom-11 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-fg-dim"
        >
          点击图片，选择操作
        </motion.div>
      ) : null}

      {busy ? (
        <div className="absolute inset-0 overflow-hidden rounded-panel">
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-x-0 top-0 h-1/3 scan-sweep" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <ProgressRing value={progress} />
            <div className="breathe text-sm font-medium text-fg">
              {phase === "submitting" ? "提交中…" : `生成中 · ${Math.round(progress * 100)}%`}
            </div>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
