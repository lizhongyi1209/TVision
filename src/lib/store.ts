"use client";

import { create } from "zustand";
import type { GenParams, HistoryItem, PublicSettings } from "./types";
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

  activeActionId: string | null;
  refImage: string | null;

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
  replaceImage: (img: PlacedImage) => void;
  chooseAction: (id: string) => void;
  cancelAction: () => void;
  setRef: (dataUrl: string | null) => void;
  updateParams: (p: Partial<GenParams>) => void;

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
  setHistory: (h: HistoryItem[]) => void;

  showToast: (kind: ToastMsg["kind"], msg: string) => void;
  clearToast: () => void;
}

let toastSeq = 1;

export const useStudio = create<StudioState>((set) => ({
  image: null,
  menuOpen: false,
  cropOpen: false,

  activeActionId: null,
  refImage: null,

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
      params: { ...s.params, prompt: "", aspectRatio: "auto", count: 1 },
    })),

  openMenu: () => set((s) => (s.image ? { menuOpen: true } : {})),
  closeMenu: () => set({ menuOpen: false }),

  openCrop: () => set((s) => (s.image ? { cropOpen: true, menuOpen: false } : {})),
  closeCrop: () => set({ cropOpen: false }),
  // Swap only the canvas image (crop result): keep prompt/action/params intact.
  replaceImage: (img) => set({ image: img, cropOpen: false, menuOpen: false }),

  chooseAction: (id) => {
    const a = getAction(id);
    if (!a) return;
    set((s) => ({
      activeActionId: id,
      menuOpen: false,
      refImage: a.needsRef ? null : s.refImage,
      params: { ...s.params, prompt: a.buildPrompt(), aspectRatio: a.defaultAspect, count: a.defaultCount },
      results: null,
      resultIndex: 0,
      resultsOpen: false,
      error: null,
      phase: "idle",
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
    }),

  setRef: (dataUrl) => set({ refImage: dataUrl }),

  updateParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

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
    }),

  setResultIndex: (i) => set({ resultIndex: i }),
  openResults: () => set((s) => (s.results && s.results.length > 0 ? { resultsOpen: true } : {})),
  closeResults: () => set({ resultsOpen: false }),

  setSettings: (s) => set({ settings: s }),
  openSettings: () => set({ settingsOpen: true, historyOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen, settingsOpen: false })),
  setHistory: (h) => set({ history: h }),

  showToast: (kind, msg) => set({ toast: { id: toastSeq++, kind, msg } }),
  clearToast: () => set({ toast: null }),
}));
