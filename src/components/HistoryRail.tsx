"use client";

import { motion } from "motion/react";
import { useCallback, useEffect } from "react";
import { useStudio } from "@/lib/store";
import { useVideoStore } from "@/lib/videoStore";
import { formatBytes } from "@/lib/utils";
import { Icon } from "./icons";
import type { HistoryItem } from "@/lib/types";

export function HistoryRail() {
  const history = useStudio((s) => s.history);
  const setHistory = useStudio((s) => s.setHistory);
  const close = useStudio((s) => s.toggleHistory);
  const useAsCanvas = useStudio((s) => s.useResultAsCanvas);
  const updateParams = useStudio((s) => s.updateParams);
  const setWorkMode = useStudio((s) => s.setWorkMode);
  const showToast = useStudio((s) => s.showToast);

  // 视频参数还原
  const setVideoModel    = useVideoStore((s) => s.setModel);
  const setVideoMode     = useVideoStore((s) => s.setMode);
  const setDuration      = useVideoStore((s) => s.setDuration);
  const setPrompt        = useVideoStore((s) => s.setPrompt);
  const setSound         = useVideoStore((s) => s.setSound);
  const setAspectRatio   = useVideoStore((s) => s.setAspectRatio);
  const setShots         = useVideoStore((s) => s.setShots);
  const toggleShots      = useVideoStore((s) => s.toggleShots);
  const shotsEnabled     = useVideoStore((s) => s.shotsEnabled);
  const playHistory      = useVideoStore((s) => s.playHistory);

  const refresh = useCallback(async () => {
    try {
      const h = await fetch("/api/history").then((r) => r.json());
      setHistory(h.items || []);
    } catch {
      // ignore
    }
  }, [setHistory]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function pickImage(it: HistoryItem) {
    const apply = (w: number, h: number) => {
      useAsCanvas({ src: it.url, width: w, height: h });
      if (it.meta) {
        updateParams({
          prompt: it.meta.prompt,
          model: it.meta.model,
          resolution: it.meta.resolution,
          aspectRatio: it.meta.aspectRatio,
          billing: it.meta.billing,
          count: it.meta.count,
          quality: it.meta.quality ?? "auto",
        });
        showToast("success", "已载入画布，并还原当时的提示词与参数");
      } else {
        showToast("success", "已载入画布");
      }
    };
    const img = new Image();
    img.onload = () => apply(img.naturalWidth, img.naturalHeight);
    img.onerror = () => apply(1024, 1024);
    img.src = it.url;
  }

  function pickVideo(it: HistoryItem) {
    const vm = it.videoMeta;
    // 播放视频（切到视频工作台并显示在播放器里）
    playHistory({
      taskId:    vm?.taskId   ?? it.name,
      model:     (vm?.model   ?? "v3") as Parameters<typeof setVideoModel>[0],
      mode:      (vm?.mode    ?? "720p") as Parameters<typeof setVideoMode>[0],
      duration:  vm?.duration ?? 5,
      prompt:    vm?.prompt   ?? "",
      shots:     vm?.shots    ?? [],
      videoUrl:  it.url,
      blobUrl:   it.url,
      createdAt: it.createdAt,
    });
    // 还原参数
    if (vm) {
      setVideoModel(vm.model as Parameters<typeof setVideoModel>[0]);
      setVideoMode(vm.mode as Parameters<typeof setVideoMode>[0]);
      setDuration(vm.duration);
      setAspectRatio(vm.aspectRatio as Parameters<typeof setAspectRatio>[0]);
      setSound(vm.sound);
      if (vm.shots?.length) {
        if (!shotsEnabled) toggleShots();
        setShots(vm.shots);
        setPrompt("");
      } else {
        if (shotsEnabled) toggleShots();
        setPrompt(vm.prompt ?? "");
      }
    }
    setWorkMode("video");
    close();
    showToast("success", vm ? "已切到视频创作并还原当时的参数" : "已切到视频创作");
  }

  async function del(name: string) {
    try {
      await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      refresh();
    } catch {
      // ignore
    }
  }

  const isVideo = (it: HistoryItem) => /\.mp4$/i.test(it.name);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        onClick={close}
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="glass fixed inset-y-0 right-0 z-[101] flex w-[min(440px,100vw)] flex-col rounded-l-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="Stack" size={18} className="text-accent" />
            <span className="font-medium text-fg">历史生成</span>
            <span className="text-xs text-fg-mute">{history.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={refresh} className="text-fg-mute transition-colors hover:text-fg" title="刷新">
              <Icon name="ArrowClockwise" size={16} />
            </button>
            <button onClick={close} className="text-fg-mute transition-colors hover:text-fg" aria-label="关闭">
              <Icon name="X" size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {history.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-mute">
              <Icon name="ImageSquare" size={28} />
              <span className="text-sm">还没有生成记录</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {history.map((it) => (
                <div key={it.name} className="group relative overflow-hidden rounded-control border border-line">
                  <button onClick={() => isVideo(it) ? pickVideo(it) : pickImage(it)} className="block w-full">
                    {isVideo(it) ? (
                      /* 视频卡片：黑底 + 播放图标 + 参数摘要 */
                      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-black/60">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-accent">
                          <Icon name="Play" size={18} weight="fill" />
                        </span>
                        {it.videoMeta && (
                          <span className="px-2 text-center text-[10px] leading-relaxed text-fg-mute">
                            {it.videoMeta.model} · {it.videoMeta.mode} · {it.videoMeta.duration}s
                          </span>
                        )}
                      </div>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={it.url} alt={it.name} className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                    )}
                  </button>

                  {/* 底部悬浮信息 */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[10px] text-fg-dim opacity-0 transition group-hover:opacity-100">
                    <span>{formatBytes(it.size)}</span>
                    {isVideo(it) && (
                      <span className="flex items-center gap-0.5">
                        <Icon name="VideoCamera" size={10} />
                        视频
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => del(it.name)}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-fg-dim opacity-0 backdrop-blur transition hover:text-red-300 group-hover:opacity-100"
                    title="删除"
                  >
                    <Icon name="Trash" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-line px-5 py-3 text-xs text-fg-mute">
          点击图片载入画布；点击视频切到视频创作并还原当时的参数
        </div>
      </motion.aside>
    </>
  );
}
