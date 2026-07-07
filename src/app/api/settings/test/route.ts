import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { resolveBaseUrl, TASK_ENDPOINT } from "@/lib/o1key";
import type { RouteName } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cheap connectivity + auth probe: query a nonexistent task id.
// 401/403 => the token is rejected. Any other response => reachable and the
// token was accepted. We cannot fully validate a key without spending credits,
// so the UI states that key validity is confirmed on the first real generation.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = await readSettings();

  const apiKey = (typeof body.apiKey === "string" && body.apiKey.trim()) || s.apiKey;
  const route = ((body.route as RouteName) || s.route) as RouteName;
  const override = typeof body.baseUrlOverride === "string" ? body.baseUrlOverride : s.baseUrlOverride;
  const baseUrl = resolveBaseUrl(route, override);

  if (!apiKey) {
    return NextResponse.json({ ok: false, reachable: false, message: "未设置 API 令牌", baseUrl });
  }

  const url = `${baseUrl}${TASK_ENDPOINT}connectivity-probe-000`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        ok: false,
        reachable: true,
        message: `令牌被拒绝 (HTTP ${res.status})，请检查 o1key 令牌是否正确`,
        baseUrl,
      });
    }
    return NextResponse.json({
      ok: true,
      reachable: true,
      message: `连接正常（${baseUrl}），令牌已被接受。首次生成时会真正校验额度。`,
      baseUrl,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      reachable: false,
      message: `无法连接 ${baseUrl}：${(e as Error)?.message || e}。可尝试切换线路。`,
      baseUrl,
    });
  }
}
