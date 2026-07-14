import { NextResponse } from "next/server";
import { NEWAPI_BASE_URL, requireAuth, zhMessage } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAYMENT_METHOD = "wxpay";

// 代理 user/pay：成功时上游给的 data 就是一整套要提交去易支付网关的表单字段
// （pid/sign/...），原样透传给前端去 POST 跳转；session 全程不出服务端。
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
    res = await fetch(`${NEWAPI_BASE_URL}/api/user/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: auth.session, "New-Api-User": auth.uid },
      body: JSON.stringify({ amount, payment_method: PAYMENT_METHOD }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "无法连接账户服务，请检查网络后重试" }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as
    | { message?: string; url?: string; data?: Record<string, unknown> }
    | null;
  if (!json || json.message !== "success" || !json.url || !json.data) {
    return NextResponse.json({ error: zhMessage(json?.message, "发起支付失败") }, { status: 400 });
  }

  return NextResponse.json({ url: json.url, params: json.data });
}
