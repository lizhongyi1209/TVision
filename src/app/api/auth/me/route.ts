import { NextResponse } from "next/server";
import { clearAuth, fetchSelf, getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 代理 user/self：本站 cookie 有效但上游会话已失效（改密码/被踢/过期）时，
// 顺手清掉本站 cookie，前端收到 401 就会自动退回登录页。
export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const user = await fetchSelf(auth);
  if (!user) {
    await clearAuth();
    return NextResponse.json({ error: "会话已失效，请重新登录" }, { status: 401 });
  }

  return NextResponse.json({ user });
}
