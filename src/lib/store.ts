"use client";

import { create } from "zustand";
import type { GenParams, HistoryItem, InpaintJob, InpaintMask, ModelName, PublicSettings, Resolution } from "./types";
import { getAction } from "./actions";

export interface PlacedImage {
  src: string;
  width: number;
  height: number;
}

export type Phase = "idle" | "submitting" | "running" | "success" | "error";
export interface ToastMsg {
  id: number;
  kind: "info" | "error" | "success";
  msg: string;
}

const DEFAULT_PARAMS: GenParams = {
  prompt: "",
  model: "Nano Banana 2",
  resolution: "2K",
  aspectRatio: "auto",
  billing: "特价",
  count: 1,
};

interface StudioState {
  image: PlacedImage | null;
  menuOpen: boolean;
  cropOpen: boolean;
  brushPanelOpen: boolean;

  activeActionId: string | null;
  refImage: string | null;
  /** Non-null once the user has painted and confirmed a local-repaint selection
   *  (BrushPanel). Mutually exclusive with activeActionId in practice: choosing
   *  an AI action or opening the brush panel each clear the other's state. */
  inpaintMask: InpaintMask | null;
  /** Snapshot of inpaintMask taken at submit time (GenerateBar.generate()) —
   *  see InpaintJob's doc comment in lib/types.ts for why this is separate
   *  from inpaintMask itself. */
  inpaintJob: InpaintJob | null;
  /** True while a "视觉反推"-style action's async vision-model call is
   *  in flight. Deliberately separate from `phase`, which tracks the
   *  generation job lifecycle only — analysis happens before any job
   *  exists. */
  analyzingVision: boolean;
  /** 0-1 fake-progress value for the vision-analysis progress card
   *  (ResultSlot), ticked by a timer effect in GenerateBar while
   *  analyzingVision is true. Mirrors `progress`/`realProgress`'s role for
   *  the generation lifecycle, but vision analysis has no server-side
   *  status to poll, so there's no "real" counterpart. */
  visionProgress: number;
  /** Timestamp analysis began, used to derive visionProgress from elapsed
   *  time. Mirrors `startedAt`. */
  visionStartedAt: number | null;
  /** Friendly error text from a failed vision analysis, shown by ResultSlot's
   *  "反推失败" card. Cleared whenever a new analysis begins or the user
   *  cancels/switches action/image. */
  visionError: string | null;
  /** Bumped on every chooseAction call (even re-selecting the same id), so
   *  GenerateBar's fetch-orchestration effect (keyed on
   *  [activeActionId, image?.src, visionRequestId]) reliably re-fires when
   *  the user retries a failed analysis by clicking the same pill again —
   *  activeActionId alone wouldn't change in that case. */
  visionRequestId: number;

  params: GenParams;

  phase: Phase;
  progress: number;
  realProgress: number;
  startedAt: number | null;
  jobIds: string[];
  results: string[] | null;
  resultIndex: number;
  resultsOpen: boolean;
  error: string | null;

  settings: PublicSettings | null;
  settingsOpen: boolean;
  historyOpen: boolean;
  history: HistoryItem[];
  toast: ToastMsg | null;

  setImage: (img: PlacedImage | null) => void;
  openMenu: () => void;
  closeMenu: () => void;
  openCrop: () => void;
  closeCrop: () => void;
  openBrushPanel: () => void;
  closeBrushPanel: () => void;
  setInpaintMask: (m: InpaintMask) => void;
  setInpaintJob: (j: InpaintJob) => void;
  clearInpaint: () => void;
  replaceImage: (img: PlacedImage) => void;
  chooseAction: (id: string) => void;
  cancelAction: () => void;
  setRef: (dataUrl: string | null) => void;
  updateParams: (p: Partial<GenParams>) => void;
  beginVisionAnalysis: () => void;
  setVisionProgress: (n: number) => void;
  finishVisionAnalysis: () => void;
  failVisionAnalysis: (msg: string) => void;

  setJobIds: (ids: string[]) => void;
  beginSubmit: () => void;
  setPhase: (p: Phase) => void;
  setProgress: (n: number) => void;
  setRealProgress: (n: number) => void;
  setResults: (r: string[] | null) => void;
  setError: (e: string | null) => void;
  dismissResults: () => void;
  useResultAsCanvas: (img: PlacedImage) => void;
  setResultIndex: (i: number) => void;
  openResults: () => void;
  closeResults: () => void;

  setSettings: (s: PublicSettings | null) => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleHistory: () => void;
  closeHistory: () => void;
  setHistory: (h: HistoryItem[]) => void;

  showToast: (kind: ToastMsg["kind"], msg: string) => void;
  clearToast: () => void;
}

let toastSeq = 1;

export const useStudio = create<StudioState>((set) => ({
  image: null,
  menuOpen: false,
  cropOpen: false,
  brushPanelOpen: false,

  activeActionId: null,
  refImage: null,
  inpaintMask: null,
  inpaintJob: null,
  analyzingVision: false,
  visionProgress: 0,
  visionStartedAt: null,
  visionError: null,
  visionRequestId: 0,

  params: { ...DEFAULT_PARAMS },

  phase: "idle",
  progress: 0,
  realProgress: 0,
  startedAt: null,
  jobIds: [],
  results: null,
  resultIndex: 0,
  resultsOpen: false,
  error: null,

  settings: null,
  settingsOpen: false,
  historyOpen: false,
  history: [],
  toast: null,

  setImage: (img) =>
    set((s) => ({
      image: img,
      menuOpen: false,
      activeActionId: null,
      refImage: null,
      results: null,
      resultIndex: 0,
      resultsOpen: false,
      error: null,
      phase: "idle",
      analyzingVision: false,
      visionProgress: 0,
      visionStartedAt: null,
      visionError: null,
      inpaintMask: null,
      inpaintJob: null,
      params: { ...s.params, prompt: "", aspectRatio: "auto", count: 1 },
    })),

  openMenu: () => set((s) => (s.image ? { menuOpen: true } : {})),
  closeMenu: () => set({ menuOpen: false }),

  openCrop: () => set((s) => (s.image ? { cropOpen: true, menuOpen: false } : {})),
  closeCrop: () => set({ cropOpen: false }),
  // Brush tool and AI actions are mutually exclusive: opening the panel also
  // drops any chosen AI action/ref (mirrors chooseAction clearing inpaint below).
  openBrushPanel: () =>
    set((s) => (s.image ? { brushPanelOpen: true, menuOpen: false, activeActionId: null, refImage: null } : {})),
  closeBrushPanel: () => set({ brushPanelOpen: false }),
  setInpaintMask: (m) => set({ inpaintMask: m }),
  setInpaintJob: (j) => set({ inpaintJob: j }),
  clearInpaint: () => set({ inpaintMask: null, inpaintJob: null }),
  // Swap only the canvas image (crop result): keep prompt/action/params intact.
  replaceImage: (img) => set({ image: img, cropOpen: false, menuOpen: false }),

  chooseAction: (id) => {
    const a = getAction(id);
    if (!a) return;
    set((s) => ({
      activeActionId: id,
      menuOpen: false,
      refImage: a.needsRef ? null : s.refImage,
      inpaintMask: null,
      inpaintJob: null,
      params: {
        ...s.params,
        prompt: a.buildPrompt(),
        aspectRatio: a.defaultAspect,
        count: a.defaultCount,
        resolution: a.defaultResolution ? (a.defaultResolution as Resolution) : s.params.resolution,
        model: a.defaultModel ? (a.defaultModel as ModelName) : s.params.model,
      },
      results: null,
      resultIndex: 0,
      resultsOpen: false,
      error: null,
      phase: "idle",
      // Reset any in-flight/failed vision state from a previous action so
      // GenerateBar's fetch-orchestration effect starts clean; bump
      // visionRequestId unconditionally (even re-selecting the same id) so
      // that effect reliably re-fires to retry a failed analysis.
      analyzingVision: false,
      visionProgress: 0,
      visionStartedAt: null,
      visionError: null,
      visionRequestId: s.visionRequestId + 1,
    }));
  },

  cancelAction: () =>
    set({
      activeActionId: null,
      refImage: null,
      results: null,
      resultIndex: 0,
      resultsOpen: false,
      error: null,
      phase: "idle",
      analyzingVision: false,
      visionProgress: 0,
      visionStartedAt: null,
      visionError: null,
      inpaintMask: null,
      inpaintJob: null,
    }),

  setRef: (dataUrl) => set({ refImage: dataUrl }),

  updateParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  beginVisionAnalysis: () => set({ analyzingVision: true, visionProgress: 0, visionStartedAt: Date.now(), visionError: null }),
  setVisionProgress: (n) => set({ visionProgress: n }),
  finishVisionAnalysis: () => set({ analyzingVision: false, visionProgress: 1, visionStartedAt: null }),
  failVisionAnalysis: (msg) =>
    set({ analyzingVision: false, visionProgress: 0, visionStartedAt: null, visionError: msg }),

  setJobIds: (ids) => set({ jobIds: ids }),
  beginSubmit: () =>
    set({
      phase: "submitting",
      error: null,
      results: null,
      resultIndex: 0,
      resultsOpen: false,
      progress: 0,
      realProgress: 0,
      startedAt: Date.now(),
    }),
  setPhase: (p) => set({ phase: p }),
  setProgress: (n) => set({ progress: n }),
  setRealProgress: (n) => set({ realProgress: n }),
  setResults: (r) => set({ results: r, resultIndex: 0 }),
  setError: (e) => set({ error: e }),
  dismissResults: () => set({ results: null, resultIndex: 0, resultsOpen: false, phase: "idle" }),

  useResultAsCanvas: (img) =>
    set({
      image: img,
      results: null,
      resultIndex: 0,
      resultsOpen: false,
      phase: "idle",
      activeActionId: null,
      refImage: null,
      menuOpen: false,
      inpaintMask: null,
      inpaintJob: null,
    }),

  setResultIndex: (i) => set({ resultIndex: i }),
  openResults: () => set((s) => (s.results && s.results.length > 0 ? { resultsOpen: true } : {})),
  closeResults: () => set({ resultsOpen: false }),

  setSettings: (s) => set({ settings: s }),
  openSettings: () => set({ settingsOpen: true, historyOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen, settingsOpen: false })),
  closeHistory: () => set({ historyOpen: false }),
  setHistory: (h) => set({ history: h }),

  showToast: (kind, msg) => set({ toast: { id: toastSeq++, kind, msg } }),
  clearToast: () => set({ toast: null }),
}));
