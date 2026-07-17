import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { retryWorkflowRun } from "@/lib/workflowRunner.server";
import { readWorkflowRun } from "@/lib/workflowStore.server";
import { toPublicWorkflowRun } from "@/lib/workflowTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const current = await readWorkflowRun(auth.uid, id);
  if (!current) return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
  if (current.status === "queued" || current.status === "running") {
    return NextResponse.json({ error: "该流程仍在运行" }, { status: 409 });
  }
  if (current.status === "success") {
    return NextResponse.json({ error: "成功的运行无需重试，请使用相同输入新建运行" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fromStepId = typeof body.fromStepId === "string" ? body.fromStepId : undefined;
  if (fromStepId && !current.steps.some((step) => step.nodeId === fromStepId)) {
    return NextResponse.json({ error: "重试步骤不存在" }, { status: 400 });
  }
  const retried = await retryWorkflowRun(auth.uid, id, fromStepId);
  if (retried.active) {
    return NextResponse.json(
      { error: "当前已有其他流程在运行", run: toPublicWorkflowRun(retried.active) },
      { status: 409 },
    );
  }
  if (!retried.run) return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
  return NextResponse.json({ run: toPublicWorkflowRun(retried.run) }, { status: 202 });
}
