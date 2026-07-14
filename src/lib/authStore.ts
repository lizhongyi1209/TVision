"use client";

// Auth state for the login gate + UserChip. Mirrors store.ts's shape (plain
// zustand, no persistence) — session truth lives server-side in the tv_auth
// httpOnly cookie; this store just reflects what /api/auth/* last told us.

import { create } from "zustand";
import type { AuthUser } from "./types";

export type AuthStatus = "loading" | "anon" | "authed";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  /** True while a login/2fa/logout request is in flight (buttons disable on this). */
  busy: boolean;
  /** Non-null once the password step succeeds but the account needs a 2FA code. */
  need2fa: boolean;

  /** Silent session check on mount / tab refocus — never surfaces its own error banner. */
  check: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  verify2fa: (code: string) => Promise<void>;
  /** Back out of the 2FA step to the password form. */
  cancel2fa: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

export const useAuth = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  error: null,
  busy: false,
  need2fa: false,

  check: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return set({ status: "anon", user: null });
      const j = await parseJson(res);
      set({ status: "authed", user: (j.user as AuthUser) ?? null });
    } catch {
      set({ status: "anon", user: null });
    }
  },

  login: async (username, password) => {
    set({ busy: true, error: null });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const j = await parseJson(res);
      if (!res.ok) {
        set({ busy: false, error: (j.error as string) || "登录失败" });
        return;
      }
      if (j.need2fa) {
        set({ busy: false, need2fa: true });
        return;
      }
      set({ busy: false, status: "authed", user: (j.user as AuthUser) ?? null, need2fa: false });
    } catch {
      set({ busy: false, error: "网络请求失败" });
    }
  },

  verify2fa: async (code) => {
    set({ busy: true, error: null });
    try {
      const res = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await parseJson(res);
      if (!res.ok) {
        set({ busy: false, error: (j.error as string) || "验证码错误" });
        return;
      }
      set({ busy: false, status: "authed", user: (j.user as AuthUser) ?? null, need2fa: false });
    } catch {
      set({ busy: false, error: "网络请求失败" });
    }
  },

  cancel2fa: () => set({ need2fa: false, error: null }),

  logout: async () => {
    set({ busy: true });
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 忽略：无论如何都回登录页
    }
    set({ busy: false, status: "anon", user: null, need2fa: false, error: null });
  },

  clearError: () => set({ error: null }),
}));
