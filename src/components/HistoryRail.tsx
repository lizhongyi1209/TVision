"use client";

import { motion } from "motion/react";
import { useCallback, useEffect } from "react";
import { useStudio } from "@/lib/store";
import { formatBytes } from "@/lib/utils";
import { Icon } from "./icons";
import type { HistoryItem } from "@/lib/types";

export function HistoryRail() {
  const history = useStudio((s) => s.history);
  const setHistory = useStudio((s) => s.setHistory);
  const close = useStudio((s) => s.toggleHistory);
  const useAsCanvas = useStudio((s) => s.useResultAsCanvas);
  const updateParams = useStudio((s) => s.updateParams);
  const showToast = useStudio((s) => s.showToast);

  const refresh = useCallback(async () => {
    try {
      const h = await fetch("/api/history").then((r) => r.json());
      setHistory(h.items || []);
    } catch {
      // ignore
    }
  }, [setHistory]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function pick(it: HistoryItem) {
    const apply = (w: number, h: number) => {
      useAsCanvas({ src: it.url, width: w, height: h });
      if (it.meta) {
        updateParams({
          prompt: it.meta.prompt,
          model: it.meta.model,
          resolution: it.meta.resolution,
          aspectRatio: it.meta.aspectRatio,
          billing: it.meta.billing,
          count: it.meta.count,
        });
        showToast("success", "已载入画布，并还原当时的提示词与参数");
      } else {
        showToast("success", "已载入画布");
      }
    };
    const img = new Image();
    img.onload = () => apply(img.naturalWidth, img.naturalHeight);
    img.onerror = () => apply(1024, 1024);
    img.src = it.url;
  }

  async function del(name: string) {
    try {
      await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      refresh();
    } catch {
      // ignore
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        onClick={close}
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="glass fixed inset-y-0 right-0 z-[101] flex w-[min(440px,100vw)] flex-col rounded-l-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="Stack" size={18} className="text-accent" />
            <span className="font-medium text-fg">历史生成</span>
            <span className="text-xs text-fg-mute">{history.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={refresh} className="text-fg-mute transition-colors hover:text-fg" title="刷新">
              <Icon name="ArrowClockwise" size={16} />
            </button>
            <button onClick={close} className="text-fg-mute transition-colors hover:text-fg" aria-label="关闭">
              <Icon name="X" size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {history.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-mute">
              <Icon name="ImageSquare" size={28} />
              <span className="text-sm">还没有生成记录</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {history.map((it) => (
                <div key={it.name} className="group relative overflow-hidden rounded-control border border-line">
                  <button onClick={() => pick(it)} className="block w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt={it.name} className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                  </button>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[10px] text-fg-dim opacity-0 transition group-hover:opacity-100">
                    <span>{formatBytes(it.size)}</span>
                  </div>
                  <button
                    onClick={() => del(it.name)}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-fg-dim opacity-0 backdrop-blur transition hover:text-red-300 group-hover:opacity-100"
                    title="删除"
                  >
                    <Icon name="Trash" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-line px-5 py-3 text-xs text-fg-mute">点击图片载入画布，同时还原当时的提示词与参数</div>
      </motion.aside>
    </>
  );
}
