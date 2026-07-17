import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  createWorkflow,
  listWorkflows,
  normalizeWorkflowDraft,
} from "@/lib/workflowStore.server";
import { validateWorkflow } from "@/lib/workflowTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DEFINITION_BYTES = 500_000;

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ items: await listWorkflows(auth.uid) });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
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
  const item = await createWorkflow(auth.uid, draft);
  return NextResponse.json({ item, items: await listWorkflows(auth.uid), issues }, { status: 201 });
}
