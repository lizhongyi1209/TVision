import { NextResponse } from "next/server";
import { AUTH_MODE, clearAuth, getAuth, NEWAPI_BASE_URL } from "@/lib/auth";
import { clearTenantCookie } from "@/lib/tenant.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 尽力通知上游登出，失败也不影响本地清会话——用户体感上"退出"始终成功。
// token 模式：只清租户 cookie；租户数据保留，重贴同一令牌即恢复。
export async function POST() {
  if (AUTH_MODE === "token") {
    await clearTenantCookie();
    return NextResponse.json({ ok: true });
  }
  const auth = await getAuth();
  if (auth) {
    try {
      await fetch(`${NEWAPI_BASE_URL}/api/user/logout`, {
        headers: { Cookie: auth.session, "New-Api-User": auth.uid },
        cache: "no-store",
      });
    } catch {
      // 忽略：上游不可达也继续清本地会话
    }
  }
  await clearAuth();
  return NextResponse.json({ ok: true });
}
