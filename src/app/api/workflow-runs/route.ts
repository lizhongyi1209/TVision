import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createWorkflowRunIfIdle, listWorkflowRunSummaries, readWorkflow } from "@/lib/workflowStore.server";
import { ensureWorkflowRun } from "@/lib/workflowRunner.server";
import { isAllowedWorkflowImageSource } from "@/lib/vision";
import {
  MAX_WORKFLOW_INPUT_BYTES,
  MAX_WORKFLOW_INPUT_FIELDS,
  MAX_WORKFLOW_IMAGE_INPUT_BYTES,
  MAX_WORKFLOW_TEXT_INPUT_BYTES,
  isValidRunUntilTarget,
  toPublicWorkflowRun,
  validateWorkflow,
} from "@/lib/workflowTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RUN_REQUEST_BYTES = MAX_WORKFLOW_INPUT_BYTES + 1_000_000;

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const workflowId = new URL(req.url).searchParams.get("workflowId") || undefined;
  const runs = await listWorkflowRunSummaries(auth.uid, workflowId);
  for (const run of runs) {
    if (run.status === "queued" || run.status === "running") ensureWorkflowRun(auth.uid, run.id);
  }
  return NextResponse.json({ items: runs.slice(0, 100) });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const text = await req.text();
  if (Buffer.byteLength(text, "utf-8") > MAX_RUN_REQUEST_BYTES) {
    return NextResponse.json({ error: "运行输入过大" }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "运行参数不是有效 JSON" }, { status: 400 });
  }
  const workflowId = typeof body.workflowId === "string" ? body.workflowId : "";
  if (!workflowId) return NextResponse.json({ error: "缺少流程 id" }, { status: 400 });
  const workflow = await readWorkflow(auth.uid, workflowId);
  if (!workflow) return NextResponse.json({ error: "流程不存在" }, { status: 404 });
  const issues = validateWorkflow(workflow);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length) return NextResponse.json({ error: errors[0].message, issues }, { status: 400 });

  const declared = new Map<string, { type: "text" | "image"; scopedKey: string; plainKey: string }>();
  for (const node of workflow.nodes) {
    if (node.type !== "input" || node.enabled === false) continue;
    for (const field of node.config.fields) {
      const details = { type: field.type, scopedKey: `${node.id}.${field.id}`, plainKey: field.id };
      declared.set(field.id, details);
      declared.set(`${node.id}.${field.id}`, details);
    }
  }
  const rawInputs = body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)
    ? body.inputs as Record<string, unknown>
    : {};
  if (Object.keys(rawInputs).length > MAX_WORKFLOW_INPUT_FIELDS) {
    return NextResponse.json({ error: "运行输入字段过多" }, { status: 400 });
  }
  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawInputs)) {
    const field = declared.get(key);
    if (!field) return NextResponse.json({ error: `未知的运行输入：${key}` }, { status: 400 });
    if (typeof value !== "string") return NextResponse.json({ error: `运行输入 ${key} 必须是文本或图片地址` }, { status: 400 });
    const valueBytes = Buffer.byteLength(value, "utf-8");
    if (field.type === "text" && valueBytes > MAX_WORKFLOW_TEXT_INPUT_BYTES) {
      return NextResponse.json({ error: `文本输入 ${key} 超过 100KB 上限` }, { status: 413 });
    }
    if (field.type === "image") {
      if (valueBytes > MAX_WORKFLOW_IMAGE_INPUT_BYTES) {
        return NextResponse.json({ error: `图片输入 ${key} 超过 20MB 上限` }, { status: 413 });
      }
      if (value && !isAllowedWorkflowImageSource(value)) {
        return NextResponse.json(
          { error: `图片输入 ${key} 仅支持本次上传的图片，不接受远程 URL 或历史文件地址` },
          { status: 400 },
        );
      }
    }
    inputs[key] = value;
  }
  for (const field of new Set(declared.values())) {
    if (field.scopedKey !== field.plainKey && inputs[field.scopedKey] != null && inputs[field.plainKey] != null) {
      return NextResponse.json({ error: `输入 ${field.plainKey} 重复提交` }, { status: 400 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(inputs), "utf-8") > MAX_WORKFLOW_INPUT_BYTES) {
    return NextResponse.json({ error: `运行输入超过 ${(MAX_WORKFLOW_INPUT_BYTES / 1e6).toFixed(0)}MB 上限` }, { status: 413 });
  }

  const stopAfterNodeId = typeof body.stopAfterNodeId === "string"
    ? body.stopAfterNodeId
    : typeof body.runUntilNodeId === "string"
      ? body.runUntilNodeId
      : undefined;
  if (!isValidRunUntilTarget(workflow, stopAfterNodeId)) {
    return NextResponse.json({ error: "运行到此步骤不存在或已停用" }, { status: 400 });
  }
  const created = await createWorkflowRunIfIdle(auth.uid, workflow, inputs, stopAfterNodeId);
  if (created.active) {
    ensureWorkflowRun(auth.uid, created.active.id);
    return NextResponse.json({ error: "当前已有流程在运行", run: toPublicWorkflowRun(created.active) }, { status: 409 });
  }
  const run = created.run!;
  ensureWorkflowRun(auth.uid, run.id);
  return NextResponse.json({ run: toPublicWorkflowRun(run) }, { status: 202 });
}
