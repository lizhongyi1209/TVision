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
  model: "Nano Banana Pro",
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
  uploadOpen: boolean;
  refImage: string | null;

  params: GenParams;

  phase: Phase;
  progress: number;
  jobIds: string[];
  results: string[] | null;
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
  openUpload: () => void;
  closeUpload: () => void;
  setRef: (dataUrl: string | null) => void;
  updateParams: (p: Partial<GenParams>) => void;

  setJobIds: (ids: string[]) => void;
  beginSubmit: () => void;
  setPhase: (p: Phase) => void;
  setProgress: (n: number) => void;
  setResults: (r: string[] | null) => void;
  setError: (e: string | null) => void;
  dismissResults: () => void;
  useResultAsCanvas: (img: PlacedImage) => void;

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
  uploadOpen: false,
  refImage: null,

  params: { ...DEFAULT_PARAMS },

  phase: "idle",
  progress: 0,
  jobIds: [],
  results: null,
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
      uploadOpen: false,
      refImage: null,
      results: null,
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
      uploadOpen: a.needsRef,
      refImage: a.needsRef ? null : s.refImage,
      params: { ...s.params, prompt: a.buildPrompt(), aspectRatio: a.defaultAspect, count: a.defaultCount },
      results: null,
      error: null,
      phase: "idle",
    }));
  },

  cancelAction: () =>
    set({ activeActionId: null, uploadOpen: false, refImage: null, results: null, error: null, phase: "idle" }),

  openUpload: () => set({ uploadOpen: true }),
  closeUpload: () => set({ uploadOpen: false }),
  setRef: (dataUrl) => set({ refImage: dataUrl, uploadOpen: false }),

  updateParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

  setJobIds: (ids) => set({ jobIds: ids }),
  beginSubmit: () => set({ phase: "submitting", error: null, results: null, progress: 0 }),
  setPhase: (p) => set({ phase: p }),
  setProgress: (n) => set({ progress: n }),
  setResults: (r) => set({ results: r }),
  setError: (e) => set({ error: e }),
  dismissResults: () => set({ results: null, phase: "idle" }),

  useResultAsCanvas: (img) =>
    set({
      image: img,
      results: null,
      phase: "idle",
      activeActionId: null,
      uploadOpen: false,
      refImage: null,
      menuOpen: false,
    }),

  setSettings: (s) => set({ settings: s }),
  openSettings: () => set({ settingsOpen: true, historyOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen, settingsOpen: false })),
  setHistory: (h) => set({ history: h }),

  showToast: (kind, msg) => set({ toast: { id: toastSeq++, kind, msg } }),
  clearToast: () => set({ toast: null }),
}));
