"use client";

import { useCallback, useEffect } from "react";
import { useStudio } from "@/lib/store";
import { useVideoStore } from "@/lib/videoStore";
import { formatBytes } from "@/lib/utils";
import { Icon } from "./icons";
import type { HistoryItem } from "@/lib/types";

// 历史生成（独立导航页，原为 HistoryRail 侧栏）：图片与视频生成记录统一列表，
// 数据都来自 /api/history（output/ 目录 + data/video-meta.json sidecar）。
// 点击图片：载入单图创作画布并还原当时参数，切到单图创作。
// 点击视频：切到视频创作播放，并还原当时参数。
// 视频生成完成后已经和图片一样写入 output/（见 VideoWorkshop.tsx 里的
// /api/video/save 调用），所以这里不需要区分来源，单一列表即可。

export function HistoryPage() {
  const history = useStudio((s) => s.history);
  const setHistory = useStudio((s) => s.setHistory);
  const useAsCanvas = useStudio((s) => s.useResultAsCanvas);
  const updateParams = useStudio((s) => s.updateParams);
  const setWorkMode = useStudio((s) => s.setWorkMode);
  const showToast = useStudio((s) => s.showToast);

  // 视频参数还原
  const setVideoModel  = useVideoStore((s) => s.setModel);
  const setVideoMode   = useVideoStore((s) => s.setMode);
  const setDuration    = useVideoStore((s) => s.setDuration);
  const setPrompt      = useVideoStore((s) => s.setPrompt);
  const setSound       = useVideoStore((s) => s.setSound);
  const setAspectRatio = useVideoStore((s) => s.setAspectRatio);
  const setShots       = useVideoStore((s) => s.setShots);
  const toggleShots    = useVideoStore((s) => s.toggleShots);
  const shotsEnabled   = useVideoStore((s) => s.shotsEnabled);
  const playHistory    = useVideoStore((s) => s.playHistory);

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
        showToast("success", "已切到单图创作，并还原当时的提示词与参数");
      } else {
        showToast("success", "已切到单图创作");
      }
      setWorkMode("single");
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
    <div className="relative flex-1 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(58% 52% at 50% 30%, rgba(230,178,119,0.05), transparent 70%)" }}
      />

      <div className="absolute inset-0 overflow-y-auto px-8 py-6">
        <div className="mx-auto w-full max-w-[1200px]">
          {/* 页头 */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <Icon name="Stack" size={20} className="text-accent" />
                <h1 className="text-lg font-medium text-fg">历史生成</h1>
                <span className="text-xs text-fg-mute">{history.length}</span>
              </div>
              <p className="mt-1.5 text-sm text-fg-mute">
                点击图片载入画布并还原当时参数；点击视频切到视频创作播放并还原当时参数
              </p>
            </div>
            <button
              onClick={refresh}
              className="flex h-9 items-center gap-1.5 rounded-control border border-line px-3 text-xs text-fg-mute transition-colors hover:border-line-2 hover:text-fg"
              title="刷新"
            >
              <Icon name="ArrowClockwise" size={14} />
              刷新
            </button>
          </div>

          {/* 记录网格 */}
          <div className="mt-7">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-fg-mute">
                <Icon name="ImageSquare" size={28} />
                <span className="text-sm">还没有生成记录</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {history.map((it) => (
                  <div key={it.name} className="group relative overflow-hidden rounded-control border border-line">
                    <button onClick={() => (isVideo(it) ? pickVideo(it) : pickImage(it))} className="block w-full">
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
        </div>
      </div>
    </div>
  );
}
