"use client";

// 参考视频快速裁剪面板（PLAN-VIDEO-TRIM）。交互仿 CropPanel：
// motion 遮罩 + glass 面板 + Esc 关闭。核心是一条双柄时间范围滑条，
// 拖动任一柄时播放器 seek 到对应时间便于对帧；「应用裁剪」调 trimVideoFile
// 在浏览器内完成裁剪，产出新的 MP4 File 交给 onDone。

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { trimVideoFile } from "@/lib/videoTrim";
import { Icon } from "./icons";
import { Button } from "./ui";

const MIN_SPAN = 2;   // Seedance 单段参考视频下限（秒）
const MAX_SPAN = 15;  // 上限（秒）

export function VideoTrimPanel({
  file,
  previewUrl,
  duration,
  onDone,
  onCancel,
  onError,
}: {
  file: File;
  previewUrl: string;
  /** 原视频总时长（秒），由调用方用 readMediaMetadata 读好传入。 */
  duration: number;
  /** 裁剪成功：拿到新 File（面板不自关，由调用方收尾）。 */
  onDone: (trimmed: File) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(duration, MAX_SPAN));
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applying) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, applying]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) v.currentTime = Math.min(Math.max(t, 0), duration);
  }, [duration]);

  // 把指针位置换算成时间并更新对应的柄。start/end 相互 clamp：
  // 选区跨度限制在 [MIN_SPAN, MAX_SPAN] 内（视频本身不足 MIN_SPAN 的在入口就被拒了）。
  const moveHandle = useCallback((which: "start" | "end", clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const t = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration;
    if (which === "start") {
      setEnd((e) => {
        const s = Math.min(Math.max(t, 0), e - MIN_SPAN, duration);
        setStart(Math.max(s, e - MAX_SPAN, 0));
        return e;
      });
      seek(t);
    } else {
      setStart((s) => {
        const e = Math.max(Math.min(t, duration), s + MIN_SPAN);
        setEnd(Math.min(e, s + MAX_SPAN, duration));
        return s;
      });
      seek(t);
    }
  }, [duration, seek]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => moveHandle(dragging, e.clientX);
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, moveHandle]);

  // 播放时越过选区终点就跳回起点循环预览选区
  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || dragging || applying) return;
    if (v.currentTime > end || v.currentTime < start - 0.3) v.currentTime = start;
  }

  async function apply() {
    if (applying) return;
    setApplying(true);
    setProgress(0);
    videoRef.current?.pause();
    try {
      const trimmed = await trimVideoFile(file, start, end, setProgress);
      onDone(trimmed);
    } catch (error) {
      onError(error instanceof Error ? error.message : "视频裁剪失败");
      setApplying(false);
    }
  }

  const span = end - start;
  const pct = (t: number) => `${(t / duration) * 100}%`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[96] bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!applying) onCancel(); }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        className="glass fixed left-1/2 top-1/2 z-[97] flex max-h-[92dvh] w-fit min-w-[min(640px,94vw)] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="Scissors" size={18} className="text-accent" />
            <span className="font-medium text-fg">裁剪参考视频</span>
            <span className="text-[11px] text-fg-mute">单段 2-15 秒</span>
          </div>
          <button
            onClick={() => { if (!applying) onCancel(); }}
            className="text-fg-mute hover:text-fg"
            aria-label="关闭"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-4">
          <video
            ref={videoRef}
            src={previewUrl}
            controls
            muted
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            className="max-h-[46dvh] w-auto max-w-full rounded-control bg-black"
          />
        </div>

        {/* 双柄时间范围滑条 */}
        <div className="px-5 pb-1 pt-2">
          <div
            ref={trackRef}
            className="relative h-8 cursor-pointer touch-none select-none"
            onPointerDown={(e) => {
              // 点击轨道：就近吸附一个柄
              const rect = e.currentTarget.getBoundingClientRect();
              const t = ((e.clientX - rect.left) / rect.width) * duration;
              const which = Math.abs(t - start) <= Math.abs(t - end) ? "start" : "end";
              setDragging(which);
              moveHandle(which, e.clientX);
            }}
          >
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/70"
              style={{ left: pct(start), width: pct(span) }}
            />
            {(["start", "end"] as const).map((which) => (
              <div
                key={which}
                role="slider"
                aria-label={which === "start" ? "裁剪起点" : "裁剪终点"}
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={which === "start" ? start : end}
                className="absolute top-1/2 z-10 h-5 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-[4px] border border-accent bg-panel shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                style={{ left: pct(which === "start" ? start : end) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragging(which);
                }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px] text-fg-mute">
            <span>起点 {start.toFixed(1)}s</span>
            <span className="text-fg-dim">选取 {span.toFixed(1)}s / 原片 {duration.toFixed(1)}s</span>
            <span>终点 {end.toFixed(1)}s</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onCancel} disabled={applying}>取消</Button>
          <Button variant="primary" onClick={apply} disabled={applying || span < MIN_SPAN - 0.05} className="px-5">
            {applying
              ? <><Icon name="CircleNotch" size={15} className="animate-spin" />裁剪中 {Math.round(progress * 100)}%</>
              : <><Icon name="Check" size={15} weight="bold" />应用裁剪</>}
          </Button>
        </div>
      </motion.div>
    </>
  );
}
