"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { getAction } from "@/lib/actions";
import { useStudio } from "@/lib/store";
import { cn, fileToDownscaledDataURL } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

// Glass upload card that pops up after choosing an action that needs a reference
// image ("上传你想换上的上衣" etc.). Centered over a dim backdrop.
export function UploadPopover() {
  const open = useStudio((s) => s.uploadOpen);
  const actionId = useStudio((s) => s.activeActionId);
  const setRef = useStudio((s) => s.setRef);
  const closeUpload = useStudio((s) => s.closeUpload);
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

  return (
    <AnimatePresence>
      {open && action ? (
        <>
          <motion.div
            key="bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closeUpload}
          />
          <motion.div
            key="card"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="glass absolute left-1/2 top-1/2 z-50 w-[min(440px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-panel p-5"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-fg">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-accent">
                    <Icon name={action.icon} size={15} weight="bold" />
                  </span>
                  <span className="font-medium">{action.label}</span>
                </div>
                <div className="mt-1.5 text-sm text-fg-dim">{action.refLabel}</div>
              </div>
              <button onClick={closeUpload} className="text-fg-mute transition-colors hover:text-fg" aria-label="关闭">
                <Icon name="X" size={18} />
              </button>
            </div>

            <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handle(e.target.files?.[0])} />
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
                "flex w-full flex-col items-center justify-center gap-3 rounded-control border border-dashed py-10 transition-all duration-200",
                drag ? "border-accent bg-accent/5" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
              )}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-fg-dim">
                <Icon
                  name={busy ? "CircleNotch" : "UploadSimple"}
                  size={22}
                  className={busy ? "animate-spin text-accent" : undefined}
                />
              </span>
              <span className="text-sm text-fg">{busy ? "正在处理…" : "点击或拖入图片"}</span>
              {action.refHint ? <span className="text-xs text-fg-mute">{action.refHint}</span> : null}
            </button>

            <div className="mt-4 flex items-center justify-between">
              <Button variant="subtle" onClick={cancelAction}>
                取消操作
              </Button>
              <span className="text-xs text-fg-mute">自动压缩到 20MB 以内</span>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
