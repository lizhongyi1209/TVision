// Server-side session bridge to the upstream new-api account system. This app
// has no accounts of its own — login just proxies new-api's /api/user/login
// and mirrors the session it hands back into our own httpOnly cookie, so the
// upstream session token never reaches browser JS (same reasoning as
// settings.ts keeping the o1key API key server-only). Imported by route
// handlers only.

import { cookies } from "next/headers";
import type { AuthUser } from "./types";

// 直接写死上游地址，不读环境变量：不同电脑/终端里各自残留的 NEWAPI_BASE_URL
// 曾经指向过一个已经失效的旧域名（vip.o1key.com），一旦哪台机器的用户级环境
// 变量还留着旧值，登录/2FA/充值/Agent 对话等所有走这个地址的请求就会全部
// 502。写死后换新装一台电脑、换个终端窗口都不受影响，和 o1key.ts 里
// NETWORK_ROUTES 的做法一致（那边的图片生成地址本来就是写死的，从没出过这个问题）。
export const NEWAPI_BASE_URL = "https://api.o1key.cn";

const AUTH_COOKIE = "tv_auth";
const TWOFA_COOKIE = "tv_2fa";
const AUTH_MAX_AGE = 60 * 60 * 24 * 30; // 30 天
const TWOFA_MAX_AGE = 60 * 5; // 两步验证中转 session 只活 5 分钟

export interface AuthSession {
  /** 上游 "session=xxxx" cookie（name=value，不含过期时间等属性），原样转发用。 */
  session: string;
  uid: string;
  username: string;
}

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, path: "/" };

/** 读本站会话 cookie，缺失或损坏一律视为未登录。 */
export async function getAuth(): Promise<AuthSession | null> {
  const store = await cookies();
  const raw = store.get(AUTH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.session || !parsed.uid || !parsed.username) return null;
    return { session: parsed.session, uid: String(parsed.uid), username: parsed.username };
  } catch {
    return null;
  }
}

/** 路由守卫：调用方判空后直接回 401，不抛异常，保持每处接线三行以内。 */
export async function requireAuth(): Promise<AuthSession | null> {
  return getAuth();
}

export async function setAuth(a: AuthSession): Promise<void> {
  const store = await cookies();
  store.set(AUTH_COOKIE, JSON.stringify(a), { ...COOKIE_OPTS, maxAge: AUTH_MAX_AGE });
}

export async function clearAuth(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
}

export async function setPending2fa(session: string): Promise<void> {
  const store = await cookies();
  store.set(TWOFA_COOKIE, session, { ...COOKIE_OPTS, maxAge: TWOFA_MAX_AGE });
}

export async function getPending2fa(): Promise<string | null> {
  const store = await cookies();
  return store.get(TWOFA_COOKIE)?.value || null;
}

export async function clearPending2fa(): Promise<void> {
  const store = await cookies();
  store.delete(TWOFA_COOKIE);
}

/** 上游 new-api 的 message 是英文的，界面要求全中文 —— 已知措辞逐条映射，
 *  没命中的：本身含中文就原样透传，纯英文则回退到调用方给的兜底文案。 */
export function zhMessage(message: unknown, fallback: string): string {
  const msg = typeof message === "string" ? message.trim() : "";
  if (!msg) return fallback;
  if (/incorrect|banned/i.test(msg)) return "账号或密码错误，或账号已被封禁";
  if (/rate ?limit|too many/i.test(msg)) return "尝试次数过多，请稍后再试";
  if (/expired/i.test(msg)) return "会话已过期，请重新登录";
  if (/[一-鿿]/.test(msg)) return msg;
  return fallback;
}

/** 从上游响应头摘出 "session=xxxx"（去掉 Path/HttpOnly 等属性），供后续转发用；
 *  没下发则返回 null。多个 Set-Cookie 时优先用 getSetCookie()（Node fetch 才有），
 *  没有就退回拼接过的单行 get("set-cookie")。 */
export function extractSessionCookie(res: Response): string | null {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = all.find((c) => c.startsWith("session=")) || res.headers.get("set-cookie") || "";
  if (!raw.startsWith("session=")) return null;
  return raw.split(";")[0];
}

/** 代理 GET /api/user/self，成功才返回用户对象，其余（网络失败/success:false/无 data）一律 null。 */
export async function fetchSelf(auth: AuthSession): Promise<AuthUser | null> {
  let res: Response;
  try {
    res = await fetch(`${NEWAPI_BASE_URL}/api/user/self`, {
      headers: { Cookie: auth.session, "New-Api-User": auth.uid },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: Record<string, unknown> }
    | null;
  if (!json || json.success === false || !json.data) return null;
  const d = json.data;
  return {
    id: (d.id as number | string | undefined) ?? auth.uid,
    username: String(d.username ?? auth.username),
    display_name: d.display_name ? String(d.display_name) : undefined,
    quota: typeof d.quota === "number" ? d.quota : undefined,
  };
}
