"use client";

import { motion } from "motion/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { batchNouns, type BatchNouns } from "@/lib/batchPrompts";
import { type BatchCell, type BatchGarment, useBatchStore } from "@/lib/batchStore";
import { MAX_BATCH_GARMENTS, MAX_BATCH_MODELS } from "@/lib/limits";
import { useStudio } from "@/lib/store";
import { cn, downloadUrl, fakeProgressCurve, fileToDownscaledDataURL, packGrid, stripExt } from "@/lib/utils";
import { Icon } from "./icons";

// 批量工坊主体（PLAN-BATCH T4）：模特栏 + 服装墙。1 位模特渲染网格视图（服装墙
// 全部同屏、永不滚动 — D6 的 packGrid 自适应打包），≥2 位自动切全匹配矩阵
// （行=服装、列=模特，超屏纵向滚动、行列头吸附）。生成引擎完全在 batchStore
// 的模块级循环里，本组件只读状态 + 派发动作，卸载不影响运行中的批量。

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
export function downloadCellResult(resultUrl: string, garmentName: string, modelIndex: number) {
  const n = batchNouns(useBatchStore.getState().wearTypeId);
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
  const nouns = batchNouns(wearTypeId);

  const addModelInputRef = useRef<HTMLInputElement>(null);
  const replaceModelInputRef = useRef<HTMLInputElement>(null);
  const addGarmentInputRef = useRef<HTMLInputElement>(null);
  const replaceGarmentInputRef = useRef<HTMLInputElement>(null);
  const [replaceModelIndex, setReplaceModelIndex] = useState<number | null>(null);
  const [replaceGarmentIndex, setReplaceGarmentIndex] = useState<number | null>(null);

  // 500ms 共享 ticker：仅当有格子在运行时开着，唯一作用是触发重渲，让每个
  // running 格重算 displayPct — 进度本身不进 store（见 displayPct 注释）。
  const hasRunning = cells.some((c) => c.status === "running");
  const [, bumpTick] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => bumpTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [hasRunning]);

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
      setBusy(true);
      try {
        // 模特走 1800/0.94 —— 与单图主图的提交降采样惯例一致（GenerateBar.tsx）。
        const srcs = await Promise.all(images.map((f) => fileToDownscaledDataURL(f, 1800, 0.94).then((r) => r.dataUrl)));
        addModels(srcs);
      } catch {
        showToast("error", "读取图片失败");
      } finally {
        setBusy(false);
      }
    },
    [guardLocked, addModels, showToast],
  );

  const addGarmentFiles = useCallback(
    async (files: File[]) => {
      if (guardLocked()) return;
      const images = files.filter((f) => !f.type || f.type.startsWith("image/"));
      if (images.length < files.length) showToast("error", "请选择图片文件");
      if (!images.length) return;
      setBusy(true);
      try {
        // 服装走 1400/0.92 —— 与参考图的降采样惯例一致（RefSlot.tsx）。
        const items = await Promise.all(
          images.map((f, i) =>
            fileToDownscaledDataURL(f, 1400, 0.92).then(
              (r): BatchGarment => ({ src: r.dataUrl, name: stripExt(f.name) || `${nouns.item}${i + 1}` }),
            ),
          ),
        );
        addGarments(items);
      } catch {
        showToast("error", "读取图片失败");
      } finally {
        setBusy(false);
      }
    },
    [guardLocked, addGarments, showToast, nouns.item],
  );

  async function handleReplaceModel(file: File | undefined | null) {
    const index = replaceModelIndex;
    setReplaceModelIndex(null);
    if (!file || index == null || guardLocked()) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "请选择图片文件");
      return;
    }
    setBusy(true);
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1800, 0.94);
      replaceModel(index, dataUrl);
    } catch {
      showToast("error", "读取图片失败");
    } finally {
      setBusy(false);
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
    setBusy(true);
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1400, 0.92);
      replaceGarment(index, { src: dataUrl, name: stripExt(file.name) || nouns.item });
    } catch {
      showToast("error", "读取图片失败");
    } finally {
      setBusy(false);
    }
  }

  // 全局粘贴 → 加为服装（工坊挂载期间 Stage 未挂载，粘贴通道让给这里 —
  // PLAN-BATCH「现状事实」一节确认过的交接方式）。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
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

  const cellOf = (mi: number, gi: number): BatchCell | undefined =>
    cells.find((c) => c.modelIndex === mi && c.garmentIndex === gi);

  const matrix = models.length >= 2;

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(58% 52% at 50% 42%, rgba(230,178,119,0.05), transparent 70%)" }}
      />
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

      <div className="absolute inset-0 flex gap-4 px-6 pb-[224px] pt-5">
        {matrix ? (
          <MatrixView
            models={models}
            garments={garments}
            locked={locked}
            busy={busy}
            nouns={nouns}
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
            onRetry={retryCell}
            onOpen={openLightbox}
          />
        ) : (
          <>
            <ModelRail
              model={models[0]}
              locked={locked}
              busy={busy}
              nouns={nouns}
              onDropFiles={(files) => void addModelFiles(files)}
              onAdd={() => !guardLocked() && addModelInputRef.current?.click()}
              onReplace={() => {
                if (guardLocked()) return;
                setReplaceModelIndex(0);
                replaceModelInputRef.current?.click();
              }}
              onRemove={() => !guardLocked() && removeModel(0)}
            />
            <GarmentWall
              garments={garments}
              locked={locked}
              busy={busy}
              nouns={nouns}
              cellOf={(gi) => cellOf(0, gi)}
              onAdd={() => !guardLocked() && addGarmentInputRef.current?.click()}
              onDropFiles={(files) => void addGarmentFiles(files)}
              onReplace={(i) => {
                if (guardLocked()) return;
                setReplaceGarmentIndex(i);
                replaceGarmentInputRef.current?.click();
              }}
              onRemove={(i) => !guardLocked() && removeGarment(i)}
              onClear={() => !guardLocked() && clearGarments()}
              onRetry={(gi) => retryCell(0, gi)}
              onOpen={(gi) => openLightbox(0, gi)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── 网格视图 · 模特栏（1 位模特）────────────────────────────────────────────
function ModelRail({
  model,
  locked,
  busy,
  nouns,
  onDropFiles,
  onAdd,
  onReplace,
  onRemove,
}: {
  model: string | undefined;
  locked: boolean;
  busy: boolean;
  nouns: BatchNouns;
  onDropFiles: (files: File[]) => void;
  onAdd: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex w-[210px] shrink-0 flex-col gap-3">
      <div className="text-xs font-medium tracking-wide text-fg-mute">{nouns.base}</div>

      {model ? (
        <div className="group relative w-fit max-w-full overflow-hidden rounded-panel border border-line bg-panel-2 shadow-[0_10px_34px_-12px_rgba(0,0,0,0.5)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={model} alt={`${nouns.base} 1`} className="block max-h-[46vh] max-w-full object-contain" />
          <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-fg backdrop-blur-sm">
            {nouns.base} 1
          </span>
          {locked ? null : (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
              <HoverBtn icon="ArrowClockwise" label="更换" onClick={onReplace} />
              <HoverBtn icon="X" label="删除" onClick={onRemove} />
            </div>
          )}
        </div>
      ) : null}

      {locked ? null : (
        <button
          type="button"
          onClick={onAdd}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            // 模特栏与服装墙各收各的拖放（不互相冒泡）—— RefSlot 的挡冒泡惯例。
            e.preventDefault();
            e.stopPropagation();
            setDrag(false);
            onDropFiles(Array.from(e.dataTransfer?.files || []));
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed py-6 transition-all duration-300",
            drag ? "border-accent bg-accent/5" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
          )}
        >
          <Icon name={busy ? "CircleNotch" : "Plus"} size={16} className={busy ? "animate-spin text-accent" : "text-fg-dim"} />
          <span className="text-xs text-fg-mute">{model ? `添加${nouns.base}` : `添加${nouns.base}（点击或拖入）`}</span>
          {model ? <span className="text-[10px] text-fg-mute">{`加第 2 ${nouns.baseUnit}即变全匹配`}</span> : null}
        </button>
      )}
    </div>
  );
}

// ── 网格视图 · 服装墙（全部同屏，永不滚动）──────────────────────────────────
function GarmentWall({
  garments,
  locked,
  busy,
  nouns,
  cellOf,
  onAdd,
  onDropFiles,
  onReplace,
  onRemove,
  onClear,
  onRetry,
  onOpen,
}: {
  garments: BatchGarment[];
  locked: boolean;
  busy: boolean;
  nouns: BatchNouns;
  cellOf: (gi: number) => BatchCell | undefined;
  onAdd: () => void;
  onDropFiles: (files: File[]) => void;
  onReplace: (gi: number) => void;
  onRemove: (gi: number) => void;
  onClear: () => void;
  onRetry: (gi: number) => void;
  onOpen: (gi: number) => void;
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
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        onDropFiles(Array.from(e.dataTransfer?.files || []));
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="text-xs font-medium tracking-wide text-fg-mute">
          {nouns.item}
          {garments.length ? ` · ${garments.length} ${nouns.itemUnit}` : ""}
        </div>
        {locked || !garments.length ? null : (
          <>
            <button type="button" onClick={onAdd} className="text-xs text-fg-dim transition-colors hover:text-fg">
              ＋添加
            </button>
            <button type="button" onClick={onClear} className="text-xs text-fg-mute transition-colors hover:text-fg">
              清空
            </button>
          </>
        )}
        {busy ? <Icon name="CircleNotch" size={13} className="animate-spin text-accent" /> : null}
      </div>

      <div ref={boxRef} className="relative min-h-0 flex-1">
        {garments.length === 0 ? (
          <button
            type="button"
            onClick={onAdd}
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-[28px] border border-dashed transition-all duration-300",
              drag ? "border-accent bg-accent/[0.06]" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
            )}
          >
            <span
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-white/[0.03]",
                drag ? "text-accent" : "text-fg-dim",
              )}
            >
              <Icon name={busy ? "CircleNotch" : nouns.icon} size={26} className={busy ? "animate-spin text-accent" : undefined} />
            </span>
            <div className="text-center">
              <div className="text-base font-medium text-fg">
                {busy ? "正在读取…" : `拖入或点击添加${nouns.item} · 支持一次 ${MAX_BATCH_GARMENTS} 张`}
              </div>
              <div className="mt-1 text-xs text-fg-mute">支持拖拽 · 点击选择 · 直接粘贴</div>
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
                  cell={cellOf(gi)}
                  locked={locked}
                  small={small}
                  onReplace={() => onReplace(gi)}
                  onRemove={() => onRemove(gi)}
                  onRetry={() => onRetry(gi)}
                  onOpen={() => onOpen(gi)}
                  modelIndex={0}
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

// ── 网格视图 · 单个服装格（卡片状态循环：服装图 → 暗+百分比 → 结果/⚠重生成）──
function GarmentTile({
  garment,
  cell,
  locked,
  small,
  modelIndex,
  onReplace,
  onRemove,
  onRetry,
  onOpen,
}: {
  garment: BatchGarment;
  cell: BatchCell | undefined;
  locked: boolean;
  small: boolean;
  modelIndex: number;
  onReplace: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onOpen: () => void;
}) {
  const success = cell?.status === "success" && !!cell.resultUrl;
  const dimmed = cell && (cell.status === "waiting" || cell.status === "running" || cell.status === "failed");

  return (
    <div
      className={cn(
        "group relative flex items-center justify-center overflow-hidden rounded-control border bg-panel-2/60",
        success ? "cursor-zoom-in border-line hover:border-line-2" : "border-line",
      )}
      onClick={success ? onOpen : undefined}
    >
      {success ? (
        <motion.img
          key={cell.resultUrl}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          src={cell.resultUrl}
          alt={`${garment.name} 结果`}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={garment.src}
          alt={garment.name}
          className={cn("max-h-full max-w-full object-contain transition-opacity duration-300", dimmed && "opacity-30")}
        />
      )}

      {cell ? <CellStateLayer cell={cell} pct={displayPct(cell)} small={small} onRetry={onRetry} /> : null}

      <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded bg-black/50 px-1.5 py-0.5 text-center text-[10px] leading-tight text-fg backdrop-blur-sm">
        {garment.name}
      </span>

      {success ? (
        <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-1.5 bg-black/45 p-2 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
          <HoverBtn icon="ArrowsLeftRight" label="对比" onClick={onOpen} />
          <HoverBtn
            icon="DownloadSimple"
            label="下载"
            onClick={() => cell?.resultUrl && downloadCellResult(cell.resultUrl, garment.name, modelIndex)}
          />
          <HoverBtn icon="ArrowClockwise" label="重生成" onClick={onRetry} />
          <HoverBtn icon="ImageSquare" label="设为画布" onClick={() => cell?.resultUrl && setBatchResultAsCanvas(cell.resultUrl)} />
        </div>
      ) : !cell && !locked ? (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
          <HoverBtn icon="ArrowClockwise" label="更换" onClick={onReplace} />
          <HoverBtn icon="X" label="删除" onClick={onRemove} />
        </div>
      ) : null}
    </div>
  );
}

// ── 全匹配矩阵（≥2 位模特）：行=服装、列=模特，行列头吸附，超屏纵向滚动 ──────
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
  const canAddModel = !locked && models.length < MAX_BATCH_MODELS;
  const canAddGarment = !locked && garments.length < MAX_BATCH_GARMENTS;

  function retryRow(gi: number) {
    for (let mi = 0; mi < models.length; mi++) {
      const c = cellOf(mi, gi);
      if (c && (c.status === "failed" || c.status === "success")) retryCell(mi, gi);
    }
  }
  function downloadRow(gi: number) {
    const g = garments[gi];
    for (let mi = 0; mi < models.length; mi++) {
      const c = cellOf(mi, gi);
      if (c?.status === "success" && c.resultUrl) downloadCellResult(c.resultUrl, g.name, mi);
    }
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-panel border border-line">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `132px repeat(${models.length}, minmax(140px, 1fr))${canAddModel ? " 68px" : ""}`,
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
                <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
                <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-1 bg-black/45 p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <HoverBtn icon="ArrowClockwise" label="整行重生成" onClick={() => retryRow(gi)} />
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
              return (
                <div key={mi} className="border-b border-line p-2">
                  <div
                    className={cn(
                      "group relative flex h-40 items-center justify-center overflow-hidden rounded-control border bg-panel-2/40",
                      success ? "cursor-zoom-in border-line hover:border-line-2" : "border-line/60",
                    )}
                    onClick={success ? () => onOpen(mi, gi) : undefined}
                  >
                    {success ? (
                      <motion.img
                        key={cell.resultUrl}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.35 }}
                        src={cell.resultUrl}
                        alt={`${g.name} × ${nouns.base}${mi + 1}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : cell ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.src} alt="" aria-hidden className="max-h-full max-w-full object-contain opacity-25" />
                    ) : (
                      <span className="text-[10px] text-fg-mute">—</span>
                    )}
                    {cell ? (
                      <CellStateLayer cell={cell} pct={displayPct(cell)} small onRetry={() => onRetry(mi, gi)} />
                    ) : null}
                    {success ? (
                      <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
                        <HoverBtn icon="ArrowsLeftRight" label="对比" onClick={() => onOpen(mi, gi)} />
                        <HoverBtn icon="ArrowClockwise" label="重生成" onClick={() => onRetry(mi, gi)} />
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
