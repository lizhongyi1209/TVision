import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ensureWorkflowRun } from "../workflowRunner.server.ts";
import {
  WorkflowRunLeaseLostError,
  acquireWorkflowRunLease,
  createWorkflow,
  createWorkflowRun,
  createWorkflowRunIfIdle,
  deleteWorkflow,
  listWorkflowRunSummaries,
  MAX_WORKFLOW_RUNS_PER_OWNER,
  normalizeWorkflowDraft,
  readWorkflow,
  readWorkflowRun,
  releaseWorkflowRunLease,
  updateWorkflowRun,
  writeWorkflowRun,
} from "../workflowStore.server.ts";
import { createDefaultWorkflow, validateWorkflow, type WorkflowImageNode, type WorkflowReverseNode } from "../workflowTypes.ts";

test("normalizeWorkflowDraft accepts a valid client draft and trims its metadata", () => {
  const raw = createDefaultWorkflow();
  raw.name = `  ${"a".repeat(90)}  `;
  raw.description = `  ${"b".repeat(600)}  `;

  const normalized = normalizeWorkflowDraft(raw);

  assert.ok(normalized);
  assert.equal(normalized.name, "a".repeat(80));
  assert.equal(normalized.description, "b".repeat(500));
  assert.ok(normalized.nodes.every((node) => node.enabled === true));
  assert.deepEqual(validateWorkflow(normalized), []);
});

test("normalizeWorkflowDraft rejects unknown or unsupported generation parameters", () => {
  const mutations: Array<[string, (node: WorkflowImageNode) => void]> = [
    ["model", (node) => { node.config.model = "unknown-model" as WorkflowImageNode["config"]["model"]; }],
    ["resolution", (node) => { node.config.resolution = "8K" as WorkflowImageNode["config"]["resolution"]; }],
    ["billing", (node) => { node.config.billing = "free" as WorkflowImageNode["config"]["billing"]; }],
    ["quality", (node) => { node.config.quality = "ultra" as NonNullable<WorkflowImageNode["config"]["quality"]>; }],
    ["aspect ratio", (node) => { node.config.aspectRatio = "99:1"; }],
  ];

  for (const [label, mutate] of mutations) {
    const raw = createDefaultWorkflow();
    const imageNode = raw.nodes.find((node): node is WorkflowImageNode => node.type === "image");
    assert.ok(imageNode);
    mutate(imageNode);
    assert.equal(normalizeWorkflowDraft(raw), null, `${label} must be rejected at the server boundary`);
  }
});

test("normalizeWorkflowDraft rejects unknown nodes and grossly oversized node arrays", () => {
  assert.equal(normalizeWorkflowDraft({ name: "bad", nodes: [{ id: "x", type: "script", config: {} }] }), null);
  assert.equal(
    normalizeWorkflowDraft({
      name: "too large",
      nodes: Array.from({ length: 101 }, (_, index) => ({
        id: `input-${index}`,
        type: "input",
        name: "input",
        config: { fields: [] },
      })),
    }),
    null,
  );
});

test("normalizeWorkflowDraft removes malformed bindings so validation blocks execution", () => {
  const raw = createDefaultWorkflow() as unknown as {
    name: string;
    nodes: Array<Record<string, unknown> & { type: string; config: Record<string, unknown> }>;
  };
  const reverseNode = raw.nodes.find((node) => node.type === "reverse");
  assert.ok(reverseNode);
  reverseNode.config.image = { sourceNodeId: "", sourcePort: "sourceImage" };

  const normalized = normalizeWorkflowDraft(raw);

  assert.ok(normalized);
  const normalizedReverse = normalized.nodes.find((node): node is WorkflowReverseNode => node.type === "reverse");
  assert.ok(normalizedReverse);
  assert.equal(normalizedReverse.config.image, null);
  assert.ok(validateWorkflow(normalized).some((issue) => issue.code === "binding.required"));
});

function childLeaseProbe(ownerId: string, runId: string): Promise<string> {
  const moduleUrl = new URL("../workflowStore.server.ts", import.meta.url).href;
  const script = `
    import { acquireWorkflowRunLease, releaseWorkflowRunLease } from ${JSON.stringify(moduleUrl)};
    const lease = await acquireWorkflowRunLease(${JSON.stringify(ownerId)}, ${JSON.stringify(runId)});
    console.log(lease ? "acquired" : "blocked");
    if (lease) await releaseWorkflowRunLease(${JSON.stringify(ownerId)}, ${JSON.stringify(runId)}, lease.token);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `child exited ${code}`)));
  });
}

test("workflow execution lease is exclusive across Node processes", async () => {
  const ownerId = `lease-owner-${randomUUID()}`;
  const runId = randomUUID();
  const lease = await acquireWorkflowRunLease(ownerId, runId);
  assert.ok(lease);
  assert.equal(await childLeaseProbe(ownerId, runId), "blocked");
  await releaseWorkflowRunLease(ownerId, runId, lease.token);
  assert.equal(await childLeaseProbe(ownerId, runId), "acquired");
});

test("run writes enforce lease CAS and deleting a workflow removes terminal runs", async () => {
  const ownerId = `store-owner-${randomUUID()}`;
  const draft = createDefaultWorkflow("cascade-test");
  const workflow = await createWorkflow(ownerId, draft);
  const run = await createWorkflowRun(ownerId, workflow, {});
  const lease = await acquireWorkflowRunLease(ownerId, run.id);
  assert.ok(lease);
  run.status = "running";
  await writeWorkflowRun(ownerId, run, lease.token);
  await releaseWorkflowRunLease(ownerId, run.id, lease.token);
  run.status = "failed";
  await assert.rejects(() => writeWorkflowRun(ownerId, run, lease.token), WorkflowRunLeaseLostError);
  await updateWorkflowRun(ownerId, run.id, (current) => ({ ...current, status: "failed", finishedAt: Date.now() }));

  assert.equal(await deleteWorkflow(ownerId, workflow.id), "deleted");
  assert.equal(await readWorkflow(ownerId, workflow.id), null);
  assert.equal(await readWorkflowRun(ownerId, run.id), null);
});

test("run retention keeps the newest 100 records without deleting the active run", async () => {
  const ownerId = `retention-owner-${randomUUID()}`;
  const workflow = await createWorkflow(ownerId, createDefaultWorkflow("retention-test"));
  let lastRunId = "";
  for (let index = 0; index <= MAX_WORKFLOW_RUNS_PER_OWNER; index++) {
    const created = await createWorkflowRunIfIdle(ownerId, workflow, { customText: String(index) });
    assert.ok(created.run);
    lastRunId = created.run.id;
    await updateWorkflowRun(ownerId, created.run.id, (run) => ({
      ...run,
      status: "success",
      finishedAt: Date.now(),
    }));
  }
  const summaries = await listWorkflowRunSummaries(ownerId);
  assert.equal(summaries.length, MAX_WORKFLOW_RUNS_PER_OWNER);
  assert.ok(summaries.some((run) => run.id === lastRunId));
  assert.equal(await deleteWorkflow(ownerId, workflow.id), "deleted");
});

async function waitForTerminalRun(ownerId: string, runId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = await readWorkflowRun(ownerId, runId);
    if (run && run.status !== "queued" && run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("workflow run did not reach a terminal state");
}

test("run-until stops immediately after a fresh or already-successful target", async () => {
  const ownerId = `run-until-owner-${randomUUID()}`;
  const workflow = await createWorkflow(ownerId, createDefaultWorkflow("run-until-test"));
  const target = workflow.nodes[0];
  const input = { sourceImage: "data:image/png;base64,iVBORw0KGgo=" };

  const fresh = await createWorkflowRun(ownerId, workflow, input, target.id);
  ensureWorkflowRun(ownerId, fresh.id);
  const freshResult = await waitForTerminalRun(ownerId, fresh.id);
  assert.equal(freshResult.status, "stopped");
  assert.equal(freshResult.steps[0].status, "success");
  assert.equal(freshResult.steps[1].status, "blocked");

  const resumed = await createWorkflowRun(ownerId, workflow, input, target.id);
  resumed.steps[0].status = "success";
  resumed.steps[0].finishedAt = Date.now();
  await writeWorkflowRun(ownerId, resumed);
  ensureWorkflowRun(ownerId, resumed.id);
  const resumedResult = await waitForTerminalRun(ownerId, resumed.id);
  assert.equal(resumedResult.status, "stopped");
  assert.equal(resumedResult.steps[1].status, "blocked");

  assert.equal(await deleteWorkflow(ownerId, workflow.id), "deleted");
});
