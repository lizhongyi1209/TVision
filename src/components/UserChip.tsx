"use client";

// Glass pill in the studio's top bar: avatar initial + username, opens a
// dropdown with quota / console link / logout. Same outside-click-closes
// pattern as ui.tsx's Select.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/authStore";
import { useLogStore } from "@/lib/logStore";
import { useStudio } from "@/lib/store";
import { useTaskStore } from "@/lib/taskStore";
import { QUOTA_PER_UNIT } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { TopupModal } from "./TopupModal";

export function UserChip() {
  const user = useAuth((s) => s.user);
  const mode = useAuth((s) => s.mode);
  const logout = useAuth((s) => s.logout);
  const taskDirty = useTaskStore((s) => s.dirty);
  const openSettings = useStudio((s) => s.openSettings);
  const closeDiagPanel = useLogStore((s) => s.closePanel);
  const [open, setOpen] = useState(false);

  // Mirrors Studio's mutually-exclusive panel behavior: opening token
  // settings from the dropdown must also collapse the diagnostics panel
  // (openSettings itself already closes the history panel).
  function openTokenSettings() {
    closeDiagPanel();
    openSettings();
  }
  // 弹窗开关跟下拉菜单的开关状态分开：关下拉不该顺手关掉正在充值的弹窗。
  const [topupOpen, setTopupOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  if (!user) return null;

  // 展示以登录账号名为准（display_name 上游常是 "Root User" 之类的占位，退居次行）。
  const name = user.username;
  const initial = name.slice(0, 1).toUpperCase();
  const quota = typeof user.quota === "number" ? (user.quota / QUOTA_PER_UNIT).toFixed(2) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 items-center gap-2 rounded-full border border-line bg-panel-2 pl-1.5 pr-3 text-sm text-fg transition-colors hover:border-line-2",
          open && "border-accent",
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-ink">
          {initial}
        </span>
        <span className="max-w-[120px] truncate">{name}</span>
        <Icon
          name="CaretDown"
          size={13}
          className={cn("text-fg-mute transition-transform duration-200", open && "rotate-180 text-fg-dim")}
        />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
            className="glass absolute right-0 top-[calc(100%+8px)] z-50 w-56 origin-top-right rounded-[14px] p-1.5"
          >
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-fg">{name}</p>
              {quota !== null ? <p className="mt-1 text-xs text-accent">额度 ¥{quota}</p> : null}
            </div>
            <div className="my-1 h-px bg-line" />
            {/* 充值走上游账号 session，token 模式下不可用（代码保留，切回 login 模式恢复） */}
            {mode === "login" ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setTopupOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-sm text-fg-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
              >
                <Icon name="Coins" size={15} />
                充值
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openTokenSettings();
              }}
              className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-sm text-fg-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
            >
              <Icon name="Key" size={15} />
              令牌设置
            </button>
            <a
              href="https://api.o1key.cn/console"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-sm text-fg-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
            >
              <Icon name="ArrowSquareOut" size={15} />
              控制台
            </a>
            <button
              type="button"
              onClick={() => {
                if (taskDirty && !window.confirm("当前任务流程有未保存修改，确定退出吗？")) return;
                setOpen(false);
                void logout();
              }}
              className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-sm text-fg-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
            >
              <Icon name="Power" size={15} />
              {mode === "token" ? "退出（重贴令牌可恢复）" : "退出登录"}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{topupOpen ? <TopupModal onClose={() => setTopupOpen(false)} /> : null}</AnimatePresence>
    </div>
  );
}
