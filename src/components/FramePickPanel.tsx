"use client";

// 视频取帧面板（PLAN-VIDEO-FRAME）。交互仿 VideoTrimPanel：motion 遮罩 +
// glass 面板 + Esc 关闭。核心是一条单柄时间滑条 + 首帧/尾帧快捷跳转 +
// 逐帧微调，选好画面后一键「设为起始帧 / 尾帧 / 加入参考图」。取帧用
// captureVideoFrameAt 在浏览器内截取当前时刻的原分辨率 JPEG，交给调用方
// 走和上传图片一样的 prepareImageAsset 校验路径。

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureVideoFrameAt } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

export type FrameTarget = "start" | "tail" | "ref";

// 逐帧微调步长（秒）。多数网络视频 24-30fps，40ms 约等于一帧多一点，
// 足够把停在黑帧/糊帧上的尾帧往前挪一两格。
const STEP = 0.04;

export function FramePickPanel({
  src,
  title = "提取视频帧",
  targets,
  initial = "end",
  onApply,
  onCancel,
  onError,
}: {
  /** 视频源：blob URL / 同源 output 直链最稳；跨域直链可能因画布污染无法取帧。 */
  src: string;
  title?: string;
  /** 允许的落点按钮（顺序即展示顺序）。 */
  targets: FrameTarget[];
  /** 打开时默认停靠位置：start=首帧，end=尾帧。 */
  initial?: "start" | "end";
  /** 取帧成功：拿到该帧 File 和落点（面板不自关，由调用方收尾）。 */
  onApply: (file: File, target: FrameTarget) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [applying, setApplying] = useState<FrameTarget | null>(null);
  const busy = applying != null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    const clamped = Math.min(Math.max(t, 0), v.duration || 0);
    v.currentTime = clamped;
    setTime(clamped);
  }, []);

  // 元数据就绪：拿到时长后按 initial 停靠。尾帧退 STEP 避免停在结尾黑帧上。
  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    setDuration(v.duration);
    seek(initial === "end" ? Math.max(0, v.duration - STEP) : 0);
  }

  const moveFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || !duration) return;
    const rect = track.getBoundingClientRect();
    seek(Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration);
  }, [duration, seek]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => moveFromClientX(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, moveFromClientX]);

  async function apply(target: FrameTarget) {
    if (busy) return;
    setApplying(target);
    videoRef.current?.pause();
    try {
      // 直接用面板里视频的当前时刻取帧：captureVideoFrameAt 会另开一个 video
      // 精确 seek 到同一时刻，避免依赖播放器的 seek 精度。
      const file = await captureVideoFrameAt(src, videoRef.current?.currentTime ?? time);
      onApply(file, target);
    } catch (error) {
      onError(error instanceof Error ? error.message : "取帧失败");
      setApplying(null);
    }
  }

  const pct = duration ? (time / duration) * 100 : 0;
  const applyLabel: Record<FrameTarget, string> = {
    start: "设为起始帧",
    tail: "设为尾帧",
    ref: "加入参考图",
  };
  const applyIcon: Record<FrameTarget, string> = {
    start: "ImageSquare",
    tail: "ImageSquare",
    ref: "Plus",
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[96] bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!busy) onCancel(); }}
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
            <Icon name="FilmStrip" size={18} className="text-accent" />
            <span className="font-medium text-fg">{title}</span>
            <span className="text-[11px] text-fg-mute">拖动或跳到首/尾帧后取帧</span>
          </div>
          <button
            onClick={() => { if (!busy) onCancel(); }}
            className="text-fg-mute hover:text-fg"
            aria-label="关闭"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-4">
          <video
            ref={videoRef}
            src={src}
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={() => { if (!dragging) setTime(videoRef.current?.currentTime ?? 0); }}
            className="max-h-[46dvh] w-auto max-w-full rounded-control bg-black"
          />
        </div>

        {/* 单柄时间滑条 */}
        <div className="px-5 pb-1 pt-2">
          <div
            ref={trackRef}
            className="relative h-8 cursor-pointer touch-none select-none"
            onPointerDown={(e) => {
              if (busy) return;
              setDragging(true);
              moveFromClientX(e.clientX);
            }}
          >
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/70"
              style={{ left: 0, width: `${pct}%` }}
            />
            <div
              role="slider"
              aria-label="取帧位置"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={time}
              className="absolute top-1/2 z-10 h-5 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-[4px] border border-accent bg-panel shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
              style={{ left: `${pct}%` }}
              onPointerDown={(e) => { e.stopPropagation(); if (!busy) setDragging(true); }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-fg-mute">
            <span>{time.toFixed(2)}s</span>
            <span className="text-fg-dim">原片 {duration.toFixed(2)}s</span>
          </div>
        </div>

        {/* 快捷跳转 + 逐帧微调 */}
        <div className="flex flex-wrap items-center justify-center gap-2 px-5 pb-1 pt-1">
          <Button variant="ghost" onClick={() => seek(0)} disabled={busy} className="text-xs">
            <Icon name="CaretLeft" size={13} weight="bold" />首帧
          </Button>
          <Button variant="ghost" onClick={() => seek(time - STEP)} disabled={busy} className="text-xs">
            <Icon name="CaretLeft" size={13} />上一帧
          </Button>
          <Button variant="ghost" onClick={() => seek(time + STEP)} disabled={busy} className="text-xs">
            下一帧<Icon name="CaretRight" size={13} />
          </Button>
          <Button variant="ghost" onClick={() => seek(Math.max(0, duration - STEP))} disabled={busy} className="text-xs">
            尾帧<Icon name="CaretRight" size={13} weight="bold" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>取消</Button>
          {targets.map((target) => (
            <Button
              key={target}
              variant="primary"
              onClick={() => apply(target)}
              disabled={busy || !duration}
              className="px-5"
            >
              {applying === target
                ? <><Icon name="CircleNotch" size={15} className="animate-spin" />取帧中…</>
                : <><Icon name={applyIcon[target]} size={15} weight="bold" />{applyLabel[target]}</>}
            </Button>
          ))}
        </div>
      </motion.div>
    </>
  );
}
