"use client";

// 全局左侧导航栏（PLAN-BOARD 起）：原顶栏 Segmented 的 8 个工作区搬到这里，
// 顶栏只留 Logo / 诊断台 / 账号。运行中指示点沿用原顶栏的约定：任务模式 /
// 批量工坊 / 视频创作 / 画布有活跃任务时呼吸点提示。

import { useBatchStore } from "@/lib/batchStore";
import { useBoardStore } from "@/lib/boardStore";
import { useStudio, type WorkMode } from "@/lib/store";
import { useTaskStore } from "@/lib/taskStore";
import { useVideoStore } from "@/lib/videoStore";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

const ITEMS: { value: WorkMode; label: string; icon: string }[] = [
  { value: "board", label: "画布", icon: "FrameCorners" },
  { value: "single", label: "单图创作", icon: "ImageSquare" },
  { value: "task", label: "任务模式", icon: "Stack" },
  { value: "batch", label: "批量工坊", icon: "CoatHanger" },
  { value: "agent", label: "Agent", icon: "Sparkle" },
  { value: "templates", label: "模板", icon: "BookmarksSimple" },
  { value: "video", label: "视频创作", icon: "FilmSlate" },
  { value: "history", label: "资产", icon: "ClockCountdown" },
];

export function SideNav() {
  const workMode = useStudio((s) => s.workMode);
  const setWorkMode = useStudio((s) => s.setWorkMode);
  const taskRunStatus = useTaskStore((s) => s.currentRun?.status);
  const batchRunState = useBatchStore((s) => s.runState);
  const videoPhase = useVideoStore((s) => s.phase);
  const boardGenCount = useBoardStore((s) => s.gens.filter((g) => g.status !== "failed").length);

  const running: Partial<Record<WorkMode, boolean>> = {
    task: taskRunStatus === "queued" || taskRunStatus === "running",
    batch: batchRunState === "running",
    video: ["uploading", "submitting", "running"].includes(videoPhase),
    board: boardGenCount > 0,
  };

  return (
    <nav className="flex w-14 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line px-2 py-3 md:w-[148px] md:px-2.5">
      {ITEMS.map((it) => {
        const active = workMode === it.value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => setWorkMode(it.value)}
            title={it.label}
            className={cn(
              "relative flex h-10 shrink-0 items-center justify-center gap-2.5 rounded-control px-0 text-sm transition-all duration-200 md:justify-start md:px-3",
              active ? "bg-accent font-medium text-ink" : "text-fg-dim hover:bg-white/5 hover:text-fg",
            )}
          >
            <Icon name={it.icon} size={16} weight={active ? "bold" : "regular"} />
            <span className="hidden flex-1 text-left md:block">{it.label}</span>
            {running[it.value] ? (
              <span
                className={cn(
                  "breathe absolute right-1 top-1 h-1.5 w-1.5 shrink-0 rounded-full md:static",
                  active ? "bg-ink" : "bg-accent",
                )}
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
