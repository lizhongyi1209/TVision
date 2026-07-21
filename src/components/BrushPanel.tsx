"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAction } from "@/lib/actions";
import { diag } from "@/lib/logStore";
import { useStudio, type PlacedImage } from "@/lib/store";
import type { InpaintMask } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

/** 画布模式复用（PLAN-BOARD）：传 override 后不再读写 useStudio 的
 *  image/inpaintMask/activeActionId，确认时把遮罩交给 onApply；不传保持
 *  单图创作原行为。 */
export interface BrushPanelOverride {
  image: PlacedImage;
  onApply: (mask: InpaintMask) => void;
  onClose: () => void;
}

const MIN_SIZE = 0.02; // brush diameter, fraction of the image's short side
const MAX_SIZE = 0.2;
const DEFAULT_SIZE = 0.08;
const BBOX_PAD_RATIO = 0.08; // each bbox edge padded by this fraction of the short side
const FEATHER_RATIO = 0.015; // blur radius, same basis

interface Point {
  x: number; // 0-1, relative to the rendered image box (NOT the container)
  y: number;
}
interface Stroke {
  points: Point[];
  sizeRel: number;
  erase: boolean;
}
interface Layout {
  renderW: number;
  renderH: number;
  offsetX: number;
  offsetY: number;
}

const ZERO_LAYOUT: Layout = { renderW: 0, renderH: 0, offsetX: 0, offsetY: 0 };

/** Draw one stroke (paint or erase) onto a 2D context already sized to the
 *  target box; `points` are still 0-1 relative and get scaled by `w`/`h` here. */
function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number, color: string) {
  const shortSide = Math.min(w, h);
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s.sizeRel * shortSide);
  if (s.points.length === 1) {
    ctx.beginPath();
    ctx.arc(s.points[0].x * w, s.points[0].y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  s.points.forEach((p, i) => {
    const px = p.x * w;
    const py = p.y * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

// Brush-based local-repaint selection panel: paint the area to change, confirm
// to bake a feathered natural-resolution alpha mask + padded bounding box into
// the store (inpaintMask). Generation itself happens later from GenerateBar —
// this panel only produces the selection.
export function BrushPanel({ override }: { override?: BrushPanelOverride }) {
  const storeImage = useStudio((s) => s.image);
  const activeActionId = useStudio((s) => s.activeActionId);
  const storeClose = useStudio((s) => s.closeBrushPanel);
  const setInpaintMask = useStudio((s) => s.setInpaintMask);
  const showToast = useStudio((s) => s.showToast);
  const image = override?.image ?? storeImage;
  const close = override?.onClose ?? storeClose;
  const brushAction = !override && getAction(activeActionId)?.usesBrush ? getAction(activeActionId) : undefined;
  const panelLabel = brushAction?.label ?? "局部重绘";
  const panelIcon = brushAction?.icon ?? "PaintBrush";

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null);
  const [layout, setLayout] = useState<Layout>(ZERO_LAYOUT);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brushSize, setBrushSize] = useState(DEFAULT_SIZE);
  const [erase, setErase] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el || !natSize) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scale = Math.min(cw / natSize.w, ch / natSize.h);
    const renderW = natSize.w * scale;
    const renderH = natSize.h * scale;
    setLayout({ renderW, renderH, offsetX: (cw - renderW) / 2, offsetY: (ch - renderH) / 2 });
  }, [natSize]);

  useEffect(() => {
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [recompute]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Redraw the live preview from `strokes` whenever they (or the layout) change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || layout.renderW === 0) return;
    canvas.width = layout.renderW;
    canvas.height = layout.renderH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) paintStroke(ctx, s, canvas.width, canvas.height, "rgba(230,178,119,0.4)");
    ctx.globalCompositeOperation = "source-over";
  }, [strokes, layout]);

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    setNatSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
  }

  function relPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = relPoint(e);
    setStrokes((prev) => [...prev, { points: [p], sizeRel: brushSize, erase }]);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const p = relPoint(e);
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, p] };
      return next;
    });
  }
  function onPointerUp() {
    drawingRef.current = false;
  }

  function undo() {
    setStrokes((prev) => prev.slice(0, -1));
  }
  function clearAll() {
    setStrokes([]);
  }

  async function confirm() {
    if (!image || !natSize || strokes.length === 0 || confirming) return;
    setConfirming(true);
    try {
      const { w: natW, h: natH } = natSize;
      const shortSide = Math.min(natW, natH);

      // 1. Feathered alpha mask at natural resolution. Background stays fully
      // transparent (alpha 0) so downstream destination-in compositing keys
      // off it directly; strokes are drawn opaque white, then the whole thing
      // is blurred (onto a second canvas, to dodge same-canvas blur aliasing).
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = natW;
      maskCanvas.height = natH;
      const mctx = maskCanvas.getContext("2d");
      if (!mctx) throw new Error("无法创建画布上下文");
      for (const s of strokes) paintStroke(mctx, s, natW, natH, "white");
      mctx.globalCompositeOperation = "source-over";

      const blurPx = Math.round(shortSide * FEATHER_RATIO);
      const blurred = document.createElement("canvas");
      blurred.width = natW;
      blurred.height = natH;
      const bctx = blurred.getContext("2d");
      if (!bctx) throw new Error("无法创建画布上下文");
      bctx.filter = `blur(${blurPx}px)`;
      bctx.drawImage(maskCanvas, 0, 0);
      const maskUrl = blurred.toDataURL("image/png");

      // 2. Padded, clamped bounding box (natural pixels) over every stroke point.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const s of strokes) {
        for (const p of s.points) {
          const px = p.x * natW;
          const py = p.y * natH;
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
      }
      const pad = shortSide * BBOX_PAD_RATIO;
      minX = Math.min(Math.max(0, minX - pad), natW);
      minY = Math.min(Math.max(0, minY - pad), natH);
      maxX = Math.min(Math.max(0, maxX + pad), natW);
      maxY = Math.min(Math.max(0, maxY + pad), natH);
      const bboxPx = {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.max(1, Math.round(maxX - minX)),
        h: Math.max(1, Math.round(maxY - minY)),
      };

      if (override) override.onApply({ maskUrl, bboxPx });
      else setInpaintMask({ maskUrl, bboxPx });
      diag("info", panelLabel, "已标记涂抹区域", `bbox ${bboxPx.w}×${bboxPx.h} @ (${bboxPx.x},${bboxPx.y})`);
      close();
    } catch {
      showToast("error", "生成涂抹遮罩失败，请重试");
    } finally {
      setConfirming(false);
    }
  }

  if (!image) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[96] bg-black/60 backdrop-blur-sm"
        onClick={close}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        className="glass fixed left-1/2 top-1/2 z-[97] flex max-h-[92dvh] w-fit min-w-[min(760px,94vw)] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name={panelIcon} size={18} className="text-accent" />
            <span className="font-medium text-fg">{panelLabel}</span>
          </div>
          <button onClick={close} className="text-fg-mute hover:text-fg" aria-label="关闭">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="px-5 pt-3 text-xs leading-relaxed text-fg-mute">
          {brushAction?.usesBrush
            ? "完整涂抹要移除的物品，适当覆盖边缘和阴影；AI 会补全被遮挡的背景，其余区域保持不变"
            : "涂抹要修改的区域，其余部分生成时保持不变；提示词请在下方对话框自己填写"}
        </div>

        <div
          ref={containerRef}
          className="relative mx-5 my-4 h-[52dvh] min-h-[280px] overflow-hidden"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt="涂抹预览"
            draggable={false}
            onLoad={onImgLoad}
            className="pointer-events-none absolute select-none"
            style={{ width: layout.renderW, height: layout.renderH, left: layout.offsetX, top: layout.offsetY }}
          />
          <canvas
            ref={canvasRef}
            className="absolute touch-none rounded-sm"
            style={{
              width: layout.renderW,
              height: layout.renderH,
              left: layout.offsetX,
              top: layout.offsetY,
              cursor: erase ? "cell" : "crosshair",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-mute">笔刷</span>
              <input
                type="range"
                min={MIN_SIZE * 100}
                max={MAX_SIZE * 100}
                value={brushSize * 100}
                onChange={(e) => setBrushSize(Number(e.target.value) / 100)}
                className="h-1.5 w-28 cursor-pointer accent-[var(--color-accent)]"
                aria-label="画笔粗细"
              />
            </div>
            <button
              type="button"
              onClick={() => setErase((v) => !v)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs transition-colors",
                erase ? "border-accent bg-accent/15 text-accent" : "text-fg-dim hover:text-fg",
              )}
            >
              <Icon name="Eraser" size={14} />
              橡皮擦
            </button>
            <button
              type="button"
              onClick={undo}
              disabled={strokes.length === 0}
              className="flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-fg-dim hover:text-fg disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="ArrowCounterClockwise" size={14} />
              撤销
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={strokes.length === 0}
              className="flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-fg-dim hover:text-fg disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="Trash" size={14} />
              清空
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={close}>取消</Button>
            <Button variant="primary" onClick={confirm} disabled={strokes.length === 0 || confirming} className="px-5">
              {confirming ? <Icon name="CircleNotch" size={15} className="animate-spin" /> : <Icon name="Check" size={15} weight="bold" />}
              {brushAction?.usesBrush ? "确认移除区域" : "确认"}
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
