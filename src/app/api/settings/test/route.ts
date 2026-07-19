import { NextResponse } from "next/server";
import { probeApiKey } from "@/lib/probe.server";
import { clientIp, LIMITS, rateLimit } from "@/lib/rateLimit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 只测请求体里带的 key，绝不回退到任何已存储的 key —— 否则会变成
// 「探测他人令牌是否有效」的预言机。进门前也要能测，所以无登录门禁。
export async function POST(req: Request) {
  if (!rateLimit("entry", clientIp(req), LIMITS.ENTRY_PER_IP)) {
    return NextResponse.json({ ok: false, reachable: false, message: "尝试过于频繁，请稍后再试", baseUrl: "" }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  return NextResponse.json(await probeApiKey(apiKey));
}
