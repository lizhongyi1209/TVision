import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ensureWorkflowRun } from "@/lib/workflowRunner.server";
import { readWorkflowRun } from "@/lib/workflowStore.server";
import { toPublicWorkflowRun } from "@/lib/workflowTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  let run = await readWorkflowRun(auth.uid, id);
  if (!run) return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
  if (run.status === "queued" || run.status === "running") {
    ensureWorkflowRun(auth.uid, run.id);
    run = await readWorkflowRun(auth.uid, id) || run;
  }
  return NextResponse.json({ run: toPublicWorkflowRun(run) }, { headers: { "Cache-Control": "no-store" } });
}
