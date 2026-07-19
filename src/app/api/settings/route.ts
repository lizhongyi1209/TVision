import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings, toPublic } from "@/lib/settings";
import { clearTenantCookie, createTenant } from "@/lib/tenant.server";
import { probeApiKey } from "@/lib/probe.server";
import { clientIp, LIMITS, rateLimit } from "@/lib/rateLimit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const s = await readSettings(auth.uid);
  return NextResponse.json(toPublic(s));
}

// 「进门即绑定」：贴令牌 = 建租户 + 种 cookie，这就是 token 模式下的登录动作，
// 所以本路由不设登录门禁。clearApiKey = 登出（只清 cookie，租户数据保留，
// 重贴同一令牌即恢复 —— 令牌即身份）。
export async function POST(req: Request) {
  if (!rateLimit("entry", clientIp(req), LIMITS.ENTRY_PER_IP)) {
    return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.clearApiKey === true) {
    await clearTenantCookie();
    return NextResponse.json({ hasApiKey: false, apiKeyMasked: "" });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return NextResponse.json({ error: "请填写 API 令牌" }, { status: 400 });

  // 先探测上游是否接受这个令牌，被拒的不建租户（防止垃圾 uid 堆积）。
  const probe = await probeApiKey(apiKey);
  if (!probe.ok) return NextResponse.json({ error: probe.message }, { status: 400 });

  const tenant = await createTenant(apiKey);
  const s = await readSettings(tenant.uid);
  return NextResponse.json(toPublic(s));
}
