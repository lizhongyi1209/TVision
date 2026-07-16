"use client";

// 视频创作 Store（PLAN-VIDEO）：独立 Zustand，与图片工作台 useStudio 完全解耦。
// 架构与 batchStore / agentChatStore 一致：状态不需要和单图/批量/Agent 模式共享，
// 单独拆出来，VideoWorkshop 卸载时后台轮询不受影响（引用 store 而不是 React state）。

import { create } from "zustand";
import type { KlingModel, KlingMode, AspectRatio, ShotSegment, VideoHistoryItem } from "./videoTypes";

export type VideoPhase = "idle" | "uploading" | "submitting" | "running" | "success" | "error";

/** v3-omni 的图片输入方式：refs=多图参考（默认，image_list 全部无 type）；
 *  frames=首尾帧（first_frame/end_frame）。v3 / v2-6 只有首尾帧一种，忽略此值。 */
export type FrameMode = "refs" | "frames";

const DEFAULT_MODEL: KlingModel   = "v3";
const DEFAULT_MODE: KlingMode     = "720p";
// frameMode 初始为 "refs"（多图参考），宽高比默认须与之配套（智能会被拦截）
const DEFAULT_RATIO: AspectRatio  = "9:16";

export interface VideoState {
  // ── 参数 ──────────────────────────────────────────────────────────
  model:          KlingModel;
  mode:           KlingMode;
  duration:       number;        // 秒，3-15
  prompt:         string;
  negativePrompt: string;
  sound:          boolean;
  aspectRatio:    AspectRatio;
  // 多段分镜
  shotsEnabled:   boolean;
  shots:          ShotSegment[];
  // 输入图
  /** v3-omni 图片输入方式（refs 默认；v3/v2-6 恒为 frames 语义）。 */
  frameMode:      FrameMode;
  /** 起始帧：{ dataUrl, file } */
  startFrame:     { dataUrl: string; file: File } | null;
  /** 尾帧（可选）*/
  tailFrame:      { dataUrl: string; file: File } | null;
  /** v3-omni 多图参考（官方约束：无参考视频时图片总数 ≤7）*/
  refImages:      { dataUrl: string; file: File }[];

  // ── 任务状态 ──────────────────────────────────────────────────────
  phase:          VideoPhase;
  progress:       number;        // 0-100
  taskId:         string | null;
  error:          string | null;
  /** 当前生成结果 URL（直链）*/
  videoUrl:       string | null;
  /** 当前播放 blob URL（浏览器端缓存）*/
  blobUrl:        string | null;

  // ── 播放（从「历史生成」页回放）───────────────────────────────────────
  // 历史记录本身不在这个 store 里维护（视频和图片共用 HistoryPage.tsx +
  // /api/history，不再有独立的视频历史列表），这里只留 playHistory 把一条
  // 历史记录塞回播放器状态。

  // ── Actions ───────────────────────────────────────────────────────
  setModel:        (m: KlingModel) => void;
  setMode:         (m: KlingMode) => void;
  setDuration:     (n: number) => void;
  setPrompt:       (s: string) => void;
  setNegPrompt:    (s: string) => void;
  setSound:        (b: boolean) => void;
  setAspectRatio:  (r: AspectRatio) => void;
  toggleShots:     () => void;
  setShots:        (shots: ShotSegment[]) => void;
  setFrameMode:    (m: FrameMode) => void;
  setStartFrame:   (f: { dataUrl: string; file: File } | null) => void;
  setTailFrame:    (f: { dataUrl: string; file: File } | null) => void;
  addRefImage:     (f: { dataUrl: string; file: File }) => void;
  removeRefImage:  (index: number) => void;

  beginUpload:     () => void;
  beginSubmit:     () => void;
  setRunning:      (taskId: string) => void;
  setProgress:     (n: number) => void;
  setSuccess:      (videoUrl: string, blobUrl: string) => void;
  setError:        (msg: string) => void;
  resetTask:       () => void;
  playHistory:     (item: VideoHistoryItem) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  model:          DEFAULT_MODEL,
  mode:           DEFAULT_MODE,
  duration:       5,
  prompt:         "",
  negativePrompt: "",
  sound:          false,
  aspectRatio:    DEFAULT_RATIO,
  shotsEnabled:   false,
  shots:          [],
  frameMode:      "refs",
  startFrame:     null,
  tailFrame:      null,
  refImages:      [],

  phase:    "idle",
  progress: 0,
  taskId:   null,
  error:    null,
  videoUrl: null,
  blobUrl:  null,

  setModel:       (m) => set((s) => ({
    model: m,
    // v2-6 只支持 5/10s 和 720p/1080p
    duration: m === "v2-6" && ![5, 10].includes(s.duration) ? 5 : s.duration,
    mode:     m === "v2-6" && s.mode === "4K" ? "1080p" : s.mode,
    shotsEnabled: m === "v2-6" && s.shotsEnabled ? false : s.shotsEnabled,
  })),
  setMode:        (m) => set({ mode: m }),
  setDuration:    (n) => set({ duration: n }),
  setPrompt:      (s) => set({ prompt: s }),
  setNegPrompt:   (s) => set({ negativePrompt: s }),
  setSound:       (b) => set({ sound: b }),
  setAspectRatio: (r) => set({ aspectRatio: r }),
  toggleShots:    () => set((s) => {
    const next = !s.shotsEnabled;
    const defaultShots: ShotSegment[] =
      next && !s.shots.length
        ? [{ index: 1, prompt: "", duration: Math.ceil(s.duration / 2) },
           { index: 2, prompt: "", duration: Math.floor(s.duration / 2) }]
        : s.shots;
    return { shotsEnabled: next, shots: defaultShots };
  }),
  setShots:       (shots) => set({ shots }),
  // 切输入方式时联动宽高比默认值：多图参考无首帧可推断 →「智能」必报错，
  // 给个明确默认 9:16（竖版电商/短视频最常用）；首尾帧回到「智能」跟随首帧。
  setFrameMode:   (m) => set({ frameMode: m, aspectRatio: m === "refs" ? "9:16" : "智能" }),
  setStartFrame:  (f) => set({ startFrame: f }),
  setTailFrame:   (f) => set({ tailFrame: f }),
  addRefImage:    (f) => set((s) => ({ refImages: [...s.refImages, f].slice(0, 7) })),
  removeRefImage: (i) => set((s) => ({ refImages: s.refImages.filter((_, idx) => idx !== i) })),

  beginUpload:  () => set({ phase: "uploading", progress: 0, error: null, videoUrl: null, blobUrl: null }),
  beginSubmit:  () => set({ phase: "submitting", progress: 0 }),
  setRunning:   (taskId) => set({ phase: "running", taskId, progress: 0 }),
  setProgress:  (n) => set({ progress: n }),
  setSuccess:   (videoUrl, blobUrl) => set({ phase: "success", videoUrl, blobUrl, progress: 100 }),
  setError:     (msg) => set({ phase: "error", error: msg }),
  resetTask:    () => set({ phase: "idle", progress: 0, taskId: null, error: null }),
  playHistory:  (item) => set({ phase: "success", videoUrl: item.videoUrl, blobUrl: item.blobUrl ?? null, progress: 100, taskId: item.taskId }),
}));
