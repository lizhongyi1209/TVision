import { NextResponse } from "next/server";
import { AUTH_MODE, NEWAPI_BASE_URL, requireAuth, zhMessage } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 代理 user/topup（兑换码）：这个接口走标准的 success/message 形状。
export async function POST(req: Request) {
  if (AUTH_MODE === "token") return NextResponse.json({ error: "在线充值暂不可用，请前往 o1key 官网充值" }, { status: 501 });
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return NextResponse.json({ error: "请输入兑换码" }, { status: 400 });

  let res: Response;
  try {
    res = await fetch(`${NEWAPI_BASE_URL}/api/user/topup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: auth.session, "New-Api-User": auth.uid },
      body: JSON.stringify({ key }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "无法连接账户服务，请检查网络后重试" }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as { success?: boolean; message?: string; data?: unknown } | null;
  if (!json || !json.success) {
    return NextResponse.json({ error: zhMessage(json?.message, "兑换失败，请检查兑换码") }, { status: 400 });
  }

  return NextResponse.json({ ok: true, quota: json.data });
}
