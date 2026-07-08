"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import { getAction } from "@/lib/actions";
import { useStudio } from "@/lib/store";
import { cn, fileToDownscaledDataURL } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

// Inline reference-image slot that appears next to the canvas image once an
// action needing a reference (换上衣 / 换裤子 / 换背景) is active. No modal —
// the reference image sits beside the base image on the canvas. Once a result
// is on its way (`compact`), the slot shrinks so the result can lead visually
// while staying hoverable for a quick swap/removal.
export function RefSlot({ compact = false }: { compact?: boolean }) {
  const actionId = useStudio((s) => s.activeActionId);
  const refImage = useStudio((s) => s.refImage);
  const setRef = useStudio((s) => s.setRef);
  const cancelAction = useStudio((s) => s.cancelAction);
  const showToast = useStudio((s) => s.showToast);
  const action = getAction(actionId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function handle(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "请选择图片文件");
      return;
    }
    setBusy(true);
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1400, 0.92);
      setRef(dataUrl);
      showToast("success", "参考图已就绪");
    } catch {
      showToast("error", "读取失败");
    } finally {
      setBusy(false);
    }
  }

  if (!action) return null;

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
                    onClick={() => setRef(null)}
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
                  <Button variant="ghost" onClick={() => setRef(null)} className="bg-black/30">
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
    </motion.div>
  );
}
