"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { batchNouns } from "@/lib/batchPrompts";
import { useBatchStore } from "@/lib/batchStore";
import { CompareSlider } from "./CompareSlider";
import { downloadCellResult, setBatchResultAsCanvas } from "./BatchWorkshop";
import { Icon } from "./icons";
import { Button, IconButton } from "./ui";

// 批量结果对比弹框（PLAN-BATCH T6）：复用 ResultView 的玻璃弹框壳 +
// CompareSlider（before=对应模特原图、after=结果），左下角服装缩略角标；
// success 格之间 ←/→ 翻页、Esc/遮罩关闭。开关状态在 batchStore.lightbox。

export function BatchLightbox() {
  const lightbox = useBatchStore((s) => s.lightbox);
  const cells = useBatchStore((s) => s.cells);
  const models = useBatchStore((s) => s.models);
  const garments = useBatchStore((s) => s.garments);
  const wearTypeId = useBatchStore((s) => s.wearTypeId);
  const openLightbox = useBatchStore((s) => s.openLightbox);
  const closeLightbox = useBatchStore((s) => s.closeLightbox);
  const retryCell = useBatchStore((s) => s.retryCell);

  const cell = lightbox
    ? cells.find((c) => c.modelIndex === lightbox.modelIndex && c.garmentIndex === lightbox.garmentIndex)
    : null;
  const nouns = batchNouns(cell?.wearTypeId ?? wearTypeId);
  const model = cell ? models[cell.modelIndex] : null;
  const garment = cell ? garments[cell.garmentIndex] : null;
  const open = !!cell?.resultUrl && !!model && !!garment;

  // 翻页顺序 = cells 的建格顺序（服装序优先），只在 success 格之间跳。
  const successCells = cells.filter((c) => c.status === "success" && !!c.resultUrl);
  const currentIdx = cell ? successCells.findIndex((c) => c.modelIndex === cell.modelIndex && c.garmentIndex === cell.garmentIndex) : -1;

  function step(dir: -1 | 1) {
    if (currentIdx < 0) return;
    const next = successCells[currentIdx + dir];
    if (next) openLightbox(next.modelIndex, next.garmentIndex);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentIdx]);

  function regenerate() {
    if (!cell) return;
    retryCell(cell.modelIndex, cell.garmentIndex);
    closeLightbox();
  }

  return (
    <AnimatePresence>
      {open && cell && model && garment ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[90] flex items-center justify-center p-4 sm:p-8"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={closeLightbox} />

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
                  <Icon name={nouns.icon} size={15} weight="bold" />
                </span>
                <div>
                  <div className="text-sm font-medium text-fg">
                    {garment.name} · {nouns.base} {cell.modelIndex + 1}
                  </div>
                  {successCells.length > 1 ? (
                    <div className="text-xs text-fg-mute">
                      第 {currentIdx + 1} / {successCells.length} 张
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {successCells.length > 1 ? (
                  <>
                    <IconButton name="CaretLeft" label="上一张（←）" onClick={() => step(-1)} className={currentIdx <= 0 ? "opacity-30" : undefined} />
                    <IconButton
                      name="CaretRight"
                      label="下一张（→）"
                      onClick={() => step(1)}
                      className={currentIdx >= successCells.length - 1 ? "opacity-30" : undefined}
                    />
                  </>
                ) : null}
                <IconButton name="X" label="关闭" onClick={closeLightbox} />
              </div>
            </div>

            {/* main：前后对比 + 服装缩略角标 */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/30 p-4">
              <CompareSlider before={model} after={cell.resultUrl!} className="h-[58vh] w-full bg-black/20" />
              <div className="pointer-events-none absolute bottom-6 left-6 flex items-end gap-2">
                <span className="overflow-hidden rounded-control border border-line bg-black/60 backdrop-blur-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={garment.src} alt={garment.name} className="block h-16 max-w-[96px] object-contain" />
                </span>
                <span className="max-w-[200px] truncate rounded-full bg-black/60 px-2.5 py-1 text-xs text-fg backdrop-blur-sm">
                  {garment.name}
                </span>
              </div>
            </div>

            {/* footer actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3.5">
              <Button variant="subtle" onClick={regenerate}>
                <Icon name="ArrowClockwise" size={15} />
                重生成
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBatchResultAsCanvas(cell.resultUrl!);
                    closeLightbox();
                  }}
                >
                  <Icon name="ImageSquare" size={15} />
                  设为画布
                </Button>
                <Button variant="primary" onClick={() => downloadCellResult(cell.resultUrl!, garment.name, cell.modelIndex, cell.wearTypeId)}>
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
