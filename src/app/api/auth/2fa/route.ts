import { NextResponse } from "next/server";
import { AUTH_MODE, clearPending2fa, getPending2fa, NEWAPI_BASE_URL, setAuth, zhMessage } from "@/lib/auth";
import type { AuthUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (AUTH_MODE === "token") return NextResponse.json({ error: "登录功能已停用，请直接填入 API 令牌" }, { status: 501 });
  const pending = await getPending2fa();
  if (!pending) return NextResponse.json({ error: "验证已超时，请重新登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return NextResponse.json({ error: "请输入验证码" }, { status: 400 });

  let res: Response;
  try {
    res = await fetch(`${NEWAPI_BASE_URL}/api/user/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: pending },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: "无法连接账户服务，请检查网络后重试" }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; message?: string; data?: Record<string, unknown> }
    | null;
  if (!json || !json.success || !json.data) {
    return NextResponse.json({ error: zhMessage(json?.message, "验证码错误") }, { status: 401 });
  }

  const d = json.data;
  const uid = String(d.id ?? "");
  if (!uid) return NextResponse.json({ error: "验证响应异常：缺少用户 ID" }, { status: 502 });

  await setAuth({ session: pending, uid, username: String(d.username ?? "") });
  await clearPending2fa();

  const user: AuthUser = {
    id: d.id as number | string,
    username: String(d.username ?? ""),
    display_name: d.display_name ? String(d.display_name) : undefined,
    quota: typeof d.quota === "number" ? d.quota : undefined,
  };
  return NextResponse.json({ user });
}
