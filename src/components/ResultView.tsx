"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useStudio } from "@/lib/store";
import { cn, downloadUrl } from "@/lib/utils";
import { CompareSlider } from "./CompareSlider";
import { Icon } from "./icons";
import { Button, IconButton } from "./ui";

export function ResultView() {
  const phase = useStudio((s) => s.phase);
  const results = useStudio((s) => s.results);
  const image = useStudio((s) => s.image);
  const dismiss = useStudio((s) => s.dismissResults);
  const useAsCanvas = useStudio((s) => s.useResultAsCanvas);
  const showToast = useStudio((s) => s.showToast);

  const [sel, setSel] = useState(0);
  const [compare, setCompare] = useState(true);

  useEffect(() => {
    setSel(0);
    setCompare(true);
  }, [results]);

  const open = phase === "success" && !!results && results.length > 0 && !!image;
  const current = results && results[sel] ? results[sel] : null;

  function setAsCanvas() {
    if (!current) return;
    const img = new Image();
    img.onload = () => {
      useAsCanvas({ src: current, width: img.naturalWidth, height: img.naturalHeight });
      showToast("success", "已设为画布，可继续编辑");
    };
    img.onerror = () => useAsCanvas({ src: current, width: image?.width ?? 1024, height: image?.height ?? 1024 });
    img.src = current;
  }

  function download(url: string, i: number) {
    downloadUrl(url, `tvision-${Date.now()}-${i + 1}.png`);
  }

  return (
    <AnimatePresence>
      {open && results && image ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[90] flex items-center justify-center p-4 sm:p-8"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={dismiss} />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="glass relative flex max-h-full w-[min(1040px,96vw)] flex-col overflow-hidden rounded-panel"
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Icon name="Check" size={15} weight="bold" />
                </span>
                <div>
                  <div className="text-sm font-medium text-fg">生成完成</div>
                  <div className="text-xs text-fg-mute">{results.length} 张结果</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {results.length === 1 ? (
                  <IconButton
                    name={compare ? "FrameCorners" : "ArrowsOutSimple"}
                    label={compare ? "查看单图" : "前后对比"}
                    onClick={() => setCompare((c) => !c)}
                  />
                ) : null}
                <IconButton name="X" label="关闭" onClick={dismiss} />
              </div>
            </div>

            {/* main */}
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black/30 p-4">
              {current ? (
                compare ? (
                  <CompareSlider before={image.src} after={current} className="h-[58vh] w-full bg-black/20" />
                ) : (
                  <motion.img
                    key={current}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    src={current}
                    alt="生成结果"
                    className="max-h-[58vh] max-w-full rounded-panel object-contain"
                  />
                )
              ) : null}
            </div>

            {/* filmstrip */}
            {results.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto border-t border-line px-4 py-3">
                {results.map((r, i) => (
                  <button
                    key={r}
                    onClick={() => {
                      setSel(i);
                      setCompare(false);
                    }}
                    className={cn(
                      "h-16 w-16 shrink-0 overflow-hidden rounded-control border transition-all",
                      i === sel ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-2",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r} alt={`结果 ${i + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}

            {/* footer actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3.5">
              <Button variant="subtle" onClick={dismiss}>
                <Icon name="ArrowClockwise" size={15} />
                再生成
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={setAsCanvas}>
                  <Icon name="ImageSquare" size={15} />
                  设为画布
                </Button>
                {results.length > 1 ? (
                  <Button variant="ghost" onClick={() => results.forEach((r, i) => download(r, i))}>
                    <Icon name="DownloadSimple" size={15} />
                    下载全部
                  </Button>
                ) : null}
                <Button variant="primary" onClick={() => current && download(current, sel)}>
                  <Icon name="DownloadSimple" size={15} weight="bold" />
                  下载
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
