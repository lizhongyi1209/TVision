"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { type LogEntry, type LogLevel, useLogStore } from "@/lib/logStore";
import { cn, formatClock } from "@/lib/utils";
import { Icon } from "./icons";

const DOT_CLASS: Record<LogLevel, string> = {
  error: "bg-red-400",
  warn: "bg-amber-300",
  info: "bg-fg-mute",
};

function buildPlainText(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const head = `[${formatClock(e.ts)}] [${e.level.toUpperCase()}] ${e.source} · ${e.message}`;
      return e.detail ? `${head}\n${e.detail}` : head;
    })
    .join("\n\n");
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyDetail(e: React.MouseEvent) {
    e.stopPropagation();
    if (!entry.detail) return;
    try {
      await navigator.clipboard.writeText(entry.detail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard permission denied or unavailable
    }
  }

  return (
    <div className="border-b border-line/60 last:border-0">
      <button
        type="button"
        onClick={() => entry.detail && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-start gap-2.5 px-5 py-2.5 text-left transition-colors",
          entry.detail ? "cursor-pointer hover:bg-white/[0.03]" : "cursor-default",
        )}
      >
        <span className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[entry.level])} />
        <span className="w-[62px] shrink-0 pt-px font-mono text-[11px] text-fg-mute">{formatClock(entry.ts)}</span>
        <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-fg-mute">{entry.source}</span>
        <span className="min-w-0 flex-1 text-sm leading-snug text-fg">{entry.message}</span>
        {entry.detail ? (
          <Icon
            name="CaretDown"
            size={12}
            className={cn("mt-1 shrink-0 text-fg-mute transition-transform", open && "rotate-180")}
          />
        ) : null}
      </button>
      {entry.detail && open ? (
        <div className="px-5 pb-3">
          <div className="relative rounded-control border border-line bg-black/30">
            <button
              type="button"
              onClick={copyDetail}
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] text-fg-dim transition-colors hover:bg-white/15 hover:text-fg"
            >
              <Icon name={copied ? "Check" : "Copy"} size={11} />
              {copied ? "已复制" : "复制"}
            </button>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all p-3 pr-16 font-mono text-[11px] leading-relaxed text-fg-dim">
              {entry.detail}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DiagnosticsPanel() {
  const entries = useLogStore((s) => s.entries);
  const close = useLogStore((s) => s.closePanel);
  const clearLogs = useLogStore((s) => s.clear);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  async function copyAll() {
    if (entries.length === 0) return;
    try {
      await navigator.clipboard.writeText(buildPlainText(entries));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      // ignore
    }
  }

  const ordered = [...entries].reverse(); // newest first

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
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Icon name="Pulse" size={15} weight="bold" />
            </span>
            <div>
              <div className="text-sm font-medium text-fg">诊断台</div>
              <div className="text-xs text-fg-mute">本次会话的运行日志与报错详情</div>
            </div>
          </div>
          <button onClick={close} className="text-fg-mute hover:text-fg" aria-label="关闭">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
          <span className="text-xs text-fg-mute">{entries.length} 条日志</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={copyAll}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs text-fg-dim transition-colors hover:text-fg",
                entries.length === 0 && "pointer-events-none opacity-30",
              )}
            >
              <Icon name={copiedAll ? "Check" : "Copy"} size={13} />
              {copiedAll ? "已复制" : "复制全部"}
            </button>
            <button
              type="button"
              onClick={clearLogs}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs text-fg-dim transition-colors hover:text-fg",
                entries.length === 0 && "pointer-events-none opacity-30",
              )}
            >
              <Icon name="Trash" size={13} />
              清空
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-fg-mute">
              <Icon name="Pulse" size={28} />
              <span className="text-sm">暂无日志，生成图片时的运行记录和报错会出现在这里</span>
            </div>
          ) : (
            ordered.map((e) => <LogRow key={e.id} entry={e} />)
          )}
        </div>
      </motion.aside>
    </>
  );
}
