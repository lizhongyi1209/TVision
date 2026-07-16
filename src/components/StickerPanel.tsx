"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStudio } from "@/lib/store";
import { cn, compositeStickersToDataURL, fileToDownscaledDataURL, loadImage } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

interface Sticker {
  id: number;
  src: string;
  natW: number;
  natH: number;
  cx: number; // center, fraction of the base image's display box (0-1, may drift out to -0.2~1.2)
  cy: number;
  wFrac: number; // display width / base display width
  rotation: number; // radians
}

/** Pointer-drag scratch state, kept in a ref (not state) so pointermove doesn't
 *  trigger extra renders beyond the sticker update itself. */
interface DragState {
  id: number;
  mode: "move" | "handle";
  startX: number;
  startY: number;
  startCx: number;
  startCy: number;
  startWFrac: number;
  startRot: number;
  centerX: number; // screen px, only used by "handle" mode
  centerY: number;
  v0x: number;
  v0y: number;
}

let stickerSeq = 1;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function StickerPanel() {
  const image = useStudio((s) => s.image);
  const close = useStudio((s) => s.closeSticker);
  const replaceImage = useStudio((s) => s.replaceImage);
  const showToast = useStudio((s) => s.showToast);

  const boxRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const selectedIdRef = useRef<number | null>(null);

  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  selectedIdRef.current = selectedId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIdRef.current != null) {
        e.preventDefault();
        const id = selectedIdRef.current;
        setStickers((prev) => prev.filter((s) => s.id !== id));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Wheel-to-zoom needs a non-passive listener — React's onWheel prop is
  // attached passively by default, so preventDefault() there silently no-ops
  // and the page scrolls under the panel instead of the sticker resizing.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const hit = (e.target as HTMLElement).closest("[data-sticker-id]");
      if (!hit) return;
      const id = Number(hit.getAttribute("data-sticker-id"));
      if (id !== selectedIdRef.current) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06;
      setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, wFrac: clamp(s.wFrac * factor, 0.02, 3) } : s)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const imgFiles = files.filter((f) => f.type.startsWith("image/"));
      for (const file of imgFiles) {
        try {
          const { dataUrl } = await fileToDownscaledDataURL(file, 2048, 0.95);
          const img = await loadImage(dataUrl);
          const natW = img.naturalWidth;
          const natH = img.naturalHeight;
          // Cap the initial width fraction so the sticker's displayed height
          // never starts above ~35% of the base image's displayed height —
          // base display and natural aspect ratio are the same, so the base's
          // natural size (already known from the store, no need to wait on an
          // <img onLoad>) is enough to compute the cap.
          const baseW = image?.width || 1;
          const baseH = image?.height || 1;
          const cap = 0.35 * (baseH / baseW) * (natW / natH);
          const wFrac = Math.min(0.35, cap);
          const id = stickerSeq++;
          setStickers((prev) => [...prev, { id, src: dataUrl, natW, natH, cx: 0.5, cy: 0.5, wFrac, rotation: 0 }]);
          setSelectedId(id);
        } catch {
          showToast("error", "贴纸上传失败");
        }
      }
    },
    [image, showToast],
  );

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) void addFiles(Array.from(e.target.files));
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void addFiles(Array.from(e.dataTransfer.files));
  }

  function removeSticker(id: number) {
    setStickers((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((sel) => (sel === id ? null : sel));
  }

  function onStickerPointerDown(e: React.PointerEvent<HTMLDivElement>, s: Sticker) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(s.id);
    dragRef.current = {
      id: s.id,
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      startCx: s.cx,
      startCy: s.cy,
      startWFrac: s.wFrac,
      startRot: s.rotation,
      centerX: 0,
      centerY: 0,
      v0x: 0,
      v0y: 0,
    };
  }
  function onStickerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!d || d.mode !== "move" || !rect || rect.width === 0 || rect.height === 0) return;
    const dx = (e.clientX - d.startX) / rect.width;
    const dy = (e.clientY - d.startY) / rect.height;
    setStickers((prev) =>
      prev.map((s) =>
        s.id === d.id ? { ...s, cx: clamp(d.startCx + dx, -0.2, 1.2), cy: clamp(d.startCy + dy, -0.2, 1.2) } : s,
      ),
    );
  }
  function onDragEnd() {
    dragRef.current = null;
  }

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>, s: Sticker) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(s.id);
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + s.cx * rect.width;
    const centerY = rect.top + s.cy * rect.height;
    dragRef.current = {
      id: s.id,
      mode: "handle",
      startX: e.clientX,
      startY: e.clientY,
      startCx: s.cx,
      startCy: s.cy,
      startWFrac: s.wFrac,
      startRot: s.rotation,
      centerX,
      centerY,
      v0x: e.clientX - centerX,
      v0y: e.clientY - centerY,
    };
  }
  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.mode !== "handle") return;
    const v1x = e.clientX - d.centerX;
    const v1y = e.clientY - d.centerY;
    const len0 = Math.hypot(d.v0x, d.v0y) || 1e-6;
    const len1 = Math.hypot(v1x, v1y);
    const wFrac = clamp(d.startWFrac * (len1 / len0), 0.02, 3);
    const rotation = d.startRot + (Math.atan2(v1y, v1x) - Math.atan2(d.v0y, d.v0x));
    setStickers((prev) => prev.map((s) => (s.id === d.id ? { ...s, wFrac, rotation } : s)));
  }

  async function apply() {
    if (!image || stickers.length === 0 || applying) return;
    setApplying(true);
    try {
      const res = await compositeStickersToDataURL(image.src, stickers);
      replaceImage({ src: res.dataUrl, width: res.width, height: res.height });
      showToast("success", `贴图完成 · ${res.width}×${res.height}`);
      close();
    } catch {
      showToast("error", "贴图合成失败");
    } finally {
      setApplying(false);
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
        className="glass fixed left-1/2 top-1/2 z-[97] flex max-h-[92dvh] w-fit min-w-[min(700px,94vw)] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="Sticker" size={18} className="text-accent" />
            <span className="font-medium text-fg">贴图</span>
            <span className="text-xs text-fg-mute">将另一张图叠加到当前图上</span>
          </div>
          <button onClick={close} className="text-fg-mute hover:text-fg" aria-label="关闭">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-4 transition-colors",
            dragOver && "bg-accent/5",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div
            ref={boxRef}
            className="relative inline-block max-h-[46dvh] max-w-full"
            onPointerDown={() => setSelectedId(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.src} alt="贴图底图" draggable={false} className="block max-h-[46dvh] max-w-full select-none" />

            {stickers.map((s) => (
              <div
                key={s.id}
                data-sticker-id={s.id}
                onPointerDown={(e) => onStickerPointerDown(e, s)}
                onPointerMove={onStickerPointerMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className="absolute touch-none cursor-move select-none"
                style={{
                  left: `${s.cx * 100}%`,
                  top: `${s.cy * 100}%`,
                  width: `${s.wFrac * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${s.rotation}rad)`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt="贴纸" draggable={false} className="pointer-events-none block h-auto w-full select-none" />
                {selectedId === s.id ? (
                  <>
                    <div className="pointer-events-none absolute inset-0 border border-dashed border-accent" />
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeSticker(s.id)}
                      aria-label="删除贴纸"
                      className="absolute -right-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full border border-line-2 bg-[#17171b] text-fg-dim hover:text-fg"
                    >
                      <Icon name="X" size={12} />
                    </button>
                    <div
                      onPointerDown={(e) => onHandlePointerDown(e, s)}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onDragEnd}
                      onPointerCancel={onDragEnd}
                      className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-ink bg-accent"
                    />
                  </>
                ) : null}
              </div>
            ))}

            {stickers.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 m-auto flex h-24 w-40 flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed border-line-2 bg-ink/40 text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
              >
                <Icon name="Plus" size={16} />
                <span className="text-xs">上传贴图</span>
              </button>
            ) : null}
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => fileInputRef.current?.click()}>
              <Icon name="Plus" size={14} />
              添加贴图
            </Button>
            <span className="text-xs text-fg-mute">拖动移动 · 角柄缩放旋转 · 滚轮缩放</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={close}>取消</Button>
            <Button variant="primary" onClick={apply} disabled={stickers.length === 0 || applying} className="px-5">
              {applying ? <Icon name="CircleNotch" size={15} className="animate-spin" /> : <Icon name="Check" size={15} weight="bold" />}
              保存合成
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
