import { NextResponse } from "next/server";
import { AUTH_MODE, NEWAPI_BASE_URL, requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PayMethod {
  name: string;
  type: string;
  min_topup: string;
}

// 代理 user/topup/info：只挑前端用得到的字段透传，别的（图标 URL 之类）不需要。
export async function GET() {
  if (AUTH_MODE === "token") return NextResponse.json({ error: "在线充值暂不可用，请前往 o1key 官网充值" }, { status: 501 });
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let res: Response;
  try {
    res = await fetch(`${NEWAPI_BASE_URL}/api/user/topup/info`, {
      headers: { Cookie: auth.session, "New-Api-User": auth.uid },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "无法连接账户服务，请检查网络后重试" }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as
    | {
        success?: boolean;
        data?: {
          amount_options?: number[];
          min_topup?: number;
          enable_online_topup?: boolean;
          enable_redemption?: boolean;
          pay_methods?: PayMethod[];
        };
      }
    | null;
  if (!json || !json.success || !json.data) {
    return NextResponse.json({ error: "获取充值信息失败" }, { status: 502 });
  }

  const d = json.data;
  return NextResponse.json({
    amount_options: d.amount_options ?? [],
    min_topup: d.min_topup ?? 0,
    enable_online_topup: !!d.enable_online_topup,
    enable_redemption: !!d.enable_redemption,
    pay_methods: d.pay_methods ?? [],
  });
}
