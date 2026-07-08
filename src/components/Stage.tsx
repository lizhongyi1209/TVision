"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAction } from "@/lib/actions";
import { useStudio } from "@/lib/store";
import { cn, fileToDownscaledDataURL } from "@/lib/utils";
import { Icon } from "./icons";
import { ImageNode } from "./ImageNode";
import { RadialMenu } from "./RadialMenu";
import { RefSlot } from "./RefSlot";
import { ResultSlot } from "./ResultSlot";

function Dropzone({ drag, busy, onPick }: { drag: boolean; busy: boolean; onPick: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <motion.button
        type="button"
        onClick={onPick}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className={cn(
          "group relative flex h-[52vh] w-[min(680px,86vw)] flex-col items-center justify-center gap-5 rounded-[28px] border border-dashed transition-all duration-300",
          drag ? "scale-[1.01] border-accent bg-accent/[0.06]" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
        )}
      >
        <span
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-white/[0.03] transition-colors",
            drag ? "text-accent" : "text-fg-dim group-hover:text-fg",
          )}
        >
          <Icon name={busy ? "CircleNotch" : "ImageSquare"} size={30} className={busy ? "animate-spin text-accent" : undefined} />
        </span>
        <div className="text-center">
          <div className="text-lg font-medium text-fg">{busy ? "正在读取…" : "拖入或点击添加照片"}</div>
          <div className="mt-1.5 text-sm text-fg-mute">支持拖拽 · 点击选择 · 直接粘贴　|　人物 / 商品主图</div>
        </div>
      </motion.button>
    </div>
  );
}

export function Stage() {
  const image = useStudio((s) => s.image);
  const setImage = useStudio((s) => s.setImage);
  const menuOpen = useStudio((s) => s.menuOpen);
  const closeMenu = useStudio((s) => s.closeMenu);
  const activeActionId = useStudio((s) => s.activeActionId);
  const phase = useStudio((s) => s.phase);
  const results = useStudio((s) => s.results);
  const showToast = useStudio((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const action = getAction(activeActionId);
  const resultVisible =
    !!image &&
    (phase === "submitting" || phase === "running" || (phase === "success" && !!results?.length));
  const refVisible = !!image && !!action?.needsRef;

  const addFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (file.type && !file.type.startsWith("image/")) {
        showToast("error", "请选择图片文件");
        return;
      }
      setBusy(true);
      try {
        const { dataUrl, width, height } = await fileToDownscaledDataURL(file, 1800, 0.94);
        setImage({ src: dataUrl, width, height });
      } catch {
        showToast("error", "读取图片失败");
      } finally {
        setBusy(false);
      }
    },
    [setImage, showToast],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            addFile(f);
            e.preventDefault();
            break;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFile]);

  return (
    <div
      className="relative flex-1 overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        addFile(e.dataTransfer?.files?.[0]);
      }}
      onClick={() => {
        if (menuOpen) closeMenu();
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(58% 52% at 50% 42%, rgba(230,178,119,0.06), transparent 70%)" }}
      />
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => addFile(e.target.files?.[0])} />

      {!image ? (
        <Dropzone drag={drag} busy={busy} onPick={() => inputRef.current?.click()} />
      ) : (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center px-8 pt-8 pb-[232px]",
            refVisible || resultVisible ? "gap-4" : "gap-6",
          )}
        >
          <div className={cn("relative shrink-0", resultVisible && "stage-image-compact")}>
            <ImageNode />
            <AnimatePresence>{menuOpen ? <RadialMenu /> : null}</AnimatePresence>
          </div>
          <AnimatePresence>
            {refVisible ? <RefSlot key="ref" compact={resultVisible} /> : null}
          </AnimatePresence>
          <AnimatePresence>{resultVisible ? <ResultSlot key="result" /> : null}</AnimatePresence>
        </div>
      )}
    </div>
  );
}
