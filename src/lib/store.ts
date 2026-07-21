"use client";

import { create } from "zustand";
import type { GenParams, HistoryItem, InpaintJob, InpaintMask, ModelName, PublicSettings, Resolution } from "./types";
import { getAction } from "./actions";
import { MAX_REF_IMAGES } from "./limits";

export interface PlacedImage {
  src: string;
  width: number;
  height: number;
}

export type Phase = "idle" | "submitting" | "running" | "success" | "error";
/** Top-level workspace switch (PLAN-BATCH D1/D2, PLAN-AGENT): "single" is the
 *  existing one-image canvas studio (Stage/GenerateBar/ResultView, all state
 *  below); "batch" is the batch workshop (BatchWorkshop/BatchBar, state lives
 *  in its own store — src/lib/batchStore.ts, same reasoning as logStore.ts);
 *  "agent" is the multimodal chat workspace (AgentPanel.tsx, state lives in
 *  its own store — src/lib/agentChatStore.ts); "templates" is the template
 *  library page (TemplateWorkshop.tsx, PLAN-TEMPLATE) — applying a template
 *  writes into this store's params and switches back to "single"; "video" is
 *  the video workshop (VideoWorkshop.tsx, PLAN-VIDEO, state lives in
 *  src/lib/videoStore.ts); "history" is the shared generation history page
 *  (HistoryPage.tsx) — image and video results alike (was a slide-out rail
 *  toggled independently of workMode; promoted to its own nav tab so it no
 *  longer needs a mutual-exclusion dance with the settings/diagnostics
 *  overlays). Kept here rather than in each mode's own store since it's a
 *  low-frequency toggle that both Studio.tsx's top bar and the batch store's
 *  Studio-image-handoff effect need to read, and putting it here avoids those
 *  stores having to import from Studio.tsx. "board" is the free-form infinite
 *  board workspace（画布，PLAN-BOARD — BoardWorkshop.tsx, state lives in
 *  src/lib/boardStore.ts）; mode switching moved from the header Segmented to
 *  the global left SideNav.tsx, same discriminant. */
export type WorkMode = "single" | "task" | "batch" | "agent" | "templates" | "video" | "history" | "board";

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
  quality: "auto",
};

interface StudioState {
  workMode: WorkMode;

  image: PlacedImage | null;
  menuOpen: boolean;
  cropOpen: boolean;
  brushPanelOpen: boolean;
  stickerOpen: boolean;

  activeActionId: string | null;
  /** Multi-reference-image state (PLAN-MULTI-REF), one array shared by two
   *  modes: a preset action with needsRef caps this at 1 (interaction copy
   *  unchanged from the old single-ref flow — see RefSlot.tsx's PresetRefBox);
   *  free mode (no action chosen) allows up to MAX_REF_IMAGES, each shown with
   *  an index+2 badge ("图 2 / 图 3…") matching actions.ts's "the Nth image"
   *  prompt-wording convention. Index 0 is always the first reference image
   *  regardless of mode — the canvas/base image itself is never stored here. */
  refImages: string[];
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
  /** The visionRequestId whose analysis has already finished (or failed).
   *  GenerateBar's effect only starts a fetch while visionRequestId is ahead
   *  of this — without it, loading a workspace snapshot (multi-canvas tab
   *  switch) whose action is still 视觉反推 would re-trigger a fresh analysis
   *  on every switch-back and clobber the user's edited prompt. Side effect
   *  (deliberate): cropping the canvas while a completed 视觉反推 is active no
   *  longer silently re-analyzes — re-click the action to re-run instead. */
  visionCompletedRequestId: number;

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
  history: HistoryItem[];
  toast: ToastMsg | null;

  setImage: (img: PlacedImage | null) => void;
  setWorkMode: (m: WorkMode) => void;
  openMenu: () => void;
  closeMenu: () => void;
  openCrop: () => void;
  closeCrop: () => void;
  /** Open the brush panel. Pass true when adjusting the current brush-driven
   *  action; the default opens plain local repaint and drops any AI action. */
  openBrushPanel: (preserveBrushAction?: boolean) => void;
  closeBrushPanel: () => void;
  openSticker: () => void;
  closeSticker: () => void;
  setInpaintMask: (m: InpaintMask) => void;
  setInpaintJob: (j: InpaintJob) => void;
  clearInpaint: () => void;
  replaceImage: (img: PlacedImage) => void;
  chooseAction: (id: string) => void;
  cancelAction: () => void;
  /** Append data URLs to refImages, capped at MAX_REF_IMAGES (silent slice —
   *  callers that need to tell the user some were dropped, e.g. RefSlot.tsx/
   *  Stage.tsx, must check the count themselves before calling this). */
  addRefs: (dataUrls: string[]) => void;
  /** No-op if index is out of range. */
  removeRef: (index: number) => void;
  /** No-op if index is out of range. */
  replaceRef: (index: number, dataUrl: string) => void;
  /** Swap with the neighbor in direction dir; no-op at either boundary. */
  moveRef: (index: number, dir: -1 | 1) => void;
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
  setHistory: (h: HistoryItem[]) => void;

  showToast: (kind: ToastMsg["kind"], msg: string) => void;
  clearToast: () => void;
}

let toastSeq = 1;

export const useStudio = create<StudioState>((set, get) => ({
  workMode: "single",

  image: null,
  menuOpen: false,
  cropOpen: false,
  brushPanelOpen: false,
  stickerOpen: false,

  activeActionId: null,
  refImages: [],
  inpaintMask: null,
  inpaintJob: null,
  analyzingVision: false,
  visionProgress: 0,
  visionStartedAt: null,
  visionError: null,
  visionRequestId: 0,
  visionCompletedRequestId: 0,

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
  history: [],
  toast: null,

  setImage: (img) =>
    set((s) => ({
      image: img,
      menuOpen: false,
      activeActionId: null,
      refImages: [],
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

  setWorkMode: (m) => set({ workMode: m }),

  openMenu: () => set((s) => (s.image ? { menuOpen: true } : {})),
  closeMenu: () => set({ menuOpen: false }),

  openCrop: () => set((s) => (s.image ? { cropOpen: true, menuOpen: false } : {})),
  closeCrop: () => set({ cropOpen: false }),
  // Manual local repaint clears any regular AI action. A brush-driven action
  // (物品移除) stays active when its selection is reopened for adjustment.
  openBrushPanel: (preserveBrushAction = false) =>
    set((s) => {
      if (!s.image) return {};
      const action = getAction(s.activeActionId);
      return preserveBrushAction && action?.usesBrush
        ? { brushPanelOpen: true, menuOpen: false }
        : {
            brushPanelOpen: true,
            menuOpen: false,
            activeActionId: null,
            refImages: [],
            ...(action?.usesBrush
              ? {
                  inpaintMask: null,
                  inpaintJob: null,
                  params: { ...s.params, prompt: "" },
                }
              : {}),
          };
    }),
  closeBrushPanel: () =>
    set((s) => {
      const action = getAction(s.activeActionId);
      // Cancelling the first required selection cancels the action too. Clear
      // its specialized prompt so it cannot be submitted against the full image.
      if (action?.usesBrush && !s.inpaintMask) {
        return {
          brushPanelOpen: false,
          activeActionId: null,
          params: { ...s.params, prompt: "" },
        };
      }
      return { brushPanelOpen: false };
    }),
  openSticker: () => set((s) => (s.image ? { stickerOpen: true, menuOpen: false } : {})),
  closeSticker: () => set({ stickerOpen: false }),
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
      brushPanelOpen: !!a.usesBrush,
      // D4 (PLAN-MULTI-REF): any preset action selection clears free-mode refs
      // outright, regardless of whether this action itself needsRef — this
      // also closes the old hazard where a leftover refImage from a previous
      // needsRef action could silently leak into an unrelated action's
      // generation (e.g. 白底图), since the server only gates on textOnly.
      refImages: [],
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
    set((s) => ({
      activeActionId: null,
      brushPanelOpen: false,
      refImages: [],
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
      // A mask-required prompt is unsafe without its selection. Other action
      // prompts keep the established behavior and remain editable in free mode.
      params: getAction(s.activeActionId)?.usesBrush ? { ...s.params, prompt: "" } : s.params,
    })),

  addRefs: (dataUrls) =>
    set((s) => ({ refImages: [...s.refImages, ...dataUrls].slice(0, MAX_REF_IMAGES) })),
  removeRef: (index) =>
    set((s) => ({ refImages: s.refImages.filter((_, i) => i !== index) })),
  replaceRef: (index, dataUrl) =>
    set((s) => ({ refImages: s.refImages.map((r, i) => (i === index ? dataUrl : r)) })),
  moveRef: (index, dir) =>
    set((s) => {
      const j = index + dir;
      if (index < 0 || index >= s.refImages.length || j < 0 || j >= s.refImages.length) return {};
      const next = [...s.refImages];
      [next[index], next[j]] = [next[j], next[index]];
      return { refImages: next };
    }),

  updateParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  beginVisionAnalysis: () => set({ analyzingVision: true, visionProgress: 0, visionStartedAt: Date.now(), visionError: null }),
  setVisionProgress: (n) => set({ visionProgress: n }),
  finishVisionAnalysis: () =>
    set((s) => ({
      analyzingVision: false,
      visionProgress: 1,
      visionStartedAt: null,
      visionCompletedRequestId: s.visionRequestId,
    })),
  failVisionAnalysis: (msg) =>
    set((s) => ({
      analyzingVision: false,
      visionProgress: 0,
      visionStartedAt: null,
      visionError: msg,
      // A failed request also counts as handled: retry is an explicit
      // re-click of the action (chooseAction bumps visionRequestId), not a
      // silent re-fire on the next tab switch-back.
      visionCompletedRequestId: s.visionRequestId,
    })),

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
    set((s) => ({
      image: img,
      results: null,
      resultIndex: 0,
      resultsOpen: false,
      phase: "idle",
      activeActionId: null,
      refImages: [],
      menuOpen: false,
      inpaintMask: null,
      inpaintJob: null,
      // Brush-action prompts describe a cropped selection and are unsafe once
      // the composite becomes a fresh full canvas with no matching mask.
      params: getAction(s.activeActionId)?.usesBrush ? { ...s.params, prompt: "" } : s.params,
    })),

  setResultIndex: (i) => set({ resultIndex: i }),
  openResults: () => set((s) => (s.results && s.results.length > 0 ? { resultsOpen: true } : {})),
  closeResults: () => set({ resultsOpen: false }),

  setSettings: (s) => set({ settings: s }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setHistory: (h) => set({ history: h }),

  showToast: (kind, msg) => set({ toast: { id: toastSeq++, kind, msg } }),
  clearToast: () => set({ toast: null }),
}));
