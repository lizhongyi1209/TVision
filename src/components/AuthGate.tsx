"use client";

// Top-level auth switch: loading -> anon -> authed. Also re-checks the
// session on tab refocus (silent — a lapsed upstream session just drops the
// user back to LoginScreen, no toast/alert needed).

import { useEffect } from "react";
import { useAuth } from "@/lib/authStore";
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
