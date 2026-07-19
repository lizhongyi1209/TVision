import { NextResponse } from "next/server";
import { AUTH_MODE, clearAuth, fetchSelf, getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 代理 user/self：本站 cookie 有效但上游会话已失效（改密码/被踢/过期）时，
// 顺手清掉本站 cookie，前端收到 401 就会自动退回登录页。
// token 模式：没有上游会话可查，直接把租户信息拼成 user 形状返回；
// 响应里始终带 mode，前端据此决定展示登录页还是贴令牌页。
export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "未登录", mode: AUTH_MODE }, { status: 401 });

  if (AUTH_MODE === "token") {
    return NextResponse.json({ user: { id: auth.uid, username: auth.username }, mode: AUTH_MODE });
  }

  const user = await fetchSelf(auth);
  if (!user) {
    await clearAuth();
    return NextResponse.json({ error: "会话已失效，请重新登录", mode: AUTH_MODE }, { status: 401 });
  }

  return NextResponse.json({ user, mode: AUTH_MODE });
}
