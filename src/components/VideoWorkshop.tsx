"use client";

// 视频创作工作台（PLAN-VIDEO）：
//  - 左栏：图片输入（v3/v2-6 首尾帧；v3-omni 默认多图参考，可切首尾帧）
//  - 中/右：视频播放器 + 历史记录列表
//  - 底部：生成参数栏（VideoBar）

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStudio } from "@/lib/store";
import { useVideoStore, type FrameMode } from "@/lib/videoStore";
import { cn, fileToDataURL } from "@/lib/utils";
import { Icon } from "./icons";
import { Segmented } from "./ui";
import { VideoBar } from "./VideoBar";

// ─────────────────────────────────────────────────────────────────────────────
// 参考图添加按钮（小型，用于 v3-omni 参考图列表末尾）
// ─────────────────────────────────────────────────────────────────────────────

function RefAddButton({ onFile }: { onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-line-2 text-xs text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
      >
        <Icon name="Plus" size={13} />
        添加参考图
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
  frame: { dataUrl: string } | null;
  onFile: (f: File) => void;
  onClear: () => void;
  optional?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return;
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
          <img src={frame.dataUrl} alt={label} className="block max-h-[44vh] w-full object-contain" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
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
              {phase === "uploading" ? "上传图片中…" : phase === "submitting" ? "提交任务…" : `生成中 ${progress}%`}
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
// History List
// ─────────────────────────────────────────────────────────────────────────────

function HistoryList() {
  const history = useVideoStore((s) => s.history);
  const playHistory = useVideoStore((s) => s.playHistory);

  if (!history.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-fg-dim">
        <Icon name="FilmSlate" size={22} />
        <span className="text-xs text-fg-mute">生成后记录会出现在这里</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {history.map((item) => (
        <motion.button
          key={item.taskId}
          type="button"
          onClick={() => playHistory(item)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="group flex items-center gap-3 rounded-control border border-line p-2.5 text-left transition-colors hover:border-line-2 hover:bg-white/[0.04]"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-accent">
            <Icon name="Play" size={13} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-fg">
              {item.prompt || (item.shots[0]?.prompt ?? "（分镜模式）")}
            </div>
            <div className="mt-0.5 text-[10px] text-fg-mute">
              {item.model} · {item.mode} · {item.duration}s
            </div>
          </div>
          <span className="shrink-0 text-[10px] text-fg-mute opacity-0 transition-opacity group-hover:opacity-100">
            播放
          </span>
        </motion.button>
      ))}
    </div>
  );
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
  const taskId     = useVideoStore((s) => s.taskId);
  const error      = useVideoStore((s) => s.error);
  const model      = useVideoStore((s) => s.model);
  const mode       = useVideoStore((s) => s.mode);
  const duration   = useVideoStore((s) => s.duration);
  const prompt     = useVideoStore((s) => s.prompt);
  const negPrompt  = useVideoStore((s) => s.negativePrompt);
  const sound      = useVideoStore((s) => s.sound);
  const aspectRatio = useVideoStore((s) => s.aspectRatio);
  const shotsEnabled = useVideoStore((s) => s.shotsEnabled);
  const shots      = useVideoStore((s) => s.shots);
  const startFrame = useVideoStore((s) => s.startFrame);
  const tailFrame  = useVideoStore((s) => s.tailFrame);

  const refImages     = useVideoStore((s) => s.refImages);
  const frameMode     = useVideoStore((s) => s.frameMode);
  const setFrameMode  = useVideoStore((s) => s.setFrameMode);
  const setStartFrame = useVideoStore((s) => s.setStartFrame);
  const setTailFrame  = useVideoStore((s) => s.setTailFrame);
  const addRefImage   = useVideoStore((s) => s.addRefImage);
  const removeRefImage = useVideoStore((s) => s.removeRefImage);
  const beginUpload   = useVideoStore((s) => s.beginUpload);
  const beginSubmit   = useVideoStore((s) => s.beginSubmit);
  const setRunning    = useVideoStore((s) => s.setRunning);
  const setProgress   = useVideoStore((s) => s.setProgress);
  const setSuccess    = useVideoStore((s) => s.setSuccess);
  const setError      = useVideoStore((s) => s.setError);
  const addHistory    = useVideoStore((s) => s.addHistory);
  const resetTask     = useVideoStore((s) => s.resetTask);

  // 轮询 effect
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskRef = useRef(taskId);
  taskRef.current = taskId;

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (phase !== "running" || !taskId) { stopPoll(); return; }
    let interval = 3000;
    let counter  = 0;

    pollRef.current = setInterval(async () => {
      counter++;
      try {
        const res = await fetch(`/api/video/jobs/${encodeURIComponent(taskId)}`).then((r) => r.json());
        if (res.status === "success") {
          stopPoll();
          // 先保存到 output/，拿到本地 URL 再播放（同时作为 blobUrl 兜底）
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
                  shots:  shotsEnabled ? shots : [],
                  sound,
                  aspectRatio,
                  createdAt: Date.now(),
                },
              }),
            }).then((r) => r.json());
            if (saved.localUrl) playUrl = saved.localUrl;
          } catch { /* 保存失败仍可播放远端直链 */ }
          setSuccess(res.videoUrl, playUrl);
          addHistory({
            taskId,
            model,
            mode,
            duration,
            prompt: shotsEnabled ? "" : prompt,
            shots:  shotsEnabled ? shots : [],
            videoUrl: res.videoUrl,
            blobUrl: playUrl,
            createdAt: Date.now(),
          });
          showToast("success", "视频生成完成，已保存到 output 目录");
        } else if (res.status === "failed") {
          stopPoll();
          setError(res.error ?? "生成失败");
          showToast("error", res.error ?? "视频生成失败");
        } else {
          setProgress(res.progress ?? 0);
          // 指数退避最多 10s
          if (counter > 5) interval = Math.min(interval * 1.4, 10000);
        }
      } catch {
        // 网络抖动，继续轮询
      }
    }, interval);

    return stopPoll;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, taskId]);

  // 上传单张图片 → 返回 public_url
  async function uploadFrame(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/video/upload", { method: "POST", body: form }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    return res.url as string;
  }

  const isOmni = model === "v3-omni";
  // v3/v2-6 只有首尾帧一种输入方式；omni 按用户切换的 frameMode 决定
  const useFrames = !isOmni || frameMode === "frames";

  async function generate() {
    if (!settings?.hasApiKey) { showToast("error", "请先在设置里填入 o1key 令牌"); openSettings(); return; }
    if (useFrames && !startFrame && !isOmni) { showToast("error", "请先上传起始帧"); return; }
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

    stopPoll();
    resetTask();
    beginUpload();

    try {
      let imageUrl = "";
      let tailUrl  = "";
      const refUrls: string[] = [];

      // 两种输入方式互斥上传：首尾帧模式只传首/尾，多图参考模式只传参考图
      if (useFrames) {
        if (startFrame) imageUrl = await uploadFrame(startFrame.file);
        if (tailFrame)  tailUrl  = await uploadFrame(tailFrame.file);
      } else {
        for (const r of refImages) refUrls.push(await uploadFrame(r.file));
      }

      beginSubmit();
      const res = await fetch("/api/video/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, mode, duration, prompt, negativePrompt: negPrompt, sound, aspectRatio,
          imageUrl: imageUrl || undefined,
          tailUrl:  tailUrl  || undefined,
          refUrls:  refUrls.length ? refUrls : undefined,
          shots:    shotsEnabled ? shots : [],
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
    try {
      const dataUrl = await fileToDataURL(file);
      setStartFrame({ dataUrl, file });
    } catch { showToast("error", "读取图片失败"); }
  }

  async function handleTailFrameFile(file: File) {
    try {
      const dataUrl = await fileToDataURL(file);
      setTailFrame({ dataUrl, file });
    } catch { showToast("error", "读取图片失败"); }
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
      <div className="absolute inset-0 flex gap-4 px-6 pb-[220px] pt-5">
        {/* 左栏：图片输入。v3/v2-6 恒为首尾帧；v3-omni 默认多图参考，可切首尾帧 */}
        <div className="flex w-[200px] shrink-0 flex-col gap-4 overflow-y-auto pb-2">
          {isOmni && (
            <Segmented
              value={frameMode}
              onChange={(v) => setFrameMode(v as FrameMode)}
              options={[
                { value: "refs", label: "多图参考" },
                { value: "frames", label: "首尾帧" },
              ]}
            />
          )}

          {useFrames ? (
            <>
              <FrameSlot
                label="起始帧"
                sublabel={isOmni ? "点击或拖入（可选）" : "点击或拖入（必填）"}
                frame={startFrame}
                onFile={handleStartFrameFile}
                onClear={() => setStartFrame(null)}
                optional={isOmni}
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
                <span className="text-[10px] text-fg-mute/60">最多 7 张</span>
              </div>
              <div className="flex flex-col gap-2">
                {refImages.map((img, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-control border border-line bg-panel-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.dataUrl} alt={`参考图 ${i + 1}`} className="block max-h-28 w-full object-contain" />
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-fg">
                      图 {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRefImage(i)}
                      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-fg opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                    >
                      <Icon name="X" size={10} />
                    </button>
                  </div>
                ))}
                {refImages.length < 7 && (
                  <RefAddButton onFile={async (f) => {
                    const dataUrl = await fileToDataURL(f);
                    addRefImage({ dataUrl, file: f });
                  }} />
                )}
                <p className="mt-1 text-[10px] leading-relaxed text-fg-mute/70">
                  参考图作为场景 / 风格 / 主体参考注入，在提示词中描述如何使用它们
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 右栏：播放器 + 历史 */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto min-w-0">
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

          {/* 历史记录 */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-fg-mute">
              <Icon name="FilmSlate" size={13} />
              历史
            </div>
            <HistoryList />
          </div>
        </div>
      </div>

      {/* 底部生成栏 */}
      <VideoBar onGenerate={generate} busy={busy} />
    </div>
  );
}
