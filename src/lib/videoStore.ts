"use client";

// 视频创作 Store（PLAN-VIDEO）：独立 Zustand，与图片工作台 useStudio 完全解耦。
// 架构与 batchStore / agentChatStore 一致：状态不需要和单图/批量/Agent 模式共享，
// 单独拆出来，VideoWorkshop 卸载时后台轮询不受影响（引用 store 而不是 React state）。

import { create } from "zustand";
import {
  allowedVideoDurations,
  allowedVideoResolutions,
  isSeedanceModel,
  maxReferenceImages,
  maxReferenceVideos,
  supportsShots,
} from "./videoGateway";
import type { AspectRatio, ShotSegment, VideoHistoryItem, VideoModel, VideoReferType, VideoResolution } from "./videoTypes";

export type VideoPhase = "idle" | "uploading" | "submitting" | "running" | "success" | "error";

/** v3-omni 的图片输入方式：refs=多图参考（默认，image_list 全部无 type）；
 *  frames=首尾帧（first_frame/end_frame）。v3 / v2-6 只有首尾帧一种，忽略此值。 */
export type FrameMode = "refs" | "frames";

export type LocalImageAsset = { previewUrl: string; file: File };
export type LocalVideoAsset = { previewUrl: string; file: File; duration: number | null };

function revokePreview(url: string | undefined) {
  if (url && typeof URL !== "undefined") URL.revokeObjectURL(url);
}

const DEFAULT_MODEL: VideoModel = "seedance-2.0";
const DEFAULT_MODE: VideoResolution = "720p";
const DEFAULT_RATIO: AspectRatio  = "智能";

export interface VideoState {
  // ── 参数 ──────────────────────────────────────────────────────────
  model:          VideoModel;
  mode:           VideoResolution;
  duration:       number;        // 秒，3-15
  prompt:         string;
  negativePrompt: string;
  sound:          boolean;
  watermark:      boolean;
  webSearch:      boolean;
  /** Seedance：锁定镜头（camera_fixed，静态视角，不运镜）。 */
  cameraFixed:    boolean;
  /** Seedance：随机种子输入框原文（空串 = 不传 seed）。 */
  seedText:       string;
  aspectRatio:    AspectRatio;
  /** 可灵 v3-omni 参考视频用途（feature=视频参考；base=视频编辑）。 */
  referType:      VideoReferType;
  /** 可灵 v3-omni 参考视频是否保留原声（默认 false）。 */
  keepOriginalSound: boolean;
  // 多段分镜
  shotsEnabled:   boolean;
  shots:          ShotSegment[];
  // 输入图
  /** v3-omni 图片输入方式（refs 默认；v3/v2-6 恒为 frames 语义）。 */
  frameMode:      FrameMode;
  /** 起始帧：{ dataUrl, file } */
  startFrame:     LocalImageAsset | null;
  /** 尾帧（可选）*/
  tailFrame:      LocalImageAsset | null;
  /** v3-omni 多图参考（官方约束：无参考视频时图片总数 ≤7）*/
  refImages:      LocalImageAsset[];
  /** Seedance 多模态参考视频（最多 3 个）。 */
  refVideos:      LocalVideoAsset[];
  /** Seedance 多模态参考音频（最多 3 段）。 */
  refAudios:      LocalVideoAsset[];

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
  setModel:        (m: VideoModel) => void;
  setMode:         (m: VideoResolution) => void;
  setDuration:     (n: number) => void;
  setPrompt:       (s: string) => void;
  setNegPrompt:    (s: string) => void;
  setSound:        (b: boolean) => void;
  setWatermark:    (b: boolean) => void;
  setWebSearch:    (b: boolean) => void;
  setCameraFixed:  (b: boolean) => void;
  setSeedText:     (s: string) => void;
  setAspectRatio:  (r: AspectRatio) => void;
  setReferType:    (t: VideoReferType) => void;
  setKeepOriginalSound: (b: boolean) => void;
  toggleShots:     () => void;
  setShots:        (shots: ShotSegment[]) => void;
  setFrameMode:    (m: FrameMode) => void;
  setStartFrame:   (f: LocalImageAsset | null) => void;
  setTailFrame:    (f: LocalImageAsset | null) => void;
  addRefImage:     (f: LocalImageAsset) => string | null;
  removeRefImage:  (index: number) => void;
  addRefVideo:     (f: LocalVideoAsset) => string | null;
  removeRefVideo:  (index: number) => void;
  /** 用裁剪结果替换第 index 个参考视频（revoke 旧 preview）。返回错误信息或 null。 */
  replaceRefVideo: (index: number, f: LocalVideoAsset) => string | null;
  addRefAudio:     (f: LocalVideoAsset) => string | null;
  removeRefAudio:  (index: number) => void;
  clearMediaInputs: () => void;

  beginUpload:     () => void;
  beginSubmit:     () => void;
  setRunning:      (taskId: string) => void;
  setProgress:     (n: number) => void;
  setSuccess:      (videoUrl: string, blobUrl: string) => void;
  setError:        (msg: string) => void;
  resetTask:       () => void;
  playHistory:     (item: VideoHistoryItem) => void;
}

export const useVideoStore = create<VideoState>((set, get) => ({
  model:          DEFAULT_MODEL,
  mode:           DEFAULT_MODE,
  duration:       5,
  prompt:         "",
  negativePrompt: "",
  sound:          false,
  watermark:      false,
  webSearch:      false,
  cameraFixed:    false,
  seedText:       "",
  aspectRatio:    DEFAULT_RATIO,
  referType:      "feature",
  keepOriginalSound: false,
  shotsEnabled:   false,
  shots:          [],
  frameMode:      "refs",
  startFrame:     null,
  tailFrame:      null,
  refImages:      [],
  refVideos:      [],
  refAudios:      [],

  phase:    "idle",
  progress: 0,
  taskId:   null,
  error:    null,
  videoUrl: null,
  blobUrl:  null,

  setModel:       (m) => set((s) => ({
    model: m,
    duration: allowedVideoDurations(m).includes(s.duration) ? s.duration : 5,
    mode: allowedVideoResolutions(m).includes(s.mode) ? s.mode : "720p",
    shotsEnabled: supportsShots(m) ? s.shotsEnabled : false,
    aspectRatio: isSeedanceModel(m) && !isSeedanceModel(s.model)
      ? "智能"
      : m === "v3-omni" && !["智能", "16:9", "9:16", "1:1"].includes(s.aspectRatio)
        ? "9:16"
        : s.aspectRatio,
    refImages: (() => {
      const max = maxReferenceImages(m);
      s.refImages.slice(max).forEach((item) => revokePreview(item.previewUrl));
      return s.refImages.slice(0, max);
    })(),
    refVideos: (() => {
      // 切模型时按新模型的参考视频上限裁剪（Seedance 3 → omni 1），回收多余预览。
      const max = maxReferenceVideos(m);
      s.refVideos.slice(max).forEach((item) => revokePreview(item.previewUrl));
      return s.refVideos.slice(0, max);
    })(),
  })),
  setMode:        (m) => set({ mode: m }),
  setDuration:    (n) => set({ duration: n }),
  setPrompt:      (s) => set({ prompt: s }),
  setNegPrompt:   (s) => set({ negativePrompt: s }),
  setSound:       (b) => set({ sound: b }),
  setWatermark:   (b) => set({ watermark: b }),
  setWebSearch:   (b) => set({ webSearch: b }),
  setCameraFixed: (b) => set({ cameraFixed: b }),
  // 只允许数字字符，避免提交时才报「种子必须是整数」。
  setSeedText:    (s) => set({ seedText: s.replace(/[^\d]/g, "").slice(0, 10) }),
  setAspectRatio: (r) => set({ aspectRatio: r }),
  setReferType:   (t) => set({ referType: t }),
  setKeepOriginalSound: (b) => set({ keepOriginalSound: b }),
  toggleShots:    () => set((s) => {
    if (!supportsShots(s.model)) return { shotsEnabled: false };
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
  setFrameMode:   (m) => set((s) => ({
    frameMode: m,
    aspectRatio: m === "refs" && !isSeedanceModel(s.model) ? "9:16" : "智能",
  })),
  setStartFrame:  (f) => set((s) => {
    if (s.startFrame?.previewUrl !== f?.previewUrl) revokePreview(s.startFrame?.previewUrl);
    return { startFrame: f };
  }),
  setTailFrame:   (f) => set((s) => {
    if (s.tailFrame?.previewUrl !== f?.previewUrl) revokePreview(s.tailFrame?.previewUrl);
    return { tailFrame: f };
  }),
  addRefImage:    (f) => {
    const state = get();
    if (state.refImages.length >= maxReferenceImages(state.model)) return `参考图最多 ${maxReferenceImages(state.model)} 张`;
    set({ refImages: [...state.refImages, f] });
    return null;
  },
  removeRefImage: (i) => set((s) => {
    revokePreview(s.refImages[i]?.previewUrl);
    return { refImages: s.refImages.filter((_, idx) => idx !== i) };
  }),
  // 超长视频也允许进列表（用户用卡片上的裁剪按钮自行裁到需要的时长），
  // 时长合规性（单段 2-15s、总长 ≤15s）在提交时统一校验。
  addRefVideo:    (f) => {
    const state = get();
    const max = maxReferenceVideos(state.model);
    if (max === 0) return "当前模型不支持参考视频";
    if (state.refVideos.length >= max) return `参考视频最多 ${max} 个`;
    set({ refVideos: [...state.refVideos, f] });
    return null;
  },
  removeRefVideo: (i) => set((s) => {
    revokePreview(s.refVideos[i]?.previewUrl);
    return { refVideos: s.refVideos.filter((_, idx) => idx !== i) };
  }),
  replaceRefVideo: (i, f) => {
    const state = get();
    if (!state.refVideos[i]) return "参考视频不存在";
    revokePreview(state.refVideos[i].previewUrl);
    set({ refVideos: state.refVideos.map((item, idx) => (idx === i ? f : item)) });
    return null;
  },
  addRefAudio:    (f) => {
    const state = get();
    if (state.refAudios.length >= 3) return "参考音频最多 3 段";
    const total = [...state.refAudios, f].reduce((sum, item) => sum + (item.duration ?? 0), 0);
    if (total > 15.05) return "所有参考音频总时长不能超过 15 秒";
    set({ refAudios: [...state.refAudios, f] });
    return null;
  },
  removeRefAudio: (i) => set((s) => {
    revokePreview(s.refAudios[i]?.previewUrl);
    return { refAudios: s.refAudios.filter((_, idx) => idx !== i) };
  }),
  clearMediaInputs: () => set((s) => {
    revokePreview(s.startFrame?.previewUrl);
    revokePreview(s.tailFrame?.previewUrl);
    [...s.refImages, ...s.refVideos, ...s.refAudios].forEach((item) => revokePreview(item.previewUrl));
    return { startFrame: null, tailFrame: null, refImages: [], refVideos: [], refAudios: [] };
  }),

  beginUpload:  () => set({ phase: "uploading", progress: 0, error: null, videoUrl: null, blobUrl: null }),
  beginSubmit:  () => set({ phase: "submitting", progress: 0 }),
  setRunning:   (taskId) => set({ phase: "running", taskId, progress: 0 }),
  setProgress:  (n) => set({ progress: n }),
  setSuccess:   (videoUrl, blobUrl) => set({ phase: "success", videoUrl, blobUrl, progress: 100 }),
  setError:     (msg) => set({ phase: "error", error: msg }),
  resetTask:    () => set({ phase: "idle", progress: 0, taskId: null, error: null }),
  playHistory:  (item) => set({ phase: "success", videoUrl: item.videoUrl, blobUrl: item.blobUrl ?? null, progress: 100, taskId: item.taskId }),
}));
