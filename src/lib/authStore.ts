"use client";

// Auth state for the login gate + UserChip. Mirrors store.ts's shape (plain
// zustand, no persistence) — session truth lives server-side in the tv_auth
// httpOnly cookie; this store just reflects what /api/auth/* last told us.

import { create } from "zustand";
import type { AuthUser } from "./types";

export type AuthStatus = "loading" | "anon" | "authed";
export type AuthMode = "token" | "login";

interface AuthState {
  status: AuthStatus;
  /** 服务端声明的鉴权模式：token = 贴令牌进门（登录停用），login = 上游账号登录。 */
  mode: AuthMode;
  user: AuthUser | null;
  error: string | null;
  /** True while a login/2fa/logout request is in flight (buttons disable on this). */
  busy: boolean;
  /** Non-null once the password step succeeds but the account needs a 2FA code. */
  need2fa: boolean;

  /** Silent session check on mount / tab refocus — never surfaces its own error banner. */
  check: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  /** token 模式的进门动作：贴令牌 → POST /api/settings 建租户 + 种 cookie。 */
  enterToken: (apiKey: string) => Promise<void>;
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
  mode: "token",
  user: null,
  error: null,
  busy: false,
  need2fa: false,

  check: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const j = await parseJson(res);
      const mode = (j.mode as AuthMode) === "login" ? "login" : "token";
      if (!res.ok) return set({ status: "anon", mode, user: null });
      set({ status: "authed", mode, user: (j.user as AuthUser) ?? null });
    } catch {
      set({ status: "anon", user: null });
    }
  },

  enterToken: async (apiKey) => {
    set({ busy: true, error: null });
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const j = await parseJson(res);
      if (!res.ok) {
        set({ busy: false, error: (j.error as string) || "令牌验证失败" });
        return;
      }
      const masked = (j.apiKeyMasked as string) || "已绑定令牌";
      set({ busy: false, status: "authed", user: { id: masked, username: masked } });
    } catch {
      set({ busy: false, error: "网络请求失败" });
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
