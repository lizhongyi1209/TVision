"use client";

// Independent store for the batch workshop (PLAN-BATCH) — deliberately NOT
// merged into useStudio (src/lib/store.ts), same reasoning as logStore.ts:
// up to MAX_BATCH_MODELS × MAX_BATCH_GARMENTS cells each tick their own
// progress while a run is live, and keeping that in its own store means
// components that only care about the single-image studio never re-render
// just because a batch cell's status changed.
//
// The submit/poll engine below (bottom half of this file) is plain
// module-level async functions driven entirely through this store's
// getState()/setState(), not a React effect — so a run keeps going even if
// BatchWorkshop.tsx unmounts (the user switches back to 单图创作 mid-run).
// It mirrors Studio.tsx's polling effect in spirit (tick, reschedule, guard
// against a superseded run) but lives at module scope instead of a
// component's effect, since nothing here needs a component's lifecycle.

import { create } from "zustand";
import { batchNouns, getWearType, WEAR_TYPES } from "./batchPrompts";
import { MAX_BATCH_GARMENTS, MAX_BATCH_MODELS, MAX_BATCH_TASKS } from "./limits";
import { diag } from "./logStore";
import { useStudio } from "./store";
import type { Billing, ModelName, Quality, Resolution } from "./types";

export interface BatchGarment {
  src: string;
  /** Original file name, extension stripped (Stage-equivalent upload code in
   *  BatchWorkshop.tsx does the stripping) — used for the on-tile badge and
   *  the "服装名-模特N" download/note label. */
  name: string;
}

export interface BatchParams {
  model: ModelName;
  resolution: Resolution;
  aspectRatio: string;
  billing: Billing;
  /** GPT Image 2 only; ignored by the nano-banana family's submit body —
   *  same convention as GenParams.quality (src/lib/types.ts). */
  quality: Quality;
}

export type BatchCellStatus = "waiting" | "running" | "success" | "failed";

export interface BatchCell {
  modelIndex: number;
  garmentIndex: number;
  /** Task type used for this result, so later setting changes do not relabel
   *  completed images or downloads. */
  wearTypeId: string;
  status: BatchCellStatus;
  /** Transient engine-only flag: true from the moment a submit burst claims
   *  this cell until its POST settles, so a second pump (e.g. a retry issued
   *  mid-run) can't double-submit it. Never read by the UI — status alone
   *  drives rendering. */
  claimed?: boolean;
  jobId?: string;
  resultUrl?: string;
  /** Last known real completion 0-1 (poll-derived). The UI blends this with
   *  a time-based fake curve for display — see BatchWorkshop.tsx's shared
   *  ticker; deliberately NOT computed in this store, so a smooth progress
   *  animation doesn't mean a 2×/s zustand write per running cell. */
  progress: number;
  /** Set once the submit POST for this cell actually succeeds — basis for
   *  the UI's fake-progress curve (mirrors useStudio's startedAt). */
  startedAt?: number;
  /** Set after every poll attempt — diagnostics/debug only now that each
   *  running cell owns its own poll loop (no round scheduling to feed). */
  lastPolledAt?: number;
  error?: string;
}

interface BatchState {
  models: string[];
  garments: BatchGarment[];
  wearTypeId: string;
  prompt: string;
  /** True once the user hand-edits the prompt — BatchBar.tsx shows the type
   *  selector as "自定义" while this is set; picking a type again overwrites
   *  the prompt and clears this, same convention as store.ts's chooseAction
   *  overwriting params.prompt wholesale. */
  promptEdited: boolean;
  params: BatchParams;
  cells: BatchCell[];
  runState: "idle" | "running" | "done";
  /** Bumped on every startRun/retry-while-idle call. Every in-flight engine
   *  loop closes over the runId it was launched with and stops the instant
   *  it no longer matches current state — the mechanism that lets a fresh
   *  run supersede stale loops without any explicit cancellation call. */
  runId: number;
  runStartedAt: number | null;
  /** Which cell's result is open in the full-screen compare lightbox
   *  (BatchLightbox.tsx) — mirrors useStudio's resultsOpen/resultIndex pair,
   *  just addressed by (modelIndex, garmentIndex) instead of a flat index
   *  since the workshop has no single linear "results" array. */
  lightbox: { modelIndex: number; garmentIndex: number } | null;

  /** Silently caps at MAX_BATCH_MODELS (toast when anything was dropped). */
  addModels: (srcs: string[]) => void;
  /** No-op if index is out of range. */
  removeModel: (index: number) => void;
  /** No-op if index is out of range. */
  replaceModel: (index: number, src: string) => void;
  /** Silently caps at MAX_BATCH_GARMENTS (toast when anything was dropped). */
  addGarments: (items: BatchGarment[]) => void;
  /** No-op if index is out of range. */
  removeGarment: (index: number) => void;
  /** No-op if index is out of range. */
  replaceGarment: (index: number, item: BatchGarment) => void;
  /** Empties the whole garment wall in one click（墙头的「清空」）. Same
   *  roster-invalidation rules as removeGarment; no-op mid-run. */
  clearGarments: () => void;
  setWearType: (id: string) => void;
  setPrompt: (text: string) => void;
  updateParams: (p: Partial<BatchParams>) => void;
  startRun: () => void;
  stopRun: () => void;
  /** Re-queues one terminal cell (failed OR success — the latter is the
   *  「重生成」 hover/lightbox action on an already-generated result). */
  retryCell: (modelIndex: number, garmentIndex: number) => void;
  retryFailed: () => void;
  /** No-op if that cell has no result yet — doubles as the "navigate to
   *  another cell while already open" setter (BatchLightbox's prev/next). */
  openLightbox: (modelIndex: number, garmentIndex: number) => void;
  closeLightbox: () => void;
}

const DEFAULT_PARAMS: BatchParams = {
  model: "Nano Banana 2",
  resolution: "2K",
  aspectRatio: "auto",
  billing: "特价",
  quality: "auto",
};

// Engine pacing — internal tuning constants, not a shared interaction rule
// (PLAN-BATCH D3), so they live here rather than limits.ts. Submit and poll
// are deliberately UNCAPPED (2026-07-12 用户要求把效率做到极致): every cell
// submits simultaneously and owns its own independent poll loop, so results
// land strictly in whatever order the upstream finishes them.
const POLL_INTERVAL_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Destructive roster edits drop any existing result grid, since re-indexing
 *  cells around a removed/replaced slot is more
 *  error-prone than just asking the user to re-run. D7 already disables
 *  all roster controls while a run is live (defensive no-op here too), so this
 *  only ever fires between runs; the toast only shows when there was
 *  actually something on screen to lose. */
function invalidateOnRosterChange(
  s: BatchState,
  patch: Partial<Pick<BatchState, "models" | "garments">>,
): Partial<BatchState> {
  if (s.runState === "running") return {};
  if (s.cells.length === 0) return patch;
  const n = batchNouns(s.wearTypeId);
  useStudio.getState().showToast("info", `${n.base}/${n.item}名单已变化，批量结果已重置`);
  return { ...patch, cells: [], runState: "idle" };
}

export const useBatchStore = create<BatchState>((set, get) => ({
  models: [],
  garments: [],
  wearTypeId: WEAR_TYPES[0].id,
  prompt: WEAR_TYPES[0].buildPrompt(),
  promptEdited: false,
  params: { ...DEFAULT_PARAMS },
  cells: [],
  runState: "idle",
  runId: 0,
  runStartedAt: null,
  lightbox: null,

  addModels: (srcs) => {
    const s = get();
    if (s.runState === "running") return;
    const room = MAX_BATCH_MODELS - s.models.length;
    const accepted = srcs.slice(0, Math.max(0, room));
    if (srcs.length > accepted.length) {
      const n = batchNouns(s.wearTypeId);
      useStudio.getState().showToast("error", `最多添加 ${MAX_BATCH_MODELS} ${n.baseUnit}${n.base}`);
    }
    if (!accepted.length) return;
    set((s2) => ({ models: [...s2.models, ...accepted] }));
  },
  removeModel: (index) =>
    set((s) => invalidateOnRosterChange(s, { models: s.models.filter((_, i) => i !== index) })),
  replaceModel: (index, src) =>
    set((s) => {
      if (index < 0 || index >= s.models.length) return {};
      return invalidateOnRosterChange(s, { models: s.models.map((m, i) => (i === index ? src : m)) });
    }),

  addGarments: (items) => {
    const s = get();
    if (s.runState === "running") return;
    const room = MAX_BATCH_GARMENTS - s.garments.length;
    const accepted = items.slice(0, Math.max(0, room));
    if (items.length > accepted.length) {
      const n = batchNouns(s.wearTypeId);
      useStudio.getState().showToast("error", `最多添加 ${MAX_BATCH_GARMENTS} ${n.itemUnit}${n.item}`);
    }
    if (!accepted.length) return;
    set((s2) => ({ garments: [...s2.garments, ...accepted] }));
  },
  removeGarment: (index) =>
    set((s) => invalidateOnRosterChange(s, { garments: s.garments.filter((_, i) => i !== index) })),
  replaceGarment: (index, item) =>
    set((s) => {
      if (index < 0 || index >= s.garments.length) return {};
      return invalidateOnRosterChange(s, { garments: s.garments.map((g, i) => (i === index ? item : g)) });
    }),
  clearGarments: () =>
    set((s) => {
      if (!s.garments.length) return {};
      return invalidateOnRosterChange(s, { garments: [] });
    }),

  setWearType: (id) => {
    const wt = getWearType(id);
    if (!wt) return;
    set({ wearTypeId: id, prompt: wt.buildPrompt(), promptEdited: false });
  },
  // 通用替换（generic，默认）没有预设提示词，用户输入本来就是常态，不算
  // 「改坏了预设」——保持 promptEdited=false，类型选择器继续显示「通用替换」
  // 而不是跳成「自定义」。其余换装类型改动提示词仍标记为自定义。
  setPrompt: (text) => set((s) => ({ prompt: text, promptEdited: s.wearTypeId !== "generic" })),
  updateParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

  startRun: () => {
    const s = get();
    if (s.runState === "running") return;
    if (!s.models.length || !s.garments.length) return;
    if (s.models.length * s.garments.length > MAX_BATCH_TASKS) return; // BatchBar's own gate is the primary guard; defensive no-op here too
    const cells: BatchCell[] = [];
    // Garment-major order (服装序优先): iterate garments outer, models inner,
    // matching the matrix view's row=服装/column=模特 convention so results
    // appear to fill in row-by-row on screen.
    for (let gi = 0; gi < s.garments.length; gi++) {
      for (let mi = 0; mi < s.models.length; mi++) {
        cells.push({ modelIndex: mi, garmentIndex: gi, wearTypeId: s.wearTypeId, status: "waiting", progress: 0 });
      }
    }
    const runId = s.runId + 1;
    set({ cells, runState: "running", runId, runStartedAt: Date.now() });
    const n = batchNouns(s.wearTypeId);
    diag(
      "info",
      "批量工坊",
      `开始批量：${s.models.length} ${n.baseUnit}${n.base} × ${s.garments.length} ${n.itemUnit}${n.item} = ${cells.length} 张`,
    );
    launchEngine(runId);
  },

  stopRun: () => {
    const s = get();
    if (s.runState !== "running") return;
    // Waiting cells never got submitted — drop them so those combos read as
    // not-yet-run again; already-submitted (running) cells are left alone
    // and keep polling to completion (PLAN-BATCH D7: credits already spent,
    // the image is still worth collecting). runState/runId are deliberately
    // untouched here — the poll loop must keep going until checkCompletion
    // (called from every cell's own resolution) finds nothing left pending.
    set((s2) => ({ cells: s2.cells.filter((c) => c.status !== "waiting") }));
    diag("info", "批量工坊", "已停止：未提交的任务已取消，进行中的任务将继续完成");
    useStudio.getState().showToast("info", "已停止，进行中的任务会继续完成");
    checkCompletion(s.runId); // covers the edge case where nothing was actually still running
  },

  retryCell: (modelIndex, garmentIndex) => {
    const cell = get().cells.find((c) => c.modelIndex === modelIndex && c.garmentIndex === garmentIndex);
    // Resetting to a fresh waiting cell drops the old jobId/resultUrl/error,
    // so the engine treats the combo like any first attempt.
    if (!cell || (cell.status !== "failed" && cell.status !== "success")) return;
    set((s) => ({
      cells: s.cells.map((c) =>
        c.modelIndex === modelIndex && c.garmentIndex === garmentIndex
          ? { modelIndex, garmentIndex, wearTypeId: s.wearTypeId, status: "waiting" as const, progress: 0 }
          : c,
      ),
    }));
    ensureEngineRunning();
  },

  retryFailed: () => {
    const failedCount = get().cells.filter((c) => c.status === "failed").length;
    if (!failedCount) return;
    set((s) => ({
      cells: s.cells.map((c) =>
        c.status === "failed"
          ? {
              modelIndex: c.modelIndex,
              garmentIndex: c.garmentIndex,
              wearTypeId: s.wearTypeId,
              status: "waiting" as const,
              progress: 0,
            }
          : c,
      ),
    }));
    diag("info", "批量工坊", `重试 ${failedCount} 个未成功任务`);
    ensureEngineRunning();
  },

  openLightbox: (modelIndex, garmentIndex) => {
    const cell = get().cells.find((c) => c.modelIndex === modelIndex && c.garmentIndex === garmentIndex);
    if (!cell?.resultUrl) return;
    set({ lightbox: { modelIndex, garmentIndex } });
  },
  closeLightbox: () => set({ lightbox: null }),
}));

// ── Submit/poll engine ──────────────────────────────────────────────────────
// Free functions (not store actions) because they run as long-lived
// recursive loops, not one-shot state transitions — see the file header.

function isEngineLive(runId: number): boolean {
  const s = useBatchStore.getState();
  return s.runId === runId && s.runState === "running";
}

function updateCell(modelIndex: number, garmentIndex: number, patch: Partial<BatchCell>) {
  useBatchStore.setState((s) => ({
    cells: s.cells.map((c) => (c.modelIndex === modelIndex && c.garmentIndex === garmentIndex ? { ...c, ...patch } : c)),
  }));
}

/** Called after every cell reaches a terminal state (success/failed). Flips
 *  runState to "done" the moment nothing is waiting/running anymore. Safe to
 *  call redundantly — re-reads fresh state and no-ops once already "done". */
function checkCompletion(runId: number) {
  const s = useBatchStore.getState();
  if (s.runId !== runId || s.runState !== "running") return;
  const pending = s.cells.some((c) => c.status === "waiting" || c.status === "running");
  if (pending) return;
  const success = s.cells.filter((c) => c.status === "success").length;
  const failed = s.cells.filter((c) => c.status === "failed").length;
  const secs = s.runStartedAt ? ((Date.now() - s.runStartedAt) / 1000).toFixed(1) : "?";
  useBatchStore.setState({ runState: "done" });
  diag("info", "批量工坊", `批量完成，共 ${success + failed} 张 · 成功 ${success} · 未成功 ${failed}，耗时 ${secs}s`);
  useStudio
    .getState()
    .showToast(failed > 0 ? "info" : "success", `批量完成：${success} 张成功${failed ? ` · ${failed} 张未成功` : ""}`);
}

function launchEngine(runId: number) {
  pumpWaiting(runId);
}

/** Restarts the engine for a retry issued while runState is "done"; if a run
 *  is still live (e.g. a mid-run retry of an already-failed cell), just pump
 *  the newly-"waiting" cells under the current runId — no need to bump it
 *  and risk stranding genuinely in-flight closures. */
function ensureEngineRunning() {
  const s = useBatchStore.getState();
  if (s.runState === "running") {
    pumpWaiting(s.runId);
    return;
  }
  const runId = s.runId + 1;
  useBatchStore.setState({ runState: "running", runId, runStartedAt: Date.now() });
  launchEngine(runId);
}

/** Claim EVERY unclaimed waiting cell and fire all their submits at once —
 *  no worker pool, no queue: 50 cells means 50 simultaneous POSTs, and each
 *  success immediately spawns that cell's own poll loop. The claim is atomic
 *  (single setState) so a pump racing a retry can't double-submit a cell. */
function pumpWaiting(runId: number) {
  let batch: BatchCell[] = [];
  useBatchStore.setState((s) => {
    if (s.runId !== runId) return {};
    const candidates = s.cells.filter((c) => c.status === "waiting" && !c.claimed);
    if (!candidates.length) return {};
    batch = candidates;
    const keys = new Set(candidates.map((c) => cellKey(c.modelIndex, c.garmentIndex)));
    const cells = s.cells.map((c) => (keys.has(cellKey(c.modelIndex, c.garmentIndex)) ? { ...c, claimed: true } : c));
    return { cells };
  });
  for (const cell of batch) void submitOneCell(cell, runId);
}

async function submitOneCell(cell: BatchCell, runId: number) {
  const s = useBatchStore.getState();
  const model = s.models[cell.modelIndex];
  const garment = s.garments[cell.garmentIndex];
  const nouns = batchNouns(s.wearTypeId);
  // Defensive only — D7's UI lock means the roster can't actually change
  // mid-run, so model/garment should always be present here.
  if (!model || !garment) {
    updateCell(cell.modelIndex, cell.garmentIndex, {
      status: "failed",
      claimed: false,
      error: `${nouns.base}或${nouns.item}已被移除`,
    });
    checkCompletion(runId);
    return;
  }
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: s.prompt,
        model: s.params.model,
        resolution: s.params.resolution,
        aspectRatio: s.params.aspectRatio,
        billing: s.params.billing,
        quality: s.params.model === "GPT Image 2" ? s.params.quality : undefined,
        count: 1,
        baseImage: model,
        refImages: [garment.src],
        note: `${garment.name} · ${nouns.base}${cell.modelIndex + 1}`,
      }),
    }).then((r) => r.json());

    if (!isEngineLive(runId)) return; // run stopped/superseded while this was in flight

    if (res.error) {
      updateCell(cell.modelIndex, cell.garmentIndex, { status: "failed", claimed: false, error: res.error });
      diag("warn", "批量工坊", `提交失败：${garment.name} × ${nouns.base}${cell.modelIndex + 1}`, res.error);
    } else {
      const jobId = (res.jobs as { id: string }[] | undefined)?.[0]?.id;
      if (!jobId) {
        updateCell(cell.modelIndex, cell.garmentIndex, { status: "failed", claimed: false, error: "提交响应异常" });
      } else {
        updateCell(cell.modelIndex, cell.garmentIndex, {
          status: "running",
          claimed: false,
          jobId,
          startedAt: Date.now(),
          lastPolledAt: 0,
        });
        // Each submitted cell gets its own poll loop right away — the moment
        // the upstream finishes this one, its very next poll downloads it.
        void pollCellLoop(cell.modelIndex, cell.garmentIndex, jobId, runId);
      }
    }
  } catch (e) {
    if (!isEngineLive(runId)) return;
    updateCell(cell.modelIndex, cell.garmentIndex, {
      status: "failed",
      claimed: false,
      error: (e as Error)?.message || "提交失败，请检查网络",
    });
  }
  checkCompletion(runId);
}

function cellKey(mi: number, gi: number) {
  return `${mi}_${gi}`;
}

/** One cell's private poll loop, spawned the instant its submit succeeds.
 *  All running cells poll in parallel on their own POLL_INTERVAL_MS cadence
 *  — no shared round scheduling — so each result is discovered (and
 *  server-side downloaded to output/, see /api/jobs/[id]) at the earliest
 *  possible poll after the upstream finishes it, independent of how many
 *  siblings are still running. Exits when the cell hits a terminal state,
 *  the run is superseded, or the cell itself was reset (retry bumped it back
 *  to waiting — the retry's own submit spawns a fresh loop). */
async function pollCellLoop(modelIndex: number, garmentIndex: number, jobId: string, runId: number) {
  while (true) {
    const s = useBatchStore.getState();
    if (s.runId !== runId) return;
    const cell = s.cells.find((c) => c.modelIndex === modelIndex && c.garmentIndex === garmentIndex);
    if (!cell || cell.status !== "running" || cell.jobId !== jobId) return;

    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`).then((x) => x.json());
      if (useBatchStore.getState().runId !== runId) return; // superseded run — drop the result

      if (r.status === "success") {
        updateCell(modelIndex, garmentIndex, {
          status: "success",
          progress: 1,
          resultUrl: (r.images && r.images[0]) || undefined,
          lastPolledAt: Date.now(),
        });
        checkCompletion(runId);
        return;
      }
      if (r.status === "failed") {
        updateCell(modelIndex, garmentIndex, {
          status: "failed",
          progress: 1,
          error: r.error || "生成失败",
          lastPolledAt: Date.now(),
        });
        diag("warn", "批量工坊", "单元生成失败", `任务 ID: ${jobId}\n${r.error || "生成失败"}`);
        checkCompletion(runId);
        return;
      }
      updateCell(modelIndex, garmentIndex, {
        progress: typeof r.progress === "number" ? r.progress : cell.progress,
        lastPolledAt: Date.now(),
      });
    } catch {
      if (useBatchStore.getState().runId !== runId) return;
      // Transient network miss: just wait out the interval and re-poll — a
      // single miss isn't worth its own diagnostics line (unlike Studio.tsx's
      // polling effect, which tracks consecutive failures per job); a
      // persistent one keeps showing "运行中" and retries indefinitely.
      updateCell(modelIndex, garmentIndex, { lastPolledAt: Date.now() });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
