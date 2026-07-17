import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { requestWorkflowRunStop } from "@/lib/workflowRunner.server";
import { toPublicWorkflowRun } from "@/lib/workflowTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const run = await requestWorkflowRunStop(auth.uid, id);
  if (!run) return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
  return NextResponse.json({ run: toPublicWorkflowRun(run) });
}
