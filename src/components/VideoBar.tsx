"use client";

// 视频生成参数栏（PLAN-VIDEO）：底部玻璃面板，对齐 GenerateBar / BatchBar 视觉。
// 包含：模型选择、画质（720p/1080p/4K）、时长、宽高比、生成音频、分镜开关、
// 提示词输入（单段 或 N段分镜编辑器），以及「生成」按钮。

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useVideoStore } from "@/lib/videoStore";
import {
  allowedVideoDurations,
  allowedVideoResolutions,
  isSeedanceModel,
  supportsShots,
} from "@/lib/videoGateway";
import type { AspectRatio, ShotSegment, VideoModel, VideoResolution } from "@/lib/videoTypes";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Button, Select } from "./ui";

const MODELS: { value: VideoModel; label: string; hint: string }[] = [
  { value: "v3",      label: "可灵 v3",      hint: "图生视频 · 3~15s · 支持 4K" },
  { value: "v2-6",    label: "可灵 v2.6",    hint: "图生视频 · 5/10s · 性价比" },
  { value: "v3-omni", label: "可灵 v3-omni", hint: "多模态 · 参考图/视频" },
  { value: "seedance-2.0", label: "Seedance 2.0", hint: "多模态 · 有声 · 最高 4K" },
  { value: "seedance-2.0-fast", label: "Seedance 2.0 Fast", hint: "多模态 · 快速 · 最高 720p" },
];

const SEEDANCE_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "智能",  label: "智能" },
  { value: "16:9",  label: "16:9" },
  { value: "4:3",   label: "4:3" },
  { value: "1:1",   label: "1:1" },
  { value: "3:4",   label: "3:4" },
  { value: "9:16",  label: "9:16" },
  { value: "21:9",  label: "21:9" },
];
const OMNI_RATIOS = SEEDANCE_RATIOS.filter((option) => ["智能", "16:9", "9:16", "1:1"].includes(option.value));

// ── 分镜编辑器 ────────────────────────────────────────────────────────────────

function ShotEditor() {
  const duration = useVideoStore((s) => s.duration);
  const shots    = useVideoStore((s) => s.shots);
  const setShots = useVideoStore((s) => s.setShots);

  function addShot() {
    if (shots.length >= 6) return;
    setShots([...shots, { index: shots.length + 1, prompt: "", duration: 1 }]);
  }

  function removeShot(i: number) {
    const next = shots.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, index: idx + 1 }));
    setShots(next);
  }

  function updateShot(i: number, patch: Partial<ShotSegment>) {
    setShots(shots.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  const total = shots.reduce((s, sh) => s + sh.duration, 0);
  const diff  = total - duration;

  return (
    <div className="flex flex-col gap-2">
      {shots.map((sh, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2 shrink-0 text-[10px] text-fg-mute w-4 text-right">{i + 1}</span>
          <textarea
            value={sh.prompt}
            onChange={(e) => updateShot(i, { prompt: e.target.value })}
            placeholder={`第 ${i + 1} 段提示词…`}
            rows={2}
            className="flex-1 resize-none rounded-control border border-line bg-panel-2/60 p-2 text-xs text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
          />
          <div className="flex flex-col items-center gap-1">
            <input
              type="number"
              min={1}
              max={duration}
              value={sh.duration}
              onChange={(e) => updateShot(i, { duration: Math.max(1, Number(e.target.value)) })}
              className="w-12 rounded-control border border-line bg-panel-2/60 px-1.5 py-1 text-center text-xs text-fg focus:border-accent focus:outline-none"
            />
            <span className="text-[9px] text-fg-mute">秒</span>
          </div>
          {shots.length > 1 && (
            <button
              type="button"
              onClick={() => removeShot(i)}
              className="mt-1.5 shrink-0 text-fg-mute/50 hover:text-red-300"
            >
              <Icon name="X" size={12} />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        {shots.length < 6 && (
          <button type="button" onClick={addShot} className="flex items-center gap-1 text-xs text-fg-mute hover:text-accent">
            <Icon name="Plus" size={12} />
            添加分镜
          </button>
        )}
        <span className={cn("ml-auto text-xs", diff !== 0 ? "text-amber-300" : "text-fg-mute")}>
          {total}s / {duration}s
          {diff !== 0 && `（相差 ${Math.abs(diff)}s）`}
        </span>
      </div>
    </div>
  );
}

// ── 主体 ─────────────────────────────────────────────────────────────────────

export function VideoBar({ onGenerate, busy }: { onGenerate: () => void; busy: boolean }) {
  const model        = useVideoStore((s) => s.model);
  const mode         = useVideoStore((s) => s.mode);
  const duration     = useVideoStore((s) => s.duration);
  const prompt       = useVideoStore((s) => s.prompt);
  const negPrompt    = useVideoStore((s) => s.negativePrompt);
  const sound        = useVideoStore((s) => s.sound);
  const watermark    = useVideoStore((s) => s.watermark);
  const webSearch    = useVideoStore((s) => s.webSearch);
  const aspectRatio  = useVideoStore((s) => s.aspectRatio);
  const shotsEnabled = useVideoStore((s) => s.shotsEnabled);

  const setModel       = useVideoStore((s) => s.setModel);
  const setMode        = useVideoStore((s) => s.setMode);
  const setDuration    = useVideoStore((s) => s.setDuration);
  const setPrompt      = useVideoStore((s) => s.setPrompt);
  const setNegPrompt   = useVideoStore((s) => s.setNegPrompt);
  const setSound       = useVideoStore((s) => s.setSound);
  const setWatermark   = useVideoStore((s) => s.setWatermark);
  const setWebSearch   = useVideoStore((s) => s.setWebSearch);
  const setAspectRatio = useVideoStore((s) => s.setAspectRatio);
  const toggleShots    = useVideoStore((s) => s.toggleShots);

  const isOmni   = model === "v3-omni";
  const isSeedance = isSeedanceModel(model);
  const modeOpts = allowedVideoResolutions(model).map((value) => ({ value, label: value }));
  const durOpts = allowedVideoDurations(model);
  const ratioOpts = isSeedance ? SEEDANCE_RATIOS : OMNI_RATIOS;

  const [showNeg, setShowNeg] = useState(false);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="glass pointer-events-auto max-h-[calc(100vh-1rem)] w-[min(960px,96vw)] overflow-y-auto rounded-panel p-3.5"
      >
        <fieldset disabled={busy} className="contents">
        {/* 芯片行：模型标识 + 参数选择器 */}
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-2 pr-3 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-accent">
              <Icon name="VideoCamera" size={13} weight="bold" />
            </span>
            <span className="font-medium text-fg">视频创作</span>
          </span>

          {/* 模型 */}
          <Select
            value={model}
            onChange={(v) => setModel(v as VideoModel)}
            options={MODELS.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))}
            className="w-[178px]"
          />

          {/* 画质 */}
          <Select
            value={mode}
            onChange={(v) => setMode(v as VideoResolution)}
            options={modeOpts}
            className="w-[88px]"
          />

          {/* 时长 */}
          <Select
            value={String(duration)}
            onChange={(v) => setDuration(Number(v))}
            options={durOpts.map((d) => ({ value: String(d), label: d === -1 ? "自动" : `${d}s` }))}
            className="w-[76px]"
          />

          {/* 宽高比（多模态模型） */}
          {(isOmni || isSeedance) && (
            <Select
              value={aspectRatio}
              onChange={(v) => setAspectRatio(v as AspectRatio)}
              options={ratioOpts}
              className="w-[84px]"
            />
          )}

          {/* 生成音频 */}
          <button
            type="button"
            onClick={() => setSound(!sound)}
            title={sound ? "生成音频（点击关闭）" : "不生成音频（点击开启）"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-control border transition-colors",
              sound ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-fg-dim hover:border-line-2 hover:text-fg",
            )}
          >
            <Icon name={sound ? "SpeakerHigh" : "SpeakerX"} size={14} />
          </button>

          {isSeedance && (
            <>
              <button
                type="button"
                onClick={() => setWebSearch(!webSearch)}
                title={webSearch ? "联网搜索已开启" : "开启联网搜索"}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-control border transition-colors",
                  webSearch ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-fg-dim hover:border-line-2 hover:text-fg",
                )}
              >
                <Icon name="Globe" size={14} />
              </button>
              <button
                type="button"
                onClick={() => setWatermark(!watermark)}
                title={watermark ? "AI 水印已开启" : "添加 AI 水印"}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-control border transition-colors",
                  watermark ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-fg-dim hover:border-line-2 hover:text-fg",
                )}
              >
                <Icon name="Sparkle" size={14} />
              </button>
            </>
          )}

          {/* 分镜（v2-6 不支持分镜） */}
          {supportsShots(model) && (
            <button
              type="button"
              onClick={toggleShots}
              title={shotsEnabled ? "关闭分镜模式" : "开启分镜模式（多段提示词）"}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-control border px-2.5 text-xs transition-colors",
                shotsEnabled ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-fg-dim hover:border-line-2 hover:text-fg",
              )}
            >
              <Icon name="Scissors" size={13} />
              分镜
            </button>
          )}

          {/* 负向提示词展开 */}
          <button
            type="button"
            onClick={() => setShowNeg((v) => !v)}
            className={cn(
              "ml-auto flex h-8 items-center gap-1 rounded-control border px-2.5 text-xs transition-colors",
              showNeg ? "border-line-2 text-fg" : "border-line text-fg-dim hover:border-line-2 hover:text-fg",
            )}
          >
            <Icon name="Plus" size={12} />
            负向
          </button>
        </div>

        {/* 提示词区 */}
        {shotsEnabled ? (
          <ShotEditor />
        ) : (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要的视频内容（动作、场景、风格…）"
            rows={2}
            className="w-full resize-none rounded-control border border-line bg-panel-2/60 p-3 text-sm leading-relaxed text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
          />
        )}

        {/* 负向提示词（可展开） */}
        <AnimatePresence>
          {showNeg && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <textarea
                value={negPrompt}
                onChange={(e) => setNegPrompt(e.target.value)}
                placeholder="不希望出现的内容（可选）…"
                rows={1}
                className="mt-2 w-full resize-none rounded-control border border-line bg-panel-2/60 p-2.5 text-sm text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 底部操作行 */}
        <div className="mt-2.5 flex items-center justify-end">
          <Button variant="primary" onClick={onGenerate} disabled={busy} className="px-8">
            {busy ? (
              <><Icon name="CircleNotch" size={16} className="animate-spin" />生成中</>
            ) : (
              <><Icon name="VideoCamera" size={16} weight="fill" />生成视频</>
            )}
          </Button>
        </div>
        </fieldset>
      </motion.div>
    </div>
  );
}
