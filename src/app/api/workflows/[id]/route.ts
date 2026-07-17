import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  deleteWorkflow,
  normalizeWorkflowDraft,
  readWorkflow,
  updateWorkflow,
} from "@/lib/workflowStore.server";
import { validateWorkflow } from "@/lib/workflowTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DEFINITION_BYTES = 500_000;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const item = await readWorkflow(auth.uid, id);
  if (!item) return NextResponse.json({ error: "流程不存在" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const text = await req.text();
  if (Buffer.byteLength(text, "utf-8") > MAX_DEFINITION_BYTES) {
    return NextResponse.json({ error: "流程定义过大" }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "流程内容不是有效 JSON" }, { status: 400 });
  }
  const source = raw && typeof raw === "object" && "workflow" in raw
    ? (raw as { workflow?: unknown }).workflow
    : raw;
  const draft = normalizeWorkflowDraft(source);
  if (!draft) return NextResponse.json({ error: "流程内容无效" }, { status: 400 });
  const issues = validateWorkflow(draft);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length) return NextResponse.json({ error: errors[0].message, issues }, { status: 400 });
  const item = await updateWorkflow(auth.uid, id, draft);
  if (!item) return NextResponse.json({ error: "流程不存在" }, { status: 404 });
  return NextResponse.json({ item, issues });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const result = await deleteWorkflow(auth.uid, id);
  if (result === "active_run") {
    return NextResponse.json({ error: "该流程仍有运行中的任务，请先停止任务" }, { status: 409 });
  }
  const ok = result === "deleted";
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
