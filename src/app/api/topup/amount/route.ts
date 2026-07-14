import { NextResponse } from "next/server";
import { NEWAPI_BASE_URL, requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 后台只开了微信支付，写死。
const PAYMENT_METHOD = "wxpay";

// 代理 user/amount（问价）：这个接口不用 success 字段区分成败，靠 message 是否
// 等于 "success"——失败时 data 本身就是中文提示，直接透传给前端当 error。
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = typeof body.amount === "number" ? body.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "请输入有效的充值金额" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${NEWAPI_BASE_URL}/api/user/amount`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: auth.session, "New-Api-User": auth.uid },
      body: JSON.stringify({ amount, payment_method: PAYMENT_METHOD }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "无法连接账户服务，请检查网络后重试" }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as { message?: string; data?: string } | null;
  if (!json) return NextResponse.json({ error: "问价响应异常" }, { status: 502 });

  if (json.message !== "success") {
    return NextResponse.json({ error: json.data || "问价失败" }, { status: 400 });
  }
  return NextResponse.json({ pay: json.data ?? "" });
}
