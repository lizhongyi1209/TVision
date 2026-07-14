import { NextResponse } from "next/server";
import { extractSessionCookie, NEWAPI_BASE_URL, setAuth, setPending2fa, zhMessage } from "@/lib/auth";
import type { AuthUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 上游用各种措辞提示需要两步验证，且开了 2FA 时 success 本身就是 false —
 *  message/data 里任一透出"两步/2FA/two-factor"或 data.require_2fa 类字段都算。 */
function needs2fa(message: unknown, data: unknown): boolean {
  const msg = typeof message === "string" ? message : "";
  if (/两步|2fa|two-factor/i.test(msg)) return true;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    return !!(d.require_2fa || d.need_2fa || d.require2FA || d.two_factor);
  }
  return false;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${NEWAPI_BASE_URL}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: "无法连接账户服务，请检查网络后重试" }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; message?: string; data?: Record<string, unknown> }
    | null;
  if (!json) return NextResponse.json({ error: "登录响应异常" }, { status: 502 });

  const sessionCookie = extractSessionCookie(res);

  if (json.success === false && needs2fa(json.message, json.data)) {
    // 两步验证第一步也会下发 session，必须保留给第二步用。
    if (!sessionCookie) return NextResponse.json({ error: "登录响应异常：缺少会话" }, { status: 502 });
    await setPending2fa(sessionCookie);
    return NextResponse.json({ need2fa: true });
  }

  if (!json.success || !json.data) {
    return NextResponse.json({ error: zhMessage(json.message, "登录失败，请检查账号密码") }, { status: 401 });
  }
  if (!sessionCookie) return NextResponse.json({ error: "登录响应异常：缺少会话" }, { status: 502 });

  const d = json.data;
  const uid = String(d.id ?? "");
  if (!uid) return NextResponse.json({ error: "登录响应异常：缺少用户 ID" }, { status: 502 });

  await setAuth({ session: sessionCookie, uid, username: String(d.username ?? username) });

  const user: AuthUser = {
    id: d.id as number | string,
    username: String(d.username ?? username),
    display_name: d.display_name ? String(d.display_name) : undefined,
    quota: typeof d.quota === "number" ? d.quota : undefined,
  };
  return NextResponse.json({ user });
}
