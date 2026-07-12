"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import { getAction, type StudioAction } from "@/lib/actions";
import { MAX_REF_IMAGES } from "@/lib/limits";
import { useStudio } from "@/lib/store";
import { cn, fileToDownscaledDataURL } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

// Inline reference-image slot that appears next to the canvas image. No modal —
// the reference image(s) sit beside the base image on the canvas. Once a result
// is on its way (`compact`), the slot shrinks so the result can lead visually
// while staying hoverable for a quick swap/removal.
//
// Two distinct modes share the one `refImages` array in the store (D2 in
// PLAN-MULTI-REF), split here into two sub-components so neither has to reason
// about the other's shape:
//  - PresetRefBox: an action with needsRef is active (换上衣/换裤子/换背景) —
//    exactly the original single large upload box, capped at 1 image, unchanged
//    interaction copy.
//  - FreeRefList: no action is selected — the user writes their own prompt and
//    can attach up to MAX_REF_IMAGES reference images, each numbered "图 N"
//    (index+2, matching actions.ts's "the first image / the second image…"
//    prompt-wording convention), with per-image replace/delete/reorder.
export function RefSlot({ compact = false }: { compact?: boolean }) {
  const actionId = useStudio((s) => s.activeActionId);
  const action = getAction(actionId);

  // Stage.tsx only renders RefSlot when action?.needsRef or (!action &&
  // !inpaintMask), but guard defensively in case that ever drifts.
  if (action && !action.needsRef) return null;

  return (
    <motion.div
      key="refslot"
      initial={{ opacity: 0, x: 12, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 12, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="flex items-center gap-4"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-fg-mute">
        <Icon name="Plus" size={15} weight="bold" />
      </span>

      {action ? <PresetRefBox action={action} compact={compact} /> : <FreeRefList compact={compact} />}
    </motion.div>
  );
}

// ── Preset mode: single reference image, needsRef actions only ─────────────
// Byte-for-byte the same interaction as before the multi-ref feature landed,
// just reading/writing refImages[0] instead of a standalone refImage string.
function PresetRefBox({ action, compact }: { action: StudioAction; compact: boolean }) {
  const refImages = useStudio((s) => s.refImages);
  const addRefs = useStudio((s) => s.addRefs);
  const removeRef = useStudio((s) => s.removeRef);
  const replaceRef = useStudio((s) => s.replaceRef);
  const cancelAction = useStudio((s) => s.cancelAction);
  const showToast = useStudio((s) => s.showToast);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const refImage = refImages[0];

  async function handle(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "请选择图片文件");
      return;
    }
    setBusy(true);
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1400, 0.92);
      if (refImages.length) replaceRef(0, dataUrl);
      else addRefs([dataUrl]);
      showToast("success", "参考图已就绪");
    } catch {
      showToast("error", "读取失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 transition-all duration-300",
        compact ? "w-[min(150px,14vw)]" : "w-[min(320px,32vw)]",
      )}
    >
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handle(e.target.files?.[0])} />

      {refImage ? (
        <div className="group relative overflow-hidden rounded-panel border border-line shadow-[0_10px_34px_-12px_rgba(0,0,0,0.5)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={refImage}
            alt="参考图"
            className={cn(
              "w-full object-contain transition-all duration-300",
              compact ? "max-h-[200px]" : "max-h-[52vh]",
            )}
          />
          <span
            className={cn(
              "absolute left-2.5 top-2.5 rounded-full bg-black/50 text-fg backdrop-blur-sm",
              compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
            )}
          >
            参考图
          </span>
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
            {compact ? (
              <>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  title="更换"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-fg transition-colors hover:bg-black/70"
                >
                  <Icon name="ArrowClockwise" size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => removeRef(0)}
                  title="移除"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-fg transition-colors hover:bg-black/70"
                >
                  <Icon name="X" size={13} />
                </button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => inputRef.current?.click()} className="bg-black/30">
                  更换
                </Button>
                <Button variant="ghost" onClick={() => removeRef(0)} className="bg-black/30">
                  移除
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            // This box sits inside Stage's own onDrop handler (which would
            // otherwise also fire for the same drop and replace the main
            // canvas image — see Stage.tsx's addFiles). Stop it here.
            e.stopPropagation();
            setDrag(false);
            handle(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex aspect-[3/4] w-full flex-col items-center justify-center rounded-panel border border-dashed text-center transition-all duration-300",
            compact ? "gap-1.5 px-2" : "min-h-[280px] gap-3 px-5",
            drag ? "border-accent bg-accent/5" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
          )}
        >
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-white/5 text-fg-dim",
              compact ? "h-8 w-8" : "h-12 w-12",
            )}
          >
            <Icon
              name={busy ? "CircleNotch" : "UploadSimple"}
              size={compact ? 16 : 22}
              className={busy ? "animate-spin text-accent" : undefined}
            />
          </span>
          {compact ? (
            <div className="text-[11px] text-fg-mute">{busy ? "处理中…" : "点击或拖入"}</div>
          ) : (
            <>
              <div className="text-sm text-fg">{busy ? "正在处理…" : action.refLabel}</div>
              <div className="text-xs text-fg-mute">
                {action.refHint ? `${action.refHint} · ` : ""}
                点击或拖入图片
              </div>
            </>
          )}
        </button>
      )}

      {compact ? null : (
        <div className="flex justify-center">
          <Button variant="subtle" onClick={cancelAction}>
            取消操作
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Free mode: no action selected, multi-reference list ────────────────────
// A no-scroll, self-fitting stack of numbered thumbnails plus a trailing
// "add" tile: 1 column while the list is short, 2 columns from 4 refs up,
// with each thumbnail's height budget split evenly across rows so that even
// MAX_REF_IMAGES refs + the add tile stay fully visible inside the canvas
// (2026-07-12 feedback: no scrollbar, ever). Zero refs collapses down to
// just that add tile (no big empty-state box like the preset mode's — this
// entry point is meant to stay lightweight since free mode is the "didn't
// pick a preset" default, not a deliberate upload step).
function FreeRefList({ compact }: { compact: boolean }) {
  const refImages = useStudio((s) => s.refImages);
  const addRefs = useStudio((s) => s.addRefs);
  const removeRef = useStudio((s) => s.removeRef);
  const replaceRef = useStudio((s) => s.replaceRef);
  const moveRef = useStudio((s) => s.moveRef);
  const showToast = useStudio((s) => s.showToast);

  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function handleAdd(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      if (files.length) showToast("error", "请选择图片文件");
      return;
    }
    const room = MAX_REF_IMAGES - refImages.length;
    const accepted = images.slice(0, Math.max(0, room));
    if (images.length > accepted.length) showToast("error", `最多添加 ${MAX_REF_IMAGES} 张参考图`);
    if (!accepted.length) return;
    setBusy(true);
    try {
      const dataUrls = await Promise.all(
        accepted.map((f) => fileToDownscaledDataURL(f, 1400, 0.92).then((r) => r.dataUrl)),
      );
      addRefs(dataUrls);
    } catch {
      showToast("error", "读取失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleReplace(file: File | undefined | null) {
    const index = replaceIndex;
    if (!file || index == null) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "请选择图片文件");
      return;
    }
    setBusy(true);
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1400, 0.92);
      replaceRef(index, dataUrl);
    } catch {
      showToast("error", "读取失败");
    } finally {
      setBusy(false);
      setReplaceIndex(null);
    }
  }

  // ── No-scroll layout math ─────────────────────────────────────────────
  // Column count steps 1 → 2 once the list needs it; each thumbnail then
  // gets an equal share of the canvas height. Budget: the stage row
  // reserves 32px top + 232px bottom padding, and this column additionally
  // holds the add tile plus inter-row gaps — ~380px all-in, so
  // (100vh - 380px) / rows is what one row may occupy. The min() cap keeps
  // short lists looking exactly like before (52vh / 200px ceilings shared
  // with PresetRefBox).
  const count = refImages.length;
  const cols = count >= 4 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(count / cols));
  const thumbMaxH = `min(${compact ? "200px" : "52vh"}, (100vh - 380px) / ${rows})`;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 transition-all duration-300",
        compact ? "w-[min(150px,14vw)]" : "w-[min(320px,32vw)]",
      )}
    >
      <input
        ref={addInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleAdd(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          handleReplace(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {count ? (
        <div className={cn("grid gap-2", cols === 2 && "grid-cols-2")}>
          {refImages.map((url, idx) => (
            // Outer cell centers the card inside its grid lane; the card
            // itself shrink-wraps the image (w-fit + max-w-full) so it still
            // hugs each image's own aspect ratio — the adaptive-aspect look
            // confirmed last round — while the dynamic maxHeight keeps every
            // row inside its share of the canvas.
            <div key={idx} className="flex items-center justify-center">
              <div className="group relative w-fit max-w-full overflow-hidden rounded-control border border-line bg-panel-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`参考图 ${idx + 2}`}
                  className="block max-w-full object-contain"
                  style={{ maxHeight: thumbMaxH }}
                />
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-fg backdrop-blur-sm">
                  图 {idx + 2}
                </span>
                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setReplaceIndex(idx);
                      replaceInputRef.current?.click();
                    }}
                    title="更换"
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-fg transition-colors hover:bg-black/70"
                  >
                    <Icon name="ArrowClockwise" size={11} />
                  </button>
                  {compact ? null : (
                    // Reorder arrows follow the visual flow: up/down in the
                    // single-column layout, left/right once the grid goes
                    // two-column. Compact (result showing) drops them —
                    // same reduced hover set as PresetRefBox's compact mode;
                    // reordering lives in the full-size view.
                    <>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveRef(idx, -1)}
                        title={cols === 2 ? "前移" : "上移"}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-fg transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Icon name={cols === 2 ? "CaretLeft" : "CaretUp"} size={11} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === refImages.length - 1}
                        onClick={() => moveRef(idx, 1)}
                        title={cols === 2 ? "后移" : "下移"}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-fg transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Icon name={cols === 2 ? "CaretRight" : "CaretDown"} size={11} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => removeRef(idx)}
                    title="删除"
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-fg transition-colors hover:bg-black/70"
                  >
                    <Icon name="X" size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => addInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          // Same reasoning as PresetRefBox's onDrop above: don't let this
          // bubble up to Stage's own onDrop and clobber the main image.
          e.stopPropagation();
          setDrag(false);
          handleAdd(Array.from(e.dataTransfer.files || []));
        }}
        className={cn(
          "flex shrink-0 items-center justify-center gap-1.5 rounded-control border border-dashed transition-all duration-300",
          compact ? "h-11 px-2" : "h-14 px-4",
          drag ? "border-accent bg-accent/5" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
        )}
      >
        <Icon
          name={busy ? "CircleNotch" : "Plus"}
          size={compact ? 13 : 15}
          className={busy ? "animate-spin text-accent" : "text-fg-dim"}
        />
        {compact ? null : <span className="text-xs text-fg-mute">{busy ? "处理中…" : "添加参考图"}</span>}
      </button>
    </div>
  );
}
