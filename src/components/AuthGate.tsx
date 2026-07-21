"use client";

// Top-level auth switch: loading -> anon -> authed. Also re-checks the
// session on tab refocus (silent — a lapsed upstream session just drops the
// user back to LoginScreen, no toast/alert needed).

import { useEffect } from "react";
import { useAuth } from "@/lib/authStore";
import { useBoardStore } from "@/lib/boardStore";
import { useTaskStore } from "@/lib/taskStore";
import { Grain } from "./Grain";
import { LoginScreen } from "./LoginScreen";
import Studio from "./Studio";

export function AuthGate() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const check = useAuth((s) => s.check);
  const taskOwnerKey = useTaskStore((s) => s.ownerKey);
  const taskDirty = useTaskStore((s) => s.dirty);
  const resetTasks = useTaskStore((s) => s.reset);
  const boardOwnerKey = useBoardStore((s) => s.ownerKey);
  const resetBoards = useBoardStore((s) => s.reset);
  const ownerKey = status === "authed" ? String(user?.id ?? user?.username ?? "unknown") : null;

  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  // Task state contains account-owned workflow definitions and run details.
  // Gate Studio until the store has been cleared/re-keyed for this session so
  // the previous account cannot flash on screen or accept stale async writes.
  useEffect(() => {
    if (taskOwnerKey !== ownerKey) resetTasks(ownerKey);
  }, [ownerKey, resetTasks, taskOwnerKey]);

  // 画布同理：换账号即清内存画布 + 作废在途的保存/生成异步写（epoch 机制，
  // 见 boardStore.reset）。画布进入时才拉列表，无需 task 那样的渲染门。
  useEffect(() => {
    if (boardOwnerKey !== ownerKey) resetBoards(ownerKey);
  }, [ownerKey, resetBoards, boardOwnerKey]);

  useEffect(() => {
    if (!taskDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [taskDirty]);

  if (status === "loading" || (status === "authed" && taskOwnerKey !== ownerKey)) {
    return (
      <div className="relative h-[100dvh] bg-ink">
        <Grain />
      </div>
    );
  }
  if (status === "anon") return <LoginScreen />;
  return <Studio />;
}
