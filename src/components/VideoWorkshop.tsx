"use client";

// 视频创作工作台（PLAN-VIDEO）：
//  - 左栏：图片输入（v3/v2-6 首尾帧；v3-omni 默认多图参考，可切首尾帧）
//  - 中/右：视频播放器
//  - 底部：生成参数栏（VideoBar）
// 生成记录不再在此页维护单独列表：视频生成成功后照图片的做法存进 output/
// （见下方 /api/video/save 调用），统一在独立导航页「历史生成」
// （HistoryPage.tsx）里查看/播放/删除，图片和视频共用一套列表。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStudio } from "@/lib/store";
import { diag } from "@/lib/logStore";
import { useVideoStore, type FrameMode } from "@/lib/videoStore";
import { isSeedanceModel, maxReferenceImages, maxReferenceVideos, supportsReferenceMedia } from "@/lib/videoGateway";
import type { VideoReferType } from "@/lib/videoTypes";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Segmented } from "./ui";
import { VideoBar } from "./VideoBar";
import { VideoTrimPanel } from "./VideoTrimPanel";
import { FramePickPanel, type FrameTarget } from "./FramePickPanel";

const SUPPORTED_IMAGE_FILE = /\.(jpe?g|png|webp|bmp|tiff?|gif|heic|heif)$/i;

function isSupportedImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_FILE.test(file.name) || [
    "image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff",
    "image/gif", "image/heic", "image/heif",
  ].includes(file.type.toLowerCase());
}

// 参考视频规格：按模型分流。
//   Seedance（火山方舟）：≥2s、300-6000px、宽高比 0.4-2.5、单段 ≤200MB，最多 3 段，总长 ≤15s。
//   可灵 v3-omni（官方 omni-video）：3~15.5s、720-2160px、宽高比 0.4-2.5（1:2.5~2.5:1）、≤200MB，至多 1 段。
type RefVideoSpec = {
  minDuration: number;
  maxDuration: number;
  minSide: number;
  maxSide: number;
  minRatio: number;
  maxRatio: number;
  maxBytes: number;
};
const KLING_REF_VIDEO_SPEC: RefVideoSpec = {
  minDuration: 3, maxDuration: 15.5, minSide: 720, maxSide: 2160, minRatio: 0.4, maxRatio: 2.5, maxBytes: 200 * 1024 * 1024,
};
const SEEDANCE_REF_VIDEO_SPEC: RefVideoSpec = {
  minDuration: 2, maxDuration: 15.05, minSide: 300, maxSide: 6000, minRatio: 0.4, maxRatio: 2.5, maxBytes: 200 * 1024 * 1024,
};

// ─────────────────────────────────────────────────────────────────────────────
// 参考图添加按钮（小型，用于 v3-omni 参考图列表末尾）
// ─────────────────────────────────────────────────────────────────────────────

function AssetAddButton({
  onFile,
  accept,
  label,
  icon = "Plus",
}: {
  onFile: (f: File) => void;
  accept: string;
  label: string;
  icon?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-line-2 text-xs text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
      >
        <Icon name={icon} size={13} />
        {label}
      </button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame slot（起始帧 / 尾帧）
// ─────────────────────────────────────────────────────────────────────────────

function FrameSlot({
  label,
  sublabel,
  frame,
  onFile,
  onClear,
  optional = false,
}: {
  label: string;
  sublabel: string;
  frame: { previewUrl: string } | null;
  onFile: (f: File) => void;
  onClear: () => void;
  optional?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!isSupportedImageFile(f)) return;
    onFile(f);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-fg-mute">{label}</span>
        {optional && <span className="text-[10px] text-fg-mute/60">可选</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
      {frame ? (
        <div className="group relative overflow-hidden rounded-panel border border-line bg-panel-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frame.previewUrl} alt={label} className="block max-h-[44vh] w-full object-contain" />
          <div className="absolute inset-0 flex items-center justify-center bg-transparent opacity-100 transition-opacity md:bg-black/50 md:opacity-0 md:group-hover:opacity-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-full bg-white/10 p-2 text-fg hover:bg-white/20"
              title="更换"
            >
              <Icon name="ArrowClockwise" size={14} />
            </button>
            <button
              type="button"
              onClick={onClear}
              className="ml-2 rounded-full bg-white/10 p-2 text-fg hover:bg-white/20"
              title="移除"
            >
              <Icon name="X" size={14} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          className={cn(
            "flex h-[min(44vh,300px)] flex-col items-center justify-center gap-2 rounded-panel border border-dashed transition-all duration-300",
            drag ? "border-accent bg-accent/[0.06]" : "border-line-2 hover:border-fg-mute hover:bg-white/[0.02]",
          )}
        >
          <Icon name="ImageSquare" size={24} className="text-fg-dim" />
          <span className="text-xs text-fg-mute">{sublabel}</span>
        </button>
      )}
    </div>
  );
}

function ReferenceMediaSection({
  kind,
  items,
  max = 3,
  onAdd,
  onRemove,
  onTrim,
  onGrabFrame,
  children,
}: {
  kind: "video" | "audio";
  items: { previewUrl: string; file: File; duration: number | null }[];
  /** 数量上限（Seedance 视频/音频均为 3；可灵 v3-omni 视频为 1）。 */
  max?: number;
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  /** 仅视频：打开快速裁剪面板。 */
  onTrim?: (index: number) => void;
  /** 仅视频：打开取帧面板，提取首/尾帧作参考图。 */
  onGrabFrame?: (index: number) => void;
  /** 额外控件（如 v3-omni 的视频用途选择器），渲染在列表上方。 */
  children?: ReactNode;
}) {
  const isVideo = kind === "video";
  const label = isVideo ? "参考视频" : "参考音频";
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-fg-mute">{label}</span>
        <span className="text-[10px] text-fg-mute/60">最多 {max} 个</span>
      </div>
      {children}
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={`${item.file.name}-${index}`} className="group relative overflow-hidden rounded-control border border-line bg-panel-2">
            {isVideo ? (
              // 正方形卡片：视频 object-contain 居中，上下留黑边，四角有足够空间放按钮
              <video src={item.previewUrl} controls muted preload="metadata" className="block aspect-square w-full bg-black object-contain" />
            ) : (
              <div className="flex flex-col gap-2 px-2.5 pb-2.5 pt-8">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon name="FileAudio" size={15} className="shrink-0 text-accent" />
                  <span className="truncate text-[11px] text-fg-dim">{item.file.name}</span>
                </div>
                <audio src={item.previewUrl} controls preload="metadata" className="h-8 w-full" />
              </div>
            )}
            <span className={cn(
              "absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px]",
              isVideo && (item.duration ?? 0) > 15.05
                ? "bg-red-500/80 text-white"
                : "bg-black/70 text-fg",
            )}>
              {isVideo ? "视频" : "音频"} {index + 1}{item.duration == null ? "" : ` · ${item.duration.toFixed(1)}s`}
              {isVideo && (item.duration ?? 0) > 15.05 ? " · 需裁剪" : ""}
            </span>
            <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5">
              {isVideo && onGrabFrame && (
                <button
                  type="button"
                  onClick={() => onGrabFrame(index)}
                  className="flex h-6 items-center gap-1 rounded-full bg-black/70 px-2 text-[10px] text-fg transition-colors hover:bg-accent/80 hover:text-white"
                  title="提取首/尾帧作参考图"
                >
                  <Icon name="FilmStrip" size={11} />
                  取帧
                </button>
              )}
              {isVideo && onTrim && (
                <button
                  type="button"
                  onClick={() => onTrim(index)}
                  className="flex h-6 items-center gap-1 rounded-full bg-black/70 px-2 text-[10px] text-fg transition-colors hover:bg-accent/80 hover:text-white"
                  title="裁剪时长"
                >
                  <Icon name="Scissors" size={11} />
                  裁剪
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-fg-dim transition-colors hover:text-red-300"
                title={`移除${label}`}
              >
                <Icon name="X" size={11} />
              </button>
            </div>
          </div>
        ))}
        {items.length < max && (
          <AssetAddButton
            onFile={onAdd}
            accept={isVideo ? "video/mp4,video/quicktime,.mp4,.mov" : "audio/wav,audio/mpeg,.wav,.mp3"}
            label={`添加${label}`}
            icon={isVideo ? "FileVideo" : "FileAudio"}
          />
        )}
      </div>
    </section>
  );
}

function readMediaMetadata(previewUrl: string, kind: "video" | "audio"): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const media = document.createElement(kind);
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      media.onloadedmetadata = null;
      media.onerror = null;
    };
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("读取素材信息超时"));
    }, 10_000);
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const video = media as HTMLVideoElement;
      cleanup();
      resolve({
        duration: media.duration,
        width: kind === "video" ? video.videoWidth : 0,
        height: kind === "video" ? video.videoHeight : 0,
      });
    };
    media.onerror = () => {
      cleanup();
      reject(new Error("无法读取素材信息"));
    };
    media.src = previewUrl;
  });
}

function readImageMetadata(previewUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
    };
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("读取图片信息超时"));
    }, 10_000);
    image.onload = () => {
      cleanup();
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("无法读取图片信息"));
    };
    image.src = previewUrl;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Video Player
// ─────────────────────────────────────────────────────────────────────────────

function VideoPlayer({ blobUrl, videoUrl, progress, phase }: {
  blobUrl:  string | null;
  videoUrl: string | null;
  progress: number;
  phase:    string;
}) {
  const src = blobUrl ?? videoUrl;
  const running  = phase === "running" || phase === "uploading" || phase === "submitting";
  const hasVideo = phase === "success" && !!src;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon name="PlayCircle" size={16} className="text-accent" />
        <span className="text-sm font-medium text-fg">预览</span>
      </div>
      <div className="relative overflow-hidden rounded-panel border border-line bg-black aspect-video">
        {hasVideo ? (
          <video
            key={src!}
            src={src!}
            controls
            autoPlay
            className="h-full w-full object-contain"
          />
        ) : running ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Icon name="CircleNotch" size={28} className="animate-spin text-accent" />
            <div className="w-48">
              <div className="h-1 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  animate={{ width: `${Math.max(progress, 5)}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
            <span className="text-xs text-fg-mute">
              {phase === "uploading" ? "上传素材中…" : phase === "submitting" ? "提交任务…" : `生成中 ${progress}%`}
            </span>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-dim">
            <Icon name="FilmStrip" size={32} />
            <span className="text-xs text-fg-mute">生成后在此预览</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App-level poller. Studio mounts this once so navigation cannot orphan a paid task.
// ─────────────────────────────────────────────────────────────────────────────

export function VideoTaskPoller() {
  const showToast = useStudio((s) => s.showToast);
  const phase = useVideoStore((s) => s.phase);
  const taskId = useVideoStore((s) => s.taskId);
  const model = useVideoStore((s) => s.model);
  const mode = useVideoStore((s) => s.mode);
  const duration = useVideoStore((s) => s.duration);
  const prompt = useVideoStore((s) => s.prompt);
  const negPrompt = useVideoStore((s) => s.negativePrompt);
  const shotsEnabled = useVideoStore((s) => s.shotsEnabled);
  const shots = useVideoStore((s) => s.shots);
  const sound = useVideoStore((s) => s.sound);
  const watermark = useVideoStore((s) => s.watermark);
  const webSearch = useVideoStore((s) => s.webSearch);
  const cameraFixed = useVideoStore((s) => s.cameraFixed);
  const seedText = useVideoStore((s) => s.seedText);
  const aspectRatio = useVideoStore((s) => s.aspectRatio);
  const frameMode = useVideoStore((s) => s.frameMode);
  const setProgress = useVideoStore((s) => s.setProgress);
  const setSuccess = useVideoStore((s) => s.setSuccess);
  const setError = useVideoStore((s) => s.setError);

  useEffect(() => {
    if (phase !== "running" || !taskId) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const delay = attempts <= 5 ? 3000 : Math.min(3000 * 1.4 ** (attempts - 5), 10_000);
      timer = setTimeout(poll, delay);
    };

    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const response = await fetch(`/api/video/jobs/${encodeURIComponent(taskId)}`);
        const res = await response.json().catch(() => ({}));
        if (res.status === "success") {
          let playUrl = res.videoUrl;
          try {
            const saved = await fetch("/api/video/save", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                videoUrl: res.videoUrl,
                taskId,
                meta: {
                  taskId,
                  model,
                  mode,
                  duration,
                  prompt: shotsEnabled ? "" : prompt,
                  negativePrompt: negPrompt,
                  shots: shotsEnabled ? shots : [],
                  sound,
                  watermark,
                  webSearch,
                  cameraFixed,
                  seed: seedText ? Number(seedText) : undefined,
                  aspectRatio,
                  frameMode,
                  createdAt: Date.now(),
                },
              }),
            }).then((result) => result.json());
            if (saved.localUrl) playUrl = saved.localUrl;
            if (saved.error) diag("warn", "视频轮询", "结果保存到 output 失败，仅远端直链可用", String(saved.error));
          } catch (e) {
            /* 保存失败仍可播放远端直链 */
            diag("warn", "视频轮询", "结果保存请求失败，仅远端直链可用", (e as Error)?.message || String(e));
          }
          if (cancelled) return;
          setSuccess(res.videoUrl, playUrl);
          diag("info", "视频轮询", "生成完成", `任务 ID: ${taskId}\n视频 URL: ${res.videoUrl}`);
          showToast("success", "视频生成完成，已保存到 output 目录，可在「资产」中查看");
          return;
        }
        if (res.status === "failed") {
          if (cancelled) return;
          setError(res.error ?? "生成失败");
          diag("error", "视频轮询", "生成失败", `任务 ID: ${taskId}\n${res.error ?? "生成失败"}`);
          showToast("error", res.error ?? "视频生成失败");
          return;
        }
        setProgress(res.progress ?? 0);
      } catch (e) {
        // 短暂网络故障保持任务状态，下轮继续。
        diag("warn", "视频轮询", "状态查询失败，下轮重试", `任务 ID: ${taskId}\n${(e as Error)?.message || String(e)}`);
      }
      if (!cancelled) schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    phase, taskId, model, mode, duration, prompt, negPrompt, shotsEnabled, shots,
    sound, watermark, webSearch, cameraFixed, seedText, aspectRatio, frameMode,
    setProgress, setSuccess, setError, showToast,
  ]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main VideoWorkshop
// ─────────────────────────────────────────────────────────────────────────────

export function VideoWorkshop() {
  const showToast    = useStudio((s) => s.showToast);
  const openSettings = useStudio((s) => s.openSettings);
  const settings     = useStudio((s) => s.settings);

  const phase      = useVideoStore((s) => s.phase);
  const progress   = useVideoStore((s) => s.progress);
  const videoUrl   = useVideoStore((s) => s.videoUrl);
  const blobUrl    = useVideoStore((s) => s.blobUrl);
  const error      = useVideoStore((s) => s.error);
  const model      = useVideoStore((s) => s.model);
  const mode       = useVideoStore((s) => s.mode);
  const duration   = useVideoStore((s) => s.duration);
  const prompt     = useVideoStore((s) => s.prompt);
  const negPrompt  = useVideoStore((s) => s.negativePrompt);
  const sound      = useVideoStore((s) => s.sound);
  const watermark  = useVideoStore((s) => s.watermark);
  const webSearch  = useVideoStore((s) => s.webSearch);
  const cameraFixed = useVideoStore((s) => s.cameraFixed);
  const seedText   = useVideoStore((s) => s.seedText);
  const aspectRatio = useVideoStore((s) => s.aspectRatio);
  const shotsEnabled = useVideoStore((s) => s.shotsEnabled);
  const shots      = useVideoStore((s) => s.shots);
  const startFrame = useVideoStore((s) => s.startFrame);
  const tailFrame  = useVideoStore((s) => s.tailFrame);

  const refImages     = useVideoStore((s) => s.refImages);
  const refVideos     = useVideoStore((s) => s.refVideos);
  const refAudios     = useVideoStore((s) => s.refAudios);
  const referType     = useVideoStore((s) => s.referType);
  const setReferType  = useVideoStore((s) => s.setReferType);
  const keepOriginalSound = useVideoStore((s) => s.keepOriginalSound);
  const setKeepOriginalSound = useVideoStore((s) => s.setKeepOriginalSound);
  const frameMode     = useVideoStore((s) => s.frameMode);
  const setFrameMode  = useVideoStore((s) => s.setFrameMode);
  const setStartFrame = useVideoStore((s) => s.setStartFrame);
  const setTailFrame  = useVideoStore((s) => s.setTailFrame);
  const addRefImage   = useVideoStore((s) => s.addRefImage);
  const removeRefImage = useVideoStore((s) => s.removeRefImage);
  const addRefVideo   = useVideoStore((s) => s.addRefVideo);
  const removeRefVideo = useVideoStore((s) => s.removeRefVideo);
  const replaceRefVideo = useVideoStore((s) => s.replaceRefVideo);
  const addRefAudio   = useVideoStore((s) => s.addRefAudio);
  const removeRefAudio = useVideoStore((s) => s.removeRefAudio);
  const beginUpload   = useVideoStore((s) => s.beginUpload);
  const beginSubmit   = useVideoStore((s) => s.beginSubmit);
  const setRunning    = useVideoStore((s) => s.setRunning);
  const setError      = useVideoStore((s) => s.setError);
  const resetTask     = useVideoStore((s) => s.resetTask);

  // 参考视频裁剪面板（PLAN-VIDEO-TRIM）。replaceIndex 为 null 时裁完新增，
  // 否则替换 refVideos[replaceIndex]（卡片上的裁剪按钮入口）。
  const [trimTarget, setTrimTarget] = useState<{
    file: File;
    previewUrl: string;
    duration: number;
    replaceIndex: number | null;
  } | null>(null);

  // 取帧面板（PLAN-VIDEO-FRAME）。src 为要取帧的视频源；targets 决定落点按钮；
  // origin 用于日志/文案区分「来自参考视频」还是「来自生成结果」。
  const [framePick, setFramePick] = useState<{
    src: string;
    title: string;
    targets: FrameTarget[];
    initial: "start" | "end";
  } | null>(null);

  // 图片 / 视频 / 音频统一走预签名上传，返回生成接口可访问的公网 URL。
  async function uploadAsset(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/video/upload", { method: "POST", body: form });
    const res = await response.json().catch(() => ({}));
    if (!response.ok || res.error) throw new Error(res.error || `素材上传失败 HTTP ${response.status}`);
    if (!res.url) throw new Error("素材上传成功但未返回 URL");
    return res.url as string;
  }

  const isOmni = model === "v3-omni";
  const isSeedance = isSeedanceModel(model);
  const canUseReferences = supportsReferenceMedia(model);
  // v3/v2-6 只有首尾帧；Omni / Seedance 可切换首尾帧和多模态参考。
  const useFrames = !canUseReferences || frameMode === "frames";

  async function generate() {
    if (!settings?.hasApiKey) { showToast("error", "请先在设置里填入 o1key 令牌"); openSettings(); return; }
    if (useFrames && !startFrame && !isOmni && !isSeedance) { showToast("error", "请先上传起始帧"); return; }
    if (!shotsEnabled && !prompt.trim()) { showToast("error", "请输入提示词"); return; }
    if (shotsEnabled) {
      const empty = shots.find((s) => !s.prompt.trim());
      if (empty) { showToast("error", `第 ${empty.index} 段分镜提示词不能为空`); return; }
      const total = shots.reduce((sum, s) => sum + s.duration, 0);
      if (total !== duration) { showToast("error", `各分镜时长之和 (${total}s) 必须等于总时长 (${duration}s)`); return; }
    }
    // v3-omni 多图参考模式允许「智能」：此时不向上游传 aspect_ratio（见
    // api/video/jobs/route.ts 的 `if (aspectRatio !== "智能")`），由上游按默认画幅处理。
    // 官方约束：v3-omni 视频编辑（base）模式不支持分镜。
    if (isOmni && !useFrames && refVideos.length && referType === "base" && shotsEnabled) {
      showToast("error", "视频编辑（base）模式不支持分镜，请关闭分镜或改用「视频参考」");
      return;
    }
    // 可灵官方规格：v3-omni 参考视频至多 1 段、单段时长 ≥3 秒。
    if (isOmni && !useFrames && refVideos.length) {
      if (refVideos.length > maxReferenceVideos(model)) {
        showToast("error", `可灵 v3-omni 至多支持 ${maxReferenceVideos(model)} 段参考视频`);
        return;
      }
      const short = refVideos.findIndex((v) => (v.duration ?? KLING_REF_VIDEO_SPEC.minDuration) < KLING_REF_VIDEO_SPEC.minDuration);
      if (short >= 0) {
        showToast("error", `参考视频 ${short + 1} 时长不足 ${KLING_REF_VIDEO_SPEC.minDuration} 秒`);
        return;
      }
      const long = refVideos.findIndex((v) => (v.duration ?? 0) > KLING_REF_VIDEO_SPEC.maxDuration);
      if (long >= 0) {
        showToast("error", `参考视频 ${long + 1} 超过 ${KLING_REF_VIDEO_SPEC.maxDuration} 秒，请点击卡片上的裁剪按钮裁剪`);
        return;
      }
    }
    if (isSeedance && !useFrames && refAudios.length > 0 && refImages.length === 0 && refVideos.length === 0) {
      showToast("error", "参考音频不能单独使用，请同时添加参考图片或参考视频");
      return;
    }
    // 参考视频时长在提交时统一校验（添加时不拦截，用户可用卡片上的裁剪按钮裁到需要的时长）
    if (isSeedance && !useFrames && refVideos.length) {
      const over = refVideos.findIndex((v) => (v.duration ?? 0) > 15.05);
      if (over >= 0) {
        showToast("error", `参考视频 ${over + 1} 超过 15 秒，请点击卡片上的裁剪按钮裁剪`);
        return;
      }
      const total = refVideos.reduce((sum, v) => sum + (v.duration ?? 0), 0);
      if (total > 15.05) {
        showToast("error", `所有参考视频总时长不能超过 15 秒（当前 ${total.toFixed(1)}s），请裁剪后提交`);
        return;
      }
    }

    resetTask();
    beginUpload();
    diag(
      "info",
      "视频提交",
      `开始生成（${model} · ${mode} · ${duration}s）`,
      JSON.stringify({ model, mode, duration, aspectRatio, sound, webSearch, shotsEnabled }, null, 2),
    );

    try {
      let imageUrl = "";
      let tailUrl  = "";
      const refUrls: string[] = [];
      const videoUrls: string[] = [];
      const audioUrls: string[] = [];

      // 两种输入方式互斥：首尾帧模式只传首/尾，多模态模式传参考素材。
      if (useFrames) {
        if (startFrame) imageUrl = await uploadAsset(startFrame.file);
        if (tailFrame)  tailUrl  = await uploadAsset(tailFrame.file);
      } else {
        for (const ref of refImages) refUrls.push(await uploadAsset(ref.file));
        // 参考视频：Seedance 与 v3-omni 都支持；参考音频仅 Seedance。
        if (isSeedance || isOmni) {
          for (const ref of refVideos) videoUrls.push(await uploadAsset(ref.file));
        }
        if (isSeedance) {
          for (const ref of refAudios) audioUrls.push(await uploadAsset(ref.file));
        }
      }
      const assetCount = [imageUrl, tailUrl].filter(Boolean).length + refUrls.length + videoUrls.length + audioUrls.length;
      if (assetCount) diag("info", "视频提交", `素材上传完成，共 ${assetCount} 个`);

      beginSubmit();
      const res = await fetch("/api/video/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, mode, duration, prompt, negativePrompt: negPrompt, sound, aspectRatio,
          watermark, webSearch,
          cameraFixed: isSeedance ? cameraFixed : undefined,
          seed: isSeedance && seedText ? Number(seedText) : undefined,
          imageUrl: imageUrl || undefined,
          tailUrl:  tailUrl  || undefined,
          refUrls:  refUrls.length ? refUrls : undefined,
          videoUrls: videoUrls.length ? videoUrls : undefined,
          referType: isOmni && videoUrls.length ? referType : undefined,
          keepOriginalSound: isOmni && videoUrls.length ? keepOriginalSound : undefined,
          audioUrls: audioUrls.length ? audioUrls : undefined,
          shots:    !isSeedance && shotsEnabled ? shots : [],
        }),
      }).then((r) => r.json());

      if (res.error) {
        setError(res.error);
        diag("error", "视频提交", "提交失败", res.error);
        showToast("error", res.error);
        return;
      }
      diag("info", "视频提交", "任务已创建", `任务 ID: ${res.taskId}`);
      setRunning(res.taskId);
    } catch (e) {
      setError((e as Error).message);
      diag("error", "视频提交", "提交失败，请检查网络", (e as Error)?.message || String(e));
      showToast("error", (e as Error).message ?? "提交失败");
    }
  }

  async function handleStartFrameFile(file: File) {
    const asset = await prepareImageAsset(file);
    if (asset) setStartFrame(asset);
  }

  async function handleTailFrameFile(file: File) {
    const asset = await prepareImageAsset(file);
    if (asset) setTailFrame(asset);
  }

  async function prepareImageAsset(file: File) {
    let previewUrl = "";
    try {
      if (!isSupportedImageFile(file)) throw new Error("仅支持 JPEG、PNG、WEBP、BMP、TIFF、GIF、HEIC 或 HEIF");
      if (file.size > 30 * 1024 * 1024) throw new Error("图片不能超过 30MB");
      previewUrl = URL.createObjectURL(file);
      try {
        const meta = await readImageMetadata(previewUrl);
        const ratio = meta.width / meta.height;
        if (meta.width < 300 || meta.height < 300 || meta.width > 6000 || meta.height > 6000 || ratio < 0.4 || ratio > 2.5) {
          throw new Error("图片尺寸需为 300-6000px，宽高比需在 0.4-2.5 之间");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取图片失败";
        if (!message.includes("图片信息")) throw error;
        showToast("info", "浏览器无法预览该图片格式，将在提交时由生成服务校验");
      }
      return { previewUrl, file };
    } catch (error) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      showToast("error", error instanceof Error ? error.message : "读取图片失败");
      return null;
    }
  }

  async function handleReferenceVideo(file: File) {
    const spec = isOmni ? KLING_REF_VIDEO_SPEC : SEEDANCE_REF_VIDEO_SPEC;
    if (!/\.(mp4|mov)$/i.test(file.name) && !["video/mp4", "video/quicktime"].includes(file.type)) {
      showToast("error", "参考视频仅支持 MP4 或 MOV");
      return;
    }
    if (file.size > spec.maxBytes) {
      showToast("error", `参考视频不能超过 ${Math.round(spec.maxBytes / 1024 / 1024)}MB`);
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    let meta: { duration: number; width: number; height: number } | null = null;
    try {
      meta = await readMediaMetadata(previewUrl, "video");
      if (!Number.isFinite(meta.duration) || meta.duration < spec.minDuration) {
        throw new Error(`单个参考视频时长不能少于 ${spec.minDuration} 秒`);
      }
      const ratio = meta.height ? meta.width / meta.height : 0;
      if (meta.width < spec.minSide || meta.height < spec.minSide || meta.width > spec.maxSide || meta.height > spec.maxSide || ratio < spec.minRatio || ratio > spec.maxRatio) {
        throw new Error(`参考视频尺寸需为 ${spec.minSide}-${spec.maxSide}px，宽高比需在 ${spec.minRatio}-${spec.maxRatio} 之间`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取参考视频失败";
      if (!message.includes("读取素材信息")) {
        URL.revokeObjectURL(previewUrl);
        showToast("error", message);
        return;
      }
      showToast("info", "浏览器无法读取该视频编码，将在提交时由生成服务校验");
    }
    const addError = addRefVideo({ file, previewUrl, duration: meta?.duration ?? null });
    if (addError) {
      URL.revokeObjectURL(previewUrl);
      showToast("error", addError);
    }
  }

  async function handleReferenceAudio(file: File) {
    if (!/\.(wav|mp3)$/i.test(file.name) && !["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"].includes(file.type)) {
      showToast("error", "参考音频仅支持 WAV 或 MP3");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast("error", "参考音频不能超过 15MB");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    let meta: { duration: number; width: number; height: number } | null = null;
    try {
      meta = await readMediaMetadata(previewUrl, "audio");
      if (!Number.isFinite(meta.duration) || meta.duration < 2 || meta.duration > 15) {
        throw new Error("单段参考音频时长必须在 2-15 秒之间");
      }
      if (refAudios.reduce((sum, item) => sum + (item.duration ?? 0), 0) + meta.duration > 15.05) {
        throw new Error("所有参考音频总时长不能超过 15 秒");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取参考音频失败";
      if (!message.includes("读取素材信息")) {
        URL.revokeObjectURL(previewUrl);
        showToast("error", message);
        return;
      }
      showToast("info", "浏览器无法读取该音频编码，将在提交时由生成服务校验");
    }
    const addError = addRefAudio({ file, previewUrl, duration: meta?.duration ?? null });
    if (addError) {
      URL.revokeObjectURL(previewUrl);
      showToast("error", addError);
    }
  }

  function handleRemoveReferenceVideo(index: number) {
    const item = refVideos[index];
    if (item) URL.revokeObjectURL(item.previewUrl);
    removeRefVideo(index);
  }

  // 卡片上的「裁剪」按钮：对已添加的参考视频二次裁剪，裁完原位替换
  function handleTrimReferenceVideo(index: number) {
    const item = refVideos[index];
    if (!item) return;
    setTrimTarget({
      file: item.file,
      previewUrl: item.previewUrl,
      duration: item.duration ?? 15,
      replaceIndex: index,
    });
  }

  function closeTrimPanel() {
    if (!trimTarget) return;
    // 新增入口的 previewUrl 是裁剪面板临时建的，关掉要回收；
    // 替换入口复用卡片的 previewUrl，revoke 会弄坏列表里的预览。
    if (trimTarget.replaceIndex == null) URL.revokeObjectURL(trimTarget.previewUrl);
    setTrimTarget(null);
  }

  async function handleTrimDone(trimmed: File) {
    if (!trimTarget) return;
    const replaceIndex = trimTarget.replaceIndex;
    const previewUrl = URL.createObjectURL(trimmed);
    try {
      const spec = isOmni ? KLING_REF_VIDEO_SPEC : SEEDANCE_REF_VIDEO_SPEC;
      const meta = await readMediaMetadata(previewUrl, "video");
      const ratio = meta.height ? meta.width / meta.height : 0;
      if (meta.width < spec.minSide || meta.height < spec.minSide || meta.width > spec.maxSide || meta.height > spec.maxSide || ratio < spec.minRatio || ratio > spec.maxRatio) {
        throw new Error(`参考视频尺寸需为 ${spec.minSide}-${spec.maxSide}px，宽高比需在 ${spec.minRatio}-${spec.maxRatio} 之间`);
      }
      if (!Number.isFinite(meta.duration) || meta.duration < spec.minDuration) {
        throw new Error(`单个参考视频时长不能少于 ${spec.minDuration} 秒`);
      }
      const asset = { file: trimmed, previewUrl, duration: meta.duration };
      const addError = replaceIndex == null ? addRefVideo(asset) : replaceRefVideo(replaceIndex, asset);
      if (addError) throw new Error(addError);
      showToast("success", `裁剪完成 · ${meta.duration.toFixed(1)}s`);
      closeTrimPanel();
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      showToast("error", error instanceof Error ? error.message : "视频裁剪失败");
      closeTrimPanel();
    }
  }

  function handleRemoveReferenceAudio(index: number) {
    const item = refAudios[index];
    if (item) URL.revokeObjectURL(item.previewUrl);
    removeRefAudio(index);
  }

  // 参考视频卡片的「取帧」：打开取帧面板，默认停在首帧（参考视频常取首帧定主体）。
  // 参考模式下唯一有意义的落点是「加入参考图」。
  function handleGrabFrameFromRefVideo(index: number) {
    const item = refVideos[index];
    if (!item) return;
    setFramePick({ src: item.previewUrl, title: "从参考视频提取帧", targets: ["ref"], initial: "start" });
  }

  // 生成结果播放器的「提取帧」：默认停在尾帧（承接下一段最常用），
  // 落点随模型能力给全 —— 起始帧 / 尾帧，支持多模态参考的再加「加入参考图」。
  function openFramePickFromResult() {
    const resultSrc = blobUrl ?? videoUrl;
    if (!resultSrc) return;
    const targets: FrameTarget[] = ["start", "tail"];
    if (canUseReferences) targets.push("ref");
    setFramePick({ src: resultSrc, title: "从生成结果提取帧", targets, initial: "end" });
  }

  // 取帧落点：起始帧 / 尾帧走首尾帧模式，参考图走参考模式（并按模型能力切 frameMode）。
  // 帧文件复用上传图片的 prepareImageAsset 做尺寸/宽高比校验，失败给 toast。
  async function handleFramePickApply(file: File, target: FrameTarget) {
    const asset = await prepareImageAsset(file);
    if (!asset) return; // prepareImageAsset 已 toast
    if (target === "ref") {
      if (canUseReferences && frameMode !== "refs") setFrameMode("refs");
      const addError = addRefImage(asset);
      if (addError) {
        URL.revokeObjectURL(asset.previewUrl);
        showToast("error", addError);
        return;
      }
      showToast("success", "已加入参考图");
    } else {
      if (canUseReferences && frameMode !== "frames") setFrameMode("frames");
      if (target === "start") setStartFrame(asset);
      else setTailFrame(asset);
      showToast("success", target === "start" ? "已设为起始帧" : "已设为尾帧");
    }
    setFramePick(null);
  }

  const busy = phase === "uploading" || phase === "submitting" || phase === "running";

  return (
    <div className="relative flex flex-col flex-1 overflow-hidden">
      {/* 背景光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(58% 44% at 50% 30%, rgba(230,178,119,0.05), transparent 70%)" }}
      />

      {/* 主体三栏布局 */}
      <div className="absolute inset-0 flex flex-col gap-4 overflow-y-auto px-4 pb-[360px] pt-4 md:flex-row md:overflow-hidden md:px-6 md:pb-[220px] md:pt-5">
        {/* 左栏：图片输入。v3/v2-6 恒为首尾帧；v3-omni 默认多图参考，可切首尾帧 */}
        <div className={cn(
          "flex w-full shrink-0 flex-col gap-4 pb-2 transition-opacity md:overflow-y-auto",
          isSeedance ? "md:w-[250px]" : "md:w-[200px]",
          busy && "pointer-events-none opacity-60",
        )}>
          {canUseReferences && (
            <Segmented
              value={frameMode}
              onChange={(v) => setFrameMode(v as FrameMode)}
              options={[
                { value: "refs", label: isSeedance ? "多模态参考" : "多图参考" },
                { value: "frames", label: "首尾帧" },
              ]}
            />
          )}

          {useFrames ? (
            <>
              <FrameSlot
                label="起始帧"
                sublabel={isOmni || isSeedance ? "点击或拖入（可选）" : "点击或拖入（必填）"}
                frame={startFrame}
                onFile={handleStartFrameFile}
                onClear={() => setStartFrame(null)}
                optional={isOmni || isSeedance}
              />
              <FrameSlot
                label="尾帧"
                sublabel="点击或拖入"
                frame={tailFrame}
                onFile={handleTailFrameFile}
                onClear={() => setTailFrame(null)}
                optional
              />
            </>
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-fg-mute">参考图</span>
                <span className="text-[10px] text-fg-mute/60">最多 {maxReferenceImages(model)} 张</span>
              </div>
              <div className="flex flex-col gap-2">
                {refImages.map((img, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-control border border-line bg-panel-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.previewUrl} alt={`参考图 ${i + 1}`} className="block max-h-28 w-full object-contain" />
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-fg">
                      图 {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRefImage(i)}
                      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-fg opacity-100 transition-opacity hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Icon name="X" size={10} />
                    </button>
                  </div>
                ))}
                {refImages.length < maxReferenceImages(model) && (
                  <AssetAddButton
                    accept="image/*,.heic,.heif"
                    label="添加参考图"
                    onFile={async (f) => {
                      const asset = await prepareImageAsset(f);
                      if (!asset) return;
                      const addError = addRefImage(asset);
                      if (addError) {
                        URL.revokeObjectURL(asset.previewUrl);
                        showToast("error", addError);
                      }
                    }}
                  />
                )}
                <p className="mt-1 text-[10px] leading-relaxed text-fg-mute/70">
                  参考图作为场景 / 风格 / 主体参考注入，在提示词中描述如何使用它们
                </p>
              </div>
              {isSeedance && (
                <>
                  <ReferenceMediaSection
                    kind="video"
                    items={refVideos}
                    onAdd={handleReferenceVideo}
                    onRemove={handleRemoveReferenceVideo}
                    onTrim={handleTrimReferenceVideo}
                    onGrabFrame={handleGrabFrameFromRefVideo}
                  />
                  <ReferenceMediaSection
                    kind="audio"
                    items={refAudios}
                    onAdd={handleReferenceAudio}
                    onRemove={handleRemoveReferenceAudio}
                  />
                  <p className="mt-3 text-[10px] leading-relaxed text-fg-mute/70">
                    音频不能单独使用，需要同时添加参考图或参考视频
                  </p>
                </>
              )}
              {isOmni && (
                <>
                  <ReferenceMediaSection
                    kind="video"
                    items={refVideos}
                    max={maxReferenceVideos(model)}
                    onAdd={handleReferenceVideo}
                    onRemove={handleRemoveReferenceVideo}
                    onTrim={handleTrimReferenceVideo}
                    onGrabFrame={handleGrabFrameFromRefVideo}
                  >
                    <div className="mb-2">
                      <Segmented
                        value={referType}
                        onChange={(v) => setReferType(v as VideoReferType)}
                        options={[
                          { value: "feature", label: "视频参考" },
                          { value: "base", label: "视频编辑" },
                        ]}
                      />
                      <p className="mt-1.5 text-[10px] leading-relaxed text-fg-mute/70">
                        {referType === "feature"
                          ? "参考视频的内容 / 风格 / 运镜生成新镜头"
                          : "在原视频上增删改内容（此时不支持分镜，且不生成音频）"}
                      </p>
                      <label className="mt-2 flex items-center gap-2 text-[11px] text-fg-dim">
                        <input
                          type="checkbox"
                          checked={keepOriginalSound}
                          onChange={(e) => setKeepOriginalSound(e.target.checked)}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        保留参考视频原声
                      </label>
                    </div>
                  </ReferenceMediaSection>
                </>
              )}
            </div>
          )}
        </div>

        {/* 右栏：播放器 */}
        <div className="flex min-w-0 w-full flex-col gap-4 md:flex-1 md:overflow-y-auto">
          <VideoPlayer
            blobUrl={blobUrl}
            videoUrl={videoUrl}
            progress={progress}
            phase={phase}
          />

          {phase === "success" && (blobUrl || videoUrl) && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openFramePickFromResult}
                className="flex h-9 items-center gap-1.5 rounded-control border border-line bg-panel-2 px-3 text-xs text-fg transition-colors hover:border-accent hover:text-accent"
                title="提取该视频的某一帧作为起始帧 / 尾帧 / 参考图"
              >
                <Icon name="FilmStrip" size={14} />
                提取帧
              </button>
              <span className="text-[10px] text-fg-mute/70">
                取尾帧作下一段起始帧，可无缝续拍
              </span>
            </div>
          )}

          <AnimatePresence>
            {error && phase === "error" && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              >
                <Icon name="Warning" size={14} />
                {error}
                <button type="button" onClick={resetTask} className="ml-auto text-red-300/60 hover:text-red-300">
                  <Icon name="X" size={13} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 底部生成栏 */}
      <VideoBar onGenerate={generate} busy={busy} />

      {/* 参考视频快速裁剪 */}
      <AnimatePresence>
        {trimTarget && (
          <VideoTrimPanel
            key={trimTarget.previewUrl}
            file={trimTarget.file}
            previewUrl={trimTarget.previewUrl}
            duration={trimTarget.duration}
            onDone={handleTrimDone}
            onCancel={closeTrimPanel}
            onError={(message) => showToast("error", message)}
          />
        )}
      </AnimatePresence>

      {/* 视频取帧（首/尾帧 → 起始帧 / 尾帧 / 参考图） */}
      <AnimatePresence>
        {framePick && (
          <FramePickPanel
            key={framePick.src}
            src={framePick.src}
            title={framePick.title}
            targets={framePick.targets}
            initial={framePick.initial}
            onApply={handleFramePickApply}
            onCancel={() => setFramePick(null)}
            onError={(message) => showToast("error", message)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
