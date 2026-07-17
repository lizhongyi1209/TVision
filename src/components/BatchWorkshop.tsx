"use client";

import { motion, useReducedMotion } from "motion/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { batchNouns, type BatchNouns } from "@/lib/batchPrompts";
import { type BatchCell, type BatchGarment, useBatchStore } from "@/lib/batchStore";
import { MAX_BATCH_GARMENTS, MAX_BATCH_MODELS } from "@/lib/limits";
import { useStudio } from "@/lib/store";
import { cn, downloadUrl, fakeProgressCurve, fileToDownscaledDataURL, packGrid, stripExt } from "@/lib/utils";
import { BatchSettingsPanel } from "./BatchBar";
import { Icon } from "./icons";

// 批量工坊主体：左侧持久参数，右侧在素材编排和结果矩阵之间切换。编排视图
// 使用主图横向资产区和素材自适应墙；矩阵按素材行、主图列展示组合结果。
// 生成引擎完全在 batchStore 的模块级循环里，本组件只读状态并派发动作。

/** 把一张批量结果送回单图创作画布并切换模式（D9 反向接力）。BatchLightbox
 *  的「设为画布」也复用这里 — 与 ResultView.setAsCanvas 相同的先量尺寸再落
 *  画布写法。 */
export function setBatchResultAsCanvas(resultUrl: string) {
  const img = new Image();
  img.onload = () => {
    const studio = useStudio.getState();
    studio.setImage({ src: resultUrl, width: img.naturalWidth, height: img.naturalHeight });
    studio.setWorkMode("single");
    studio.showToast("success", "已设为画布，可在单图创作继续编辑");
  };
  img.onerror = () => useStudio.getState().showToast("error", "读取结果图失败");
  img.src = resultUrl;
}

/** 批量结果的统一下载命名：换装类「服装名-模特N.png」，通用替换「素材名-主图N.png」
 *  —— 名词跟随当前类型（batchNouns）。 */
export function downloadCellResult(resultUrl: string, garmentName: string, modelIndex: number, wearTypeId?: string) {
  const n = batchNouns(wearTypeId ?? useBatchStore.getState().wearTypeId);
  downloadUrl(resultUrl, `${garmentName}-${n.base}${modelIndex + 1}.png`);
}

/** 运行中格子的展示进度（0-99 整数）：真实轮询进度与按 startedAt 走的假进度
 *  曲线取较大者（PLAN-BATCH T2 末条）。由 UI 层 500ms ticker 驱动重算，不写回
 *  store — 50 个格子每秒两次 set 会让所有订阅者陪跑。 */
function displayPct(cell: BatchCell): number {
  const fake = cell.startedAt ? fakeProgressCurve((Date.now() - cell.startedAt) / 1000) : 0;
  return Math.min(99, Math.round(Math.max(cell.progress * 100, fake)));
}

const HOVER_BTN =
  "flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-fg transition-colors hover:bg-black/75";

/** 悬停动作圆钮（对比/下载/重生成/…）—— 沿用 RefSlot compact 模式的黑底圆钮。 */
function HoverBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={HOVER_BTN}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

/** 格子的运行状态覆盖层，网格/矩阵两视图共用：等待「等待…」/ 运行中 百分比 /
 *  未成功 ⚠重生成。success 与 idle 由调用方自己渲染（两视图的底图来源不同）。 */
function CellStateLayer({
  cell,
  pct,
  small,
  onRetry,
}: {
  cell: BatchCell;
  pct: number;
  small: boolean;
  onRetry: () => void;
}) {
  if (cell.status === "waiting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
        <span className={cn("text-fg-dim", small ? "text-[10px]" : "text-xs")}>等待…</span>
      </div>
    );
  }
  if (cell.status === "running") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50">
        <span className={cn("font-medium text-fg", small ? "text-sm" : "text-xl")}>{pct}%</span>
        {small ? null : (
          <span className="h-0.5 w-3/5 max-w-[120px] overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
    );
  }
  if (cell.status === "failed") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/55">
        <button
          type="button"
          title={cell.error || "生成失败"}
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          className={cn(
            "flex items-center gap-1 rounded-full border border-amber-300/40 bg-black/50 text-amber-300 transition-colors hover:bg-black/70",
            small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
          )}
        >
          <Icon name="Warning" size={small ? 11 : 13} />
          重生成
        </button>
      </div>
    );
  }
  return null;
}

type BatchView = "compose" | "results";

export function BatchWorkshop() {
  const models = useBatchStore((s) => s.models);
  const garments = useBatchStore((s) => s.garments);
  const cells = useBatchStore((s) => s.cells);
  const runState = useBatchStore((s) => s.runState);
  const wearTypeId = useBatchStore((s) => s.wearTypeId);
  const addModels = useBatchStore((s) => s.addModels);
  const removeModel = useBatchStore((s) => s.removeModel);
  const replaceModel = useBatchStore((s) => s.replaceModel);
  const addGarments = useBatchStore((s) => s.addGarments);
  const removeGarment = useBatchStore((s) => s.removeGarment);
  const replaceGarment = useBatchStore((s) => s.replaceGarment);
  const clearGarments = useBatchStore((s) => s.clearGarments);
  const retryCell = useBatchStore((s) => s.retryCell);
  const openLightbox = useBatchStore((s) => s.openLightbox);
  const showToast = useStudio((s) => s.showToast);

  const locked = runState === "running";
  const [busy, setBusy] = useState(false);
  const busyCountRef = useRef(0);
  const nouns = batchNouns(wearTypeId);
  const resultNouns = batchNouns(cells[0]?.wearTypeId ?? wearTypeId);

  const beginBusy = useCallback(() => {
    busyCountRef.current += 1;
    setBusy(true);
  }, []);
  const endBusy = useCallback(() => {
    busyCountRef.current = Math.max(0, busyCountRef.current - 1);
    if (busyCountRef.current === 0) setBusy(false);
  }, []);

  const addModelInputRef = useRef<HTMLInputElement>(null);
  const replaceModelInputRef = useRef<HTMLInputElement>(null);
  const addGarmentInputRef = useRef<HTMLInputElement>(null);
  const replaceGarmentInputRef = useRef<HTMLInputElement>(null);
  const [replaceModelIndex, setReplaceModelIndex] = useState<number | null>(null);
  const [replaceGarmentIndex, setReplaceGarmentIndex] = useState<number | null>(null);
  const [view, setView] = useState<BatchView>(() => (cells.length ? "results" : "compose"));

  // 500ms 共享 ticker：仅当有格子在运行时开着，唯一作用是触发重渲，让每个
  // running 格重算 displayPct — 进度本身不进 store（见 displayPct 注释）。
  const hasRunning = cells.some((c) => c.status === "running");
  const [, bumpTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => bumpTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [hasRunning]);

  useEffect(() => {
    if (runState === "running") setView("results");
    else if (runState === "idle" && cells.length === 0) setView("compose");
  }, [runState, cells.length]);

  const guardLocked = useCallback(() => {
    if (!locked) return false;
    showToast("info", `批量进行中，暂不能修改${nouns.base}和${nouns.item}，可先停止`);
    return true;
  }, [locked, showToast, nouns.base, nouns.item]);

  const addModelFiles = useCallback(
    async (files: File[]) => {
      if (guardLocked()) return;
      const images = files.filter((f) => !f.type || f.type.startsWith("image/"));
      if (images.length < files.length) showToast("error", "请选择图片文件");
      if (!images.length) return;
      beginBusy();
      try {
        // 模特走 1800/0.94 —— 与单图主图的提交降采样惯例一致（GenerateBar.tsx）。
        const srcs = await Promise.all(images.map((f) => fileToDownscaledDataURL(f, 1800, 0.94).then((r) => r.dataUrl)));
        if (useBatchStore.getState().runState === "running") return;
        addModels(srcs);
      } catch {
        showToast("error", "读取图片失败");
      } finally {
        endBusy();
      }
    },
    [guardLocked, addModels, showToast, beginBusy, endBusy],
  );

  const addGarmentFiles = useCallback(
    async (files: File[]) => {
      if (guardLocked()) return;
      const images = files.filter((f) => !f.type || f.type.startsWith("image/"));
      if (images.length < files.length) showToast("error", "请选择图片文件");
      if (!images.length) return;
      beginBusy();
      try {
        // 服装走 1400/0.92 —— 与参考图的降采样惯例一致（RefSlot.tsx）。
        const items = await Promise.all(
          images.map((f, i) =>
            fileToDownscaledDataURL(f, 1400, 0.92).then(
              (r): BatchGarment => ({ src: r.dataUrl, name: stripExt(f.name) || `${nouns.item}${i + 1}` }),
            ),
          ),
        );
        if (useBatchStore.getState().runState === "running") return;
        addGarments(items);
      } catch {
        showToast("error", "读取图片失败");
      } finally {
        endBusy();
      }
    },
    [guardLocked, addGarments, showToast, nouns.item, beginBusy, endBusy],
  );

  async function handleReplaceModel(file: File | undefined | null) {
    const index = replaceModelIndex;
    setReplaceModelIndex(null);
    if (!file || index == null || guardLocked()) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "请选择图片文件");
      return;
    }
    beginBusy();
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1800, 0.94);
      if (useBatchStore.getState().runState === "running") return;
      replaceModel(index, dataUrl);
    } catch {
      showToast("error", "读取图片失败");
    } finally {
      endBusy();
    }
  }

  async function handleReplaceGarment(file: File | undefined | null) {
    const index = replaceGarmentIndex;
    setReplaceGarmentIndex(null);
    if (!file || index == null || guardLocked()) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "请选择图片文件");
      return;
    }
    beginBusy();
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1400, 0.92);
      if (useBatchStore.getState().runState === "running") return;
      replaceGarment(index, { src: dataUrl, name: stripExt(file.name) || nouns.item });
    } catch {
      showToast("error", "读取图片失败");
    } finally {
      endBusy();
    }
  }

  // 全局粘贴 → 加为服装（工坊挂载期间 Stage 未挂载，粘贴通道让给这里 —
  // PLAN-BATCH「现状事实」一节确认过的交接方式）。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (useBatchStore.getState().lightbox) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        void addGarmentFiles(files);
        e.preventDefault();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addGarmentFiles]);

  const cellMap = useMemo(
    () => new Map(cells.map((cell) => [`${cell.modelIndex}_${cell.garmentIndex}`, cell] as const)),
    [cells],
  );
  const cellOf = (mi: number, gi: number): BatchCell | undefined => cellMap.get(`${mi}_${gi}`);

  return (
    <div className="relative flex-1 overflow-hidden">
      <input
        ref={addModelInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addModelFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        ref={replaceModelInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handleReplaceModel(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={addGarmentInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addGarmentFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        ref={replaceGarmentInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handleReplaceGarment(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="absolute inset-0 flex flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <BatchSettingsPanel busy={busy} />

        <section className="flex min-h-[620px] min-w-0 flex-1 flex-col bg-ink lg:min-h-0">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 lg:px-5">
            <div>
              <div className="text-base font-medium text-fg">{view === "compose" ? "素材编排" : "结果矩阵"}</div>
              <div className="mt-0.5 text-xs text-fg-mute">
                {view === "compose"
                  ? `${nouns.base}与${nouns.item}分区管理，生成关系保持清晰`
                  : `按${nouns.base}与${nouns.item}组合查看生成状态和结果`}
              </div>
            </div>

            <div className="inline-flex gap-1 rounded-control border border-line bg-panel-2 p-1" role="group" aria-label="批量工坊视图">
              <button
                type="button"
                aria-pressed={view === "compose"}
                onClick={() => setView("compose")}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-xs transition-colors",
                  view === "compose" ? "bg-accent font-medium text-ink" : "text-fg-dim hover:text-fg",
                )}
              >
                <Icon name="ImageSquare" size={14} />
                编排视图
              </button>
              <button
                type="button"
                aria-pressed={view === "results"}
                onClick={() => setView("results")}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-xs transition-colors",
                  view === "results" ? "bg-accent font-medium text-ink" : "text-fg-dim hover:text-fg",
                )}
              >
                <Icon name="Stack" size={14} />
                结果矩阵
              </button>
            </div>
          </header>

          <div id="batch-workshop-panel" className="flex min-h-0 flex-1 overflow-hidden p-4 lg:p-5">
            {view === "compose" ? (
              <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4">
                <BaseStrip
                  models={models}
                  locked={locked || busy}
                  busy={busy}
                  nouns={nouns}
                  onDropFiles={(files) => void addModelFiles(files)}
                  onAdd={() => !guardLocked() && addModelInputRef.current?.click()}
                  onReplace={(i) => {
                    if (guardLocked()) return;
                    setReplaceModelIndex(i);
                    replaceModelInputRef.current?.click();
                  }}
                  onRemove={(i) => !guardLocked() && removeModel(i)}
                />
                <div className="flex min-h-0 flex-1 border-t border-line pt-4">
                  <GarmentWall
                    garments={garments}
                    locked={locked || busy}
                    busy={busy}
                    nouns={nouns}
                    onAdd={() => !guardLocked() && addGarmentInputRef.current?.click()}
                    onDropFiles={(files) => void addGarmentFiles(files)}
                    onReplace={(i) => {
                      if (guardLocked()) return;
                      setReplaceGarmentIndex(i);
                      replaceGarmentInputRef.current?.click();
                    }}
                    onRemove={(i) => !guardLocked() && removeGarment(i)}
                    onClear={() => !guardLocked() && clearGarments()}
                  />
                </div>
              </div>
            ) : models.length > 0 && garments.length > 0 && cells.length > 0 ? (
              <MatrixView
                models={models}
                garments={garments}
                locked={locked || busy}
                busy={busy}
                nouns={resultNouns}
                cellOf={cellOf}
                onAddModel={() => !guardLocked() && addModelInputRef.current?.click()}
                onReplaceModel={(i) => {
                  if (guardLocked()) return;
                  setReplaceModelIndex(i);
                  replaceModelInputRef.current?.click();
                }}
                onRemoveModel={(i) => !guardLocked() && removeModel(i)}
                onAddGarment={() => !guardLocked() && addGarmentInputRef.current?.click()}
                onReplaceGarment={(i) => {
                  if (guardLocked()) return;
                  setReplaceGarmentIndex(i);
                  replaceGarmentInputRef.current?.click();
                }}
                onRemoveGarment={(i) => !guardLocked() && removeGarment(i)}
                onRetry={(mi, gi) => {
                  if (!busy) retryCell(mi, gi);
                }}
                onOpen={(mi, gi) => {
                  if (!busy) openLightbox(mi, gi);
                }}
              />
            ) : (
              <div className="flex h-full min-h-[360px] min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-control border border-dashed border-line-2 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-control border border-line bg-panel-2 text-fg-dim">
                  <Icon name="Stack" size={20} />
                </span>
                <div>
                  <div className="text-sm font-medium text-fg">暂无组合结果</div>
                  <div className="mt-1 text-xs text-fg-mute">先在编排视图添加{nouns.base}和{nouns.item}</div>
                </div>
                <button type="button" onClick={() => setView("compose")} className="text-xs text-accent hover:text-accent-2">
                  返回编排视图
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── 编排视图 · 主图横向资产区 ────────────────────────────────────────────────
function BaseStrip({
  models,
  locked,
  busy,
  nouns,
  onDropFiles,
  onAdd,
  onReplace,
  onRemove,
}: {
  models: string[];
  locked: boolean;
  busy: boolean;
  nouns: BatchNouns;
  onDropFiles: (files: File[]) => void;
  onAdd: () => void;
  onReplace: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const [drag, setDrag] = useState(false);
  const canAdd = !locked && models.length < MAX_BATCH_MODELS;

  return (
    <section
      className="shrink-0"
      onDragOver={(e) => {
        e.preventDefault();
        if (locked) return;
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        if (locked) return;
        onDropFiles(Array.from(e.dataTransfer?.files || []));
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg">
          {nouns.base} <span className="font-normal text-fg-mute">{models.length} / {MAX_BATCH_MODELS}</span>
        </div>
        {canAdd && models.length ? (
          <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs text-fg-dim transition-colors hover:text-fg">
            <Icon name="Plus" size={13} />
            添加{nouns.base}
          </button>
        ) : null}
      </div>

      {models.length === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className={cn(
            "flex h-[150px] w-full flex-col items-center justify-center gap-2 rounded-control border border-dashed transition-all duration-300",
            drag ? "border-accent bg-accent/5" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
          )}
        >
          <Icon name={busy ? "CircleNotch" : "ImageSquare"} size={22} className={busy ? "animate-spin text-accent" : "text-fg-dim"} />
          <span className="text-sm font-medium text-fg">添加{nouns.base}</span>
          <span className="text-xs text-fg-mute">点击选择或拖入图片</span>
        </button>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {models.map((model, index) => (
            <div key={index} className="group relative w-[132px] shrink-0 overflow-hidden rounded-control border border-line bg-panel-2/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={model} alt={`${nouns.base} ${index + 1}`} className="block h-[136px] w-full object-contain" />
              <div className="border-t border-line px-2.5 py-2 text-xs">
                <span className="truncate text-fg">{nouns.base} {String(index + 1).padStart(2, "0")}</span>
              </div>
              {locked ? null : (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:inset-auto [@media(hover:none)]:right-1 [@media(hover:none)]:top-1 [@media(hover:none)]:rounded-full [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100 [@media(hover:none)]:backdrop-blur-none">
                  <HoverBtn icon="ArrowClockwise" label="更换" onClick={() => onReplace(index)} />
                  <HoverBtn icon="X" label="删除" onClick={() => onRemove(index)} />
                </div>
              )}
            </div>
          ))}
          {canAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className={cn(
                "flex min-h-[176px] w-[132px] shrink-0 flex-col items-center justify-center gap-2 rounded-control border border-dashed text-fg-mute transition-colors",
                drag ? "border-accent bg-accent/5 text-accent" : "border-line-2 hover:border-fg-mute hover:text-fg",
              )}
            >
              <Icon name={busy ? "CircleNotch" : "Plus"} size={18} className={busy ? "animate-spin" : undefined} />
              <span className="text-xs">添加{nouns.base}</span>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

// ── 网格视图 · 服装墙（全部同屏，永不滚动）──────────────────────────────────
function GarmentWall({
  garments,
  locked,
  busy,
  nouns,
  onAdd,
  onDropFiles,
  onReplace,
  onRemove,
  onClear,
}: {
  garments: BatchGarment[];
  locked: boolean;
  busy: boolean;
  nouns: BatchNouns;
  onAdd: () => void;
  onDropFiles: (files: File[]) => void;
  onReplace: (gi: number) => void;
  onRemove: (gi: number) => void;
  onClear: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState(false);

  // ResizeObserver 量出墙的可用区域，喂给 packGrid 得到「全部同屏」的列数与
  // 格子尺寸（D6）。窗口缩放/诊断台开合等任何布局变化都会自动重排。
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showAdd = !locked && garments.length < MAX_BATCH_GARMENTS;
  const n = garments.length + (showAdd ? 1 : 0);
  const { cols, cellW, cellH } = packGrid(n, box.w, box.h, 8);
  const small = Math.min(cellW, cellH) < 120;

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-2"
      onDragOver={(e) => {
        e.preventDefault();
        if (locked || busy) return;
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        if (locked || busy) return;
        onDropFiles(Array.from(e.dataTransfer?.files || []));
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg">
          {nouns.item} <span className="font-normal text-fg-mute">{garments.length} / {MAX_BATCH_GARMENTS}</span>
        </div>
        {locked || !garments.length ? null : (
          <div className="flex items-center gap-3">
            <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs text-fg-dim transition-colors hover:text-fg">
              <Icon name="Plus" size={13} />
              批量添加
            </button>
            <button type="button" onClick={onClear} className="flex items-center gap-1 text-xs text-fg-mute transition-colors hover:text-fg">
              <Icon name="Trash" size={13} />
              清空
            </button>
          </div>
        )}
        {busy ? <Icon name="CircleNotch" size={14} className="animate-spin text-accent" /> : null}
      </div>

      <div ref={boxRef} className="relative min-h-0 flex-1">
        {garments.length === 0 ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={locked || busy}
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-control border border-dashed transition-all duration-300",
              drag ? "border-accent bg-accent/[0.06]" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
            )}
          >
            <span
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-control border border-line bg-white/[0.03]",
                drag ? "text-accent" : "text-fg-dim",
              )}
            >
              <Icon name={busy ? "CircleNotch" : nouns.icon} size={22} className={busy ? "animate-spin text-accent" : undefined} />
            </span>
            <div className="text-center">
              <div className="text-base font-medium text-fg">
                {busy ? "正在读取…" : `拖入或点击添加${nouns.item} · 支持一次 ${MAX_BATCH_GARMENTS} 张`}
              </div>
              <div className="mt-1 text-xs text-fg-mute">支持拖拽、点击选择和直接粘贴</div>
            </div>
          </button>
        ) : cellW > 0 && cellH > 0 ? (
          <div className="flex h-full w-full items-start justify-center">
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${cols}, ${cellW}px)`, gridAutoRows: `${cellH}px`, gap: 8 }}
            >
              {garments.map((g, gi) => (
                <GarmentTile
                  key={gi}
                  garment={g}
                  locked={locked}
                  onReplace={() => onReplace(gi)}
                  onRemove={() => onRemove(gi)}
                />
              ))}
              {showAdd ? (
                <button
                  type="button"
                  onClick={onAdd}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-control border border-dashed transition-all duration-200",
                    drag ? "border-accent bg-accent/5" : "border-line-2 text-fg-dim hover:border-fg-mute hover:bg-white/[0.02]",
                  )}
                >
                  <Icon name="Plus" size={small ? 14 : 18} />
                  {small ? null : <span className="text-[11px] text-fg-mute">添加{nouns.item}</span>}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── 编排视图 · 单个素材格 ──────────────────────────────────────────────────
function GarmentTile({
  garment,
  locked,
  onReplace,
  onRemove,
}: {
  garment: BatchGarment;
  locked: boolean;
  onReplace: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative flex items-center justify-center overflow-hidden rounded-control border border-line bg-panel-2/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={garment.src} alt={garment.name} className="max-h-full max-w-full object-contain" />
      <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded bg-black/50 px-1.5 py-0.5 text-center text-[10px] leading-tight text-fg backdrop-blur-sm">
        {garment.name}
      </span>
      {!locked ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:inset-auto [@media(hover:none)]:right-1 [@media(hover:none)]:top-1 [@media(hover:none)]:rounded-full [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100 [@media(hover:none)]:backdrop-blur-none">
          <HoverBtn icon="ArrowClockwise" label="更换" onClick={onReplace} />
          <HoverBtn icon="X" label="删除" onClick={onRemove} />
        </div>
      ) : null}
    </div>
  );
}

// ── 结果矩阵：行=素材、列=主图，行列头吸附，超屏双轴滚动 ───────────────────
const MATRIX_HEADER_BG = "bg-[#141416]"; // 吸附行列头必须实底色，滚动时不透出下层格子

function MatrixView({
  models,
  garments,
  locked,
  busy,
  nouns,
  cellOf,
  onAddModel,
  onReplaceModel,
  onRemoveModel,
  onAddGarment,
  onReplaceGarment,
  onRemoveGarment,
  onRetry,
  onOpen,
}: {
  models: string[];
  garments: BatchGarment[];
  locked: boolean;
  busy: boolean;
  nouns: BatchNouns;
  cellOf: (mi: number, gi: number) => BatchCell | undefined;
  onAddModel: () => void;
  onReplaceModel: (mi: number) => void;
  onRemoveModel: (mi: number) => void;
  onAddGarment: () => void;
  onReplaceGarment: (gi: number) => void;
  onRemoveGarment: (gi: number) => void;
  onRetry: (mi: number, gi: number) => void;
  onOpen: (mi: number, gi: number) => void;
}) {
  const retryCell = useBatchStore((s) => s.retryCell);
  const reduceMotion = useReducedMotion();
  const canAddModel = !locked && models.length < MAX_BATCH_MODELS;
  const canAddGarment = !locked && garments.length < MAX_BATCH_GARMENTS;

  function retryRow(gi: number) {
    if (locked || busy) return;
    for (let mi = 0; mi < models.length; mi++) {
      const c = cellOf(mi, gi);
      if (c && (c.status === "failed" || c.status === "success")) retryCell(mi, gi);
    }
  }
  function downloadRow(gi: number) {
    const g = garments[gi];
    for (let mi = 0; mi < models.length; mi++) {
      const c = cellOf(mi, gi);
      if (c?.status === "success" && c.resultUrl) downloadCellResult(c.resultUrl, g.name, mi, c.wearTypeId);
    }
  }

  return (
    <div
      className="min-h-0 min-w-0 flex-1 overflow-auto rounded-panel border border-line focus-visible:border-accent focus-visible:outline-none"
      role="region"
      aria-label="批量生成结果矩阵"
      tabIndex={0}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `132px repeat(${models.length}, minmax(176px, 240px))${canAddModel ? " 68px" : ""}`,
          width: "max-content",
          minWidth: "100%",
        }}
      >
        {/* 表头行：左上角 + 底图列头（sticky top）+ 添加入口 */}
        <div
          className={cn(
            "sticky left-0 top-0 z-30 flex items-end border-b border-r border-line px-3 py-2 text-[11px] text-fg-mute",
            MATRIX_HEADER_BG,
          )}
        >
          {nouns.item} ＼ {nouns.base}
        </div>
        {models.map((m, mi) => (
          <div key={mi} className={cn("group sticky top-0 z-20 border-b border-line p-2", MATRIX_HEADER_BG)}>
            <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-control border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m} alt={`${nouns.base} ${mi + 1}`} className="block h-24 max-w-full object-contain" />
              <span className="absolute left-1 top-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-fg backdrop-blur-sm">
                {nouns.base} {mi + 1}
              </span>
              {locked ? null : (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 bg-black/45 opacity-0 transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:inset-auto [@media(hover:none)]:right-1 [@media(hover:none)]:top-1 [@media(hover:none)]:rounded-full [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100">
                  <HoverBtn icon="ArrowClockwise" label="更换" onClick={() => onReplaceModel(mi)} />
                  <HoverBtn icon="X" label="删除" onClick={() => onRemoveModel(mi)} />
                </div>
              )}
            </div>
          </div>
        ))}
        {canAddModel ? (
          <div className={cn("sticky top-0 z-20 border-b border-line p-2", MATRIX_HEADER_BG)}>
            <button
              type="button"
              onClick={onAddModel}
              className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-control border border-dashed border-line-2 text-fg-dim transition-colors hover:border-fg-mute hover:text-fg"
            >
              <Icon name={busy ? "CircleNotch" : "Plus"} size={14} className={busy ? "animate-spin text-accent" : undefined} />
              <span className="text-[10px]">{nouns.base}</span>
            </button>
          </div>
        ) : null}

        {/* 数据行：行头（sticky left）+ M 个格子 */}
        {garments.map((g, gi) => (
          <Fragment key={gi}>
            <div className={cn("group sticky left-0 z-10 border-b border-r border-line p-2", MATRIX_HEADER_BG)}>
              <div className="relative w-fit max-w-full overflow-hidden rounded-control border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.src} alt={g.name} className="block h-24 max-w-full object-contain" />
                <div className="pointer-events-none absolute inset-0 flex flex-wrap items-center justify-center gap-1 bg-black/45 p-1 opacity-0 transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:inset-auto [@media(hover:none)]:right-1 [@media(hover:none)]:top-1 [@media(hover:none)]:max-w-[68px] [@media(hover:none)]:rounded-control [@media(hover:none)]:bg-black/25 [@media(hover:none)]:opacity-100 [@media(hover:none)]:backdrop-blur-sm">
                  {locked ? null : <HoverBtn icon="ArrowClockwise" label="整行重生成" onClick={() => retryRow(gi)} />}
                  <HoverBtn icon="DownloadSimple" label="下载整行" onClick={() => downloadRow(gi)} />
                  {locked ? null : (
                    <>
                      <HoverBtn icon="UploadSimple" label="更换" onClick={() => onReplaceGarment(gi)} />
                      <HoverBtn icon="X" label="删除" onClick={() => onRemoveGarment(gi)} />
                    </>
                  )}
                </div>
              </div>
              <div className="mt-1 truncate text-center text-[10px] text-fg-mute" title={g.name}>
                {g.name}
              </div>
            </div>
            {models.map((_, mi) => {
              const cell = cellOf(mi, gi);
              const success = cell?.status === "success" && !!cell.resultUrl;
              const cellNouns = cell ? batchNouns(cell.wearTypeId) : nouns;
              return (
                <div key={mi} className="border-b border-line p-2">
                  <div
                    className={cn(
                      "group relative flex h-40 items-center justify-center overflow-hidden rounded-control border bg-panel-2/40",
                      success ? "border-line hover:border-line-2 group-focus-within:border-accent" : "border-line/60",
                    )}
                  >
                    {success ? (
                      <button
                        type="button"
                        aria-label={`查看 ${g.name} 与${cellNouns.base}${mi + 1}的生成结果`}
                        onClick={() => onOpen(mi, gi)}
                        disabled={busy}
                        className="absolute inset-0 flex cursor-zoom-in items-center justify-center focus:outline-none disabled:cursor-default"
                      >
                        <motion.img
                          key={cell.resultUrl}
                          initial={reduceMotion ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: reduceMotion ? 0 : 0.35 }}
                          src={cell.resultUrl}
                          alt={`${g.name} × ${cellNouns.base}${mi + 1}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      </button>
                    ) : cell ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.src} alt="" aria-hidden className="max-h-full max-w-full object-contain opacity-25" />
                    ) : (
                      <span className="text-[10px] text-fg-mute">-</span>
                    )}
                    {cell ? (
                      <CellStateLayer cell={cell} pct={displayPct(cell)} small onRetry={() => onRetry(mi, gi)} />
                    ) : null}
                    {success && !busy ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:inset-auto [@media(hover:none)]:right-1 [@media(hover:none)]:top-1 [@media(hover:none)]:rounded-full [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100 [@media(hover:none)]:backdrop-blur-none">
                        <HoverBtn icon="ArrowsLeftRight" label="对比" onClick={() => onOpen(mi, gi)} />
                        {locked ? null : <HoverBtn icon="ArrowClockwise" label="重生成" onClick={() => onRetry(mi, gi)} />}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {canAddModel ? <div className="border-b border-line" /> : null}
          </Fragment>
        ))}

        {/* 添加行 */}
        {canAddGarment ? (
          <>
            <div className={cn("sticky left-0 z-10 border-r border-line p-2", MATRIX_HEADER_BG)}>
              <button
                type="button"
                onClick={onAddGarment}
                className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-control border border-dashed border-line-2 text-fg-dim transition-colors hover:border-fg-mute hover:text-fg"
              >
                <Icon name={busy ? "CircleNotch" : "Plus"} size={14} className={busy ? "animate-spin text-accent" : undefined} />
                <span className="text-[10px]">{nouns.item}</span>
              </button>
            </div>
            {models.map((_, mi) => (
              <div key={mi} />
            ))}
            {canAddModel ? <div /> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
