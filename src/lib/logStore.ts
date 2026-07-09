"use client";

// Independent diagnostics log store — deliberately NOT merged into useStudio
// (src/lib/store.ts). Log entries can be appended at a high frequency during
// polling; keeping them in their own store means components that only care
// about studio state never re-render because a log line was appended.

import { create } from "zustand";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: number; // Date.now()
  level: LogLevel;
  source: string; // e.g. "提交" | "轮询" | "连接测试" | "系统"
  message: string; // one-line summary
  detail?: string; // expandable raw text: full server error, param JSON, etc.
}

const MAX_ENTRIES = 200;
let seq = 1;

interface LogState {
  entries: LogEntry[];
  unreadErrors: number;
  panelOpen: boolean;

  log: (level: LogLevel, source: string, message: string, detail?: string) => void;
  clear: () => void;
  markRead: () => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  unreadErrors: 0,
  panelOpen: false,

  log: (level, source, message, detail) =>
    set((s) => {
      const entry: LogEntry = { id: seq++, ts: Date.now(), level, source, message, detail };
      // Ring buffer: keep only the most recent MAX_ENTRIES, oldest dropped first.
      const entries = [...s.entries, entry].slice(-MAX_ENTRIES);
      const unreadErrors = level === "error" && !s.panelOpen ? s.unreadErrors + 1 : s.unreadErrors;
      return { entries, unreadErrors };
    }),

  clear: () => set({ entries: [] }),
  markRead: () => set({ unreadErrors: 0 }),

  togglePanel: () =>
    set((s) => {
      const next = !s.panelOpen;
      return { panelOpen: next, unreadErrors: next ? 0 : s.unreadErrors };
    }),
  openPanel: () => set({ panelOpen: true, unreadErrors: 0 }),
  closePanel: () => set({ panelOpen: false }),
}));

/**
 * Convenience function for call sites that aren't React components (or don't
 * want to wire up the hook just to log one line) — mirrors the store's own
 * `log` action via getState(). Safe to call from event handlers and effects.
 */
export function diag(level: LogLevel, source: string, message: string, detail?: string): void {
  useLogStore.getState().log(level, source, message, detail);
}
