"use client";

// 视频创作工作台（PLAN-VIDEO）：
//  - 左栏：图片输入（v3/v2-6 首尾帧；v3-omni 默认多图参考，可切首尾帧）
//  - 中/右：视频播放器
//  - 底部：生成参数栏（VideoBar）
// 生成记录不再在此页维护单独列表：视频生成成功后照图片的做法存进 output/
// （见下方 /api/video/save 调用），统一在独立导航页「历史生成」
// （HistoryPage.tsx）里查看/播放/删除，图片和视频共用一套列表。

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStudio } from "@/lib/store";
import { useVideoStore, type FrameMode } from "@/lib/videoStore";
import { isSeedanceModel, maxReferenceImages, supportsReferenceMedia } from "@/lib/videoGateway";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Segmented } from "./ui";
import { VideoBar } from "./VideoBar";

const SUPPORTED_IMAGE_FILE = /\.(jpe?g|png|webp|bmp|tiff?|gif|heic|heif)$/i;

function isSupportedImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_FILE.test(file.name) || [
    "image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff",
    "image/gif", "image/heic", "image/heif",
  ].includes(file.type.toLowerCase());
}

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
  onAdd,
  onRemove,
}: {
  kind: "video" | "audio";
  items: { previewUrl: string; file: File; duration: number | null }[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
}) {
  const isVideo = kind === "video";
  const label = isVideo ? "参考视频" : "参考音频";
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-fg-mute">{label}</span>
        <span className="text-[10px] text-fg-mute/60">最多 3 个</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={`${item.file.name}-${index}`} className="group relative overflow-hidden rounded-control border border-line bg-panel-2">
            {isVideo ? (
              <video src={item.previewUrl} controls muted preload="metadata" className="block max-h-28 w-full bg-black object-contain" />
            ) : (
              <div className="flex flex-col gap-2 px-2.5 pb-2.5 pt-8">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon name="FileAudio" size={15} className="shrink-0 text-accent" />
                  <span className="truncate text-[11px] text-fg-dim">{item.file.name}</span>
                </div>
                <audio src={item.previewUrl} controls preload="metadata" className="h-8 w-full" />
              </div>
            )}
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] text-fg">
              {isVideo ? "视频" : "音频"} {index + 1}{item.duration == null ? "" : ` · ${item.duration.toFixed(1)}s`}
            </span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-fg-dim transition-colors hover:text-red-300"
              title={`移除${label}`}
            >
              <Icon name="X" size={10} />
            </button>
          </div>
        ))}
        {items.length < 3 && (
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
                  aspectRatio,
                  frameMode,
                  createdAt: Date.now(),
                },
              }),
            }).then((result) => result.json());
            if (saved.localUrl) playUrl = saved.localUrl;
          } catch { /* 保存失败仍可播放远端直链 */ }
          if (cancelled) return;
          setSuccess(res.videoUrl, playUrl);
          showToast("success", "视频生成完成，已保存到 output 目录，可在「历史生成」中查看");
          return;
        }
        if (res.status === "failed") {
          if (cancelled) return;
          setError(res.error ?? "生成失败");
          showToast("error", res.error ?? "视频生成失败");
          return;
        }
        setProgress(res.progress ?? 0);
      } catch {
        // 短暂网络故障保持任务状态，下轮继续。
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
    sound, watermark, webSearch, aspectRatio, frameMode, setProgress, setSuccess,
    setError, showToast,
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
  const aspectRatio = useVideoStore((s) => s.aspectRatio);
  const shotsEnabled = useVideoStore((s) => s.shotsEnabled);
  const shots      = useVideoStore((s) => s.shots);
  const startFrame = useVideoStore((s) => s.startFrame);
  const tailFrame  = useVideoStore((s) => s.tailFrame);

  const refImages     = useVideoStore((s) => s.refImages);
  const refVideos     = useVideoStore((s) => s.refVideos);
  const refAudios     = useVideoStore((s) => s.refAudios);
  const frameMode     = useVideoStore((s) => s.frameMode);
  const setFrameMode  = useVideoStore((s) => s.setFrameMode);
  const setStartFrame = useVideoStore((s) => s.setStartFrame);
  const setTailFrame  = useVideoStore((s) => s.setTailFrame);
  const addRefImage   = useVideoStore((s) => s.addRefImage);
  const removeRefImage = useVideoStore((s) => s.removeRefImage);
  const addRefVideo   = useVideoStore((s) => s.addRefVideo);
  const removeRefVideo = useVideoStore((s) => s.removeRefVideo);
  const addRefAudio   = useVideoStore((s) => s.addRefAudio);
  const removeRefAudio = useVideoStore((s) => s.removeRefAudio);
  const beginUpload   = useVideoStore((s) => s.beginUpload);
  const beginSubmit   = useVideoStore((s) => s.beginSubmit);
  const setRunning    = useVideoStore((s) => s.setRunning);
  const setError      = useVideoStore((s) => s.setError);
  const resetTask     = useVideoStore((s) => s.resetTask);

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
    // 官方约束：无首帧（多图参考 / 纯文本）时宽高比必须明确指定，不能「智能」
    if (isOmni && !useFrames && aspectRatio === "智能") {
      showToast("error", "多图参考模式下请选择明确宽高比（16:9 / 9:16 / 1:1）");
      return;
    }
    if (isSeedance && !useFrames && refAudios.length > 0 && refImages.length === 0 && refVideos.length === 0) {
      showToast("error", "参考音频不能单独使用，请同时添加参考图片或参考视频");
      return;
    }

    resetTask();
    beginUpload();

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
        if (isSeedance) {
          for (const ref of refVideos) videoUrls.push(await uploadAsset(ref.file));
          for (const ref of refAudios) audioUrls.push(await uploadAsset(ref.file));
        }
      }

      beginSubmit();
      const res = await fetch("/api/video/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, mode, duration, prompt, negativePrompt: negPrompt, sound, aspectRatio,
          watermark, webSearch,
          imageUrl: imageUrl || undefined,
          tailUrl:  tailUrl  || undefined,
          refUrls:  refUrls.length ? refUrls : undefined,
          videoUrls: videoUrls.length ? videoUrls : undefined,
          audioUrls: audioUrls.length ? audioUrls : undefined,
          shots:    !isSeedance && shotsEnabled ? shots : [],
        }),
      }).then((r) => r.json());

      if (res.error) { setError(res.error); showToast("error", res.error); return; }
      setRunning(res.taskId);
    } catch (e) {
      setError((e as Error).message);
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
    if (!/\.(mp4|mov)$/i.test(file.name) && !["video/mp4", "video/quicktime"].includes(file.type)) {
      showToast("error", "参考视频仅支持 MP4 或 MOV");
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      showToast("error", "参考视频不能超过 200MB");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    let meta: { duration: number; width: number; height: number } | null = null;
    try {
      meta = await readMediaMetadata(previewUrl, "video");
      if (!Number.isFinite(meta.duration) || meta.duration < 2 || meta.duration > 15) {
        throw new Error("单个参考视频时长必须在 2-15 秒之间");
      }
      if (refVideos.reduce((sum, item) => sum + (item.duration ?? 0), 0) + meta.duration > 15.05) {
        throw new Error("所有参考视频总时长不能超过 15 秒");
      }
      const ratio = meta.height ? meta.width / meta.height : 0;
      if (meta.width < 300 || meta.height < 300 || meta.width > 6000 || meta.height > 6000 || ratio < 0.4 || ratio > 2.5) {
        throw new Error("参考视频尺寸需为 300-6000px，宽高比需在 0.4-2.5 之间");
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

  function handleRemoveReferenceAudio(index: number) {
    const item = refAudios[index];
    if (item) URL.revokeObjectURL(item.previewUrl);
    removeRefAudio(index);
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
    </div>
  );
}
