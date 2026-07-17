import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { BILLINGS, GPT_IMAGE_2_RATIOS, MODELS, QUALITY_OPTIONS, ASPECT_RATIOS } from "./models.ts";
import type {
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunSummary,
} from "./workflowTypes";
import { toWorkflowRunSummary, WORKFLOW_SCHEMA_VERSION } from "./workflowTypes.ts";
import { workflowOwnerScope } from "./workflowAssets.server.ts";

const DATA_DIR = path.join(process.cwd(), "data");
const WORKFLOWS_DIR = path.join(DATA_DIR, "workflows");
const RUNS_DIR = path.join(DATA_DIR, "workflow-runs");
const FILE_MUTEX_STALE_MS = 5 * 60_000;
const FILE_MUTEX_WAIT_MS = 15_000;
const FILE_MUTEX_POLL_MS = 25;
const RUN_LEASE_MS = 5 * 60_000;
export const MAX_WORKFLOW_RUNS_PER_OWNER = 100;

const fileLocks = new Map<string, Promise<void>>();

interface MutexOwner {
  token: string;
  pid: number;
  createdAt: number;
}

export interface WorkflowRunLease {
  token: string;
  expiresAt: number;
}

interface StoredRunLease extends WorkflowRunLease {
  pid: number;
  renewedAt: number;
}

export class WorkflowRunLeaseLostError extends Error {
  constructor() {
    super("工作流执行 lease 已失效");
    this.name = "WorkflowRunLeaseLostError";
  }
}

function ownerSegment(ownerId: string): string {
  return workflowOwnerScope(ownerId);
}

function safeId(id: string): string {
  return path.basename(String(id)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
}

function workflowDir(ownerId: string): string {
  return path.join(WORKFLOWS_DIR, ownerSegment(ownerId));
}

function runDir(ownerId: string): string {
  return path.join(RUNS_DIR, ownerSegment(ownerId));
}

function workflowPath(ownerId: string, id: string): string {
  return path.join(workflowDir(ownerId), `${safeId(id)}.json`);
}

function runPath(ownerId: string, id: string): string {
  return path.join(runDir(ownerId), `${safeId(id)}.json`);
}

function runSummaryPath(ownerId: string, id: string): string {
  return path.join(runDir(ownerId), `${safeId(id)}.summary.json`);
}

function executionLeaseDir(ownerId: string, id: string): string {
  return path.join(runDir(ownerId), `${safeId(id)}.execution-lease`);
}

function executionLeaseFile(ownerId: string, id: string): string {
  return path.join(executionLeaseDir(ownerId, id), "lease.json");
}

function mutexDir(target: string): string {
  return `${target}.mutex`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireCrossProcessMutex(target: string): Promise<MutexOwner> {
  const directory = mutexDir(target);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  const deadline = Date.now() + FILE_MUTEX_WAIT_MS;
  while (true) {
    const owner: MutexOwner = { token: randomUUID(), pid: process.pid, createdAt: Date.now() };
    try {
      await fs.mkdir(directory);
      try {
        await fs.writeFile(path.join(directory, "owner.json"), JSON.stringify(owner), "utf-8");
        return owner;
      } catch (error) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(directory).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > FILE_MUTEX_STALE_MS) {
        const stale = `${directory}.stale-${randomUUID()}`;
        try {
          await fs.rename(directory, stale);
          await fs.rm(stale, { recursive: true, force: true });
          continue;
        } catch {
          // Another process won the stale-lock takeover.
        }
      }
      if (Date.now() >= deadline) throw new Error(`等待文件锁超时：${path.basename(target)}`);
      await sleep(FILE_MUTEX_POLL_MS);
    }
  }
}

async function releaseCrossProcessMutex(target: string, owner: MutexOwner): Promise<void> {
  const directory = mutexDir(target);
  const stored = await readJson<MutexOwner>(path.join(directory, "owner.json"));
  if (stored?.token !== owner.token) return;
  await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

async function withFileLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(target) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  fileLocks.set(target, tail);
  await previous;
  let owner: MutexOwner | null = null;
  try {
    owner = await acquireCrossProcessMutex(target);
    return await fn();
  } finally {
    if (owner) await releaseCrossProcessMutex(target, owner);
    release();
    if (fileLocks.get(target) === tail) fileLocks.delete(target);
  }
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf-8");
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    // Windows can reject replacing an existing file. The per-path lock keeps
    // this tiny fallback window private to this process.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    await fs.unlink(target).catch(() => undefined);
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function readJson<T>(target: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(target, "utf-8")) as T;
  } catch {
    return null;
  }
}

export async function acquireWorkflowRunLease(ownerId: string, id: string): Promise<WorkflowRunLease | null> {
  if (!safeId(id)) return null;
  const directory = executionLeaseDir(ownerId, id);
  const guard = `${directory}.guard`;
  return withFileLock(guard, async () => {
    const now = Date.now();
    const existing = await readJson<StoredRunLease>(executionLeaseFile(ownerId, id));
    if (existing?.token && existing.expiresAt > now) return null;
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(directory, { recursive: false });
    const lease: StoredRunLease = {
      token: randomUUID(),
      pid: process.pid,
      renewedAt: now,
      expiresAt: now + RUN_LEASE_MS,
    };
    await atomicWriteJson(executionLeaseFile(ownerId, id), lease);
    return { token: lease.token, expiresAt: lease.expiresAt };
  });
}

export async function renewWorkflowRunLease(ownerId: string, id: string, token: string): Promise<boolean> {
  const directory = executionLeaseDir(ownerId, id);
  const guard = `${directory}.guard`;
  return withFileLock(guard, async () => {
    const current = await readJson<StoredRunLease>(executionLeaseFile(ownerId, id));
    if (!current || current.token !== token || current.expiresAt <= Date.now()) return false;
    const now = Date.now();
    await atomicWriteJson(executionLeaseFile(ownerId, id), {
      ...current,
      renewedAt: now,
      expiresAt: now + RUN_LEASE_MS,
    } satisfies StoredRunLease);
    return true;
  });
}

export async function ownsWorkflowRunLease(ownerId: string, id: string, token: string): Promise<boolean> {
  const current = await readJson<StoredRunLease>(executionLeaseFile(ownerId, id));
  return !!current && current.token === token && current.expiresAt > Date.now();
}

export async function releaseWorkflowRunLease(ownerId: string, id: string, token: string): Promise<void> {
  const directory = executionLeaseDir(ownerId, id);
  const guard = `${directory}.guard`;
  await withFileLock(guard, async () => {
    const current = await readJson<StoredRunLease>(executionLeaseFile(ownerId, id));
    if (current?.token === token) await fs.rm(directory, { recursive: true, force: true });
  });
}

function normalizeBinding(raw: unknown): WorkflowBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const sourceNodeId = typeof value.sourceNodeId === "string" ? value.sourceNodeId.trim().slice(0, 100) : "";
  const sourcePort = typeof value.sourcePort === "string" ? value.sourcePort.trim().slice(0, 100) : "";
  if (!sourceNodeId || !sourcePort) return null;
  const index = Number(value.index);
  return {
    sourceNodeId,
    sourcePort,
    ...(value.index != null && Number.isInteger(index) && index >= 0 ? { index } : {}),
  };
}

function nodeIdentity(raw: Record<string, unknown>, type: WorkflowNode["type"]): Pick<WorkflowNode, "id" | "name" | "enabled"> & { type: WorkflowNode["type"] } {
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 100) : randomUUID(),
    type,
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "",
    enabled: raw.enabled !== false,
  };
}

function normalizeNode(raw: unknown): WorkflowNode | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const config = value.config && typeof value.config === "object" ? value.config as Record<string, unknown> : {};
  const type = value.type;

  if (type === "input") {
    const fields = Array.isArray(config.fields) ? config.fields.slice(0, 100).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const field = item as Record<string, unknown>;
      const fieldType = field.type === "image" ? ("image" as const) : ("text" as const);
      return [{
        id: typeof field.id === "string" && field.id.trim() ? field.id.trim().slice(0, 100) : randomUUID(),
        name: typeof field.name === "string" ? field.name.trim().slice(0, 80) : "",
        type: fieldType,
        required: field.required === true,
        ...(fieldType === "text" && typeof field.defaultValue === "string"
          ? { defaultValue: field.defaultValue.slice(0, 100_000) }
          : {}),
      }];
    }) : [];
    return { ...nodeIdentity(value, type), type, config: { fields } };
  }

  if (type === "reverse") {
    return {
      ...nodeIdentity(value, type),
      type,
      config: {
        image: normalizeBinding(config.image),
        mode: config.mode === "prompt" ? "prompt" : "structured",
        ...(typeof config.model === "string" && config.model.trim() ? { model: config.model.trim().slice(0, 100) } : {}),
      },
    };
  }

  if (type === "prompt") {
    const bindings = Array.isArray(config.bindings) ? config.bindings.slice(0, 100).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const named = item as Record<string, unknown>;
      const source = normalizeBinding(named.source);
      if (!source) return [];
      return [{ key: typeof named.key === "string" ? named.key.trim().slice(0, 100) : "", source }];
    }) : [];
    return {
      ...nodeIdentity(value, type),
      type,
      config: {
        template: typeof config.template === "string" ? config.template.slice(0, 100_000) : "",
        bindings,
      },
    };
  }

  if (type === "image") {
    const referenceImages = Array.isArray(config.referenceImages)
      ? config.referenceImages.slice(0, 20).map(normalizeBinding).filter((item): item is WorkflowBinding => !!item)
      : [];
    const count = Math.round(Number(config.count));
    const maxPollMs = Math.round(Number(config.maxPollMs));
    const modelInfo = MODELS.find((item) => item.name === config.model);
    if (!modelInfo || !modelInfo.resolutions.includes(config.resolution as never)) return null;
    if (!BILLINGS.includes(config.billing as never)) return null;
    const quality = String(config.quality ?? "auto");
    if (!QUALITY_OPTIONS.some((item) => item.value === quality)) return null;
    const aspectRatio = typeof config.aspectRatio === "string" ? config.aspectRatio.slice(0, 20) : "auto";
    const ratios = modelInfo.name === "GPT Image 2" ? GPT_IMAGE_2_RATIOS : ASPECT_RATIOS;
    if (!ratios.includes(aspectRatio)) return null;
    return {
      ...nodeIdentity(value, type),
      type,
      config: {
        prompt: normalizeBinding(config.prompt),
        baseImage: normalizeBinding(config.baseImage),
        referenceImages,
        model: modelInfo.name,
        resolution: config.resolution as (typeof modelInfo.resolutions)[number],
        aspectRatio,
        billing: config.billing as (typeof BILLINGS)[number],
        quality: quality as "auto" | "high" | "medium" | "low",
        count: Number.isFinite(count) ? count : 1,
        ...(Number.isFinite(maxPollMs) ? { maxPollMs } : {}),
      },
    };
  }

  if (type === "output") {
    const selectIndex = Math.round(Number(config.selectIndex));
    return {
      ...nodeIdentity(value, type),
      type,
      config: {
        images: normalizeBinding(config.images),
        ...(Number.isFinite(selectIndex) && selectIndex >= 0 ? { selectIndex } : {}),
        syncHistory: config.syncHistory !== false,
      },
    };
  }

  return null;
}

export function normalizeWorkflowDraft(raw: unknown): WorkflowDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.nodes) || value.nodes.length > 100) return null;
  const nodes = value.nodes.map(normalizeNode);
  if (nodes.some((node) => !node)) return null;
  return {
    name: typeof value.name === "string" ? value.name.trim().slice(0, 80) : "",
    ...(typeof value.description === "string" && value.description.trim()
      ? { description: value.description.trim().slice(0, 500) }
      : {}),
    nodes: nodes as WorkflowNode[],
  };
}

export async function listWorkflows(ownerId: string): Promise<WorkflowDefinition[]> {
  try {
    const dir = workflowDir(ownerId);
    const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
    const items = (await Promise.all(names.map((name) => readJson<WorkflowDefinition>(path.join(dir, name)))))
      .filter((item): item is WorkflowDefinition => !!item && item.schemaVersion === WORKFLOW_SCHEMA_VERSION);
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function readWorkflow(ownerId: string, id: string): Promise<WorkflowDefinition | null> {
  if (!safeId(id)) return null;
  const item = await readJson<WorkflowDefinition>(workflowPath(ownerId, id));
  return item?.schemaVersion === WORKFLOW_SCHEMA_VERSION ? item : null;
}

export async function createWorkflow(ownerId: string, draft: WorkflowDraft): Promise<WorkflowDefinition> {
  const now = Date.now();
  const item: WorkflowDefinition = {
    ...draft,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: randomUUID(),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const target = workflowPath(ownerId, item.id);
  await withFileLock(target, () => atomicWriteJson(target, item));
  return item;
}

export async function updateWorkflow(ownerId: string, id: string, draft: WorkflowDraft): Promise<WorkflowDefinition | null> {
  const target = workflowPath(ownerId, id);
  return withFileLock(target, async () => {
    const current = await readJson<WorkflowDefinition>(target);
    if (!current) return null;
    const item: WorkflowDefinition = {
      ...draft,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      id: current.id,
      version: Math.max(1, current.version + 1),
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    };
    await atomicWriteJson(target, item);
    return item;
  });
}

export type DeleteWorkflowResult = "deleted" | "not_found" | "active_run";

export async function listWorkflowRuns(ownerId: string, workflowId?: string): Promise<WorkflowRun[]> {
  try {
    const dir = runDir(ownerId);
    const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json") && !name.endsWith(".summary.json"));
    const items = (await Promise.all(names.map((name) => readJson<WorkflowRun>(path.join(dir, name)))))
      .filter((item): item is WorkflowRun => !!item && (!workflowId || item.workflowId === workflowId));
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function listWorkflowRunSummaries(ownerId: string, workflowId?: string): Promise<WorkflowRunSummary[]> {
  try {
    const dir = runDir(ownerId);
    const names = await fs.readdir(dir);
    const fullNames = names.filter((name) => name.endsWith(".json") && !name.endsWith(".summary.json"));
    const summaries = await Promise.all(fullNames.map(async (name) => {
      const id = name.slice(0, -5);
      const fullTarget = path.join(dir, name);
      const summaryTarget = runSummaryPath(ownerId, id);
      const [summary, fullStat, summaryStat] = await Promise.all([
        readJson<WorkflowRunSummary>(summaryTarget),
        fs.stat(fullTarget).catch(() => null),
        fs.stat(summaryTarget).catch(() => null),
      ]);
      if (summary?.id && fullStat && summaryStat && summaryStat.mtimeMs >= fullStat.mtimeMs) return summary;
      const run = await readJson<WorkflowRun>(fullTarget);
      if (!run) return null;
      return toWorkflowRunSummary(run);
    }));
    return summaries
      .filter((item): item is WorkflowRunSummary => !!item && (!workflowId || item.workflowId === workflowId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function readWorkflowRun(ownerId: string, id: string): Promise<WorkflowRun | null> {
  if (!safeId(id)) return null;
  return readJson<WorkflowRun>(runPath(ownerId, id));
}

async function deleteWorkflowRunFiles(ownerId: string, id: string): Promise<void> {
  await Promise.all([
    fs.unlink(runPath(ownerId, id)).catch(() => undefined),
    fs.unlink(runSummaryPath(ownerId, id)).catch(() => undefined),
    fs.rm(executionLeaseDir(ownerId, id), { recursive: true, force: true }).catch(() => undefined),
  ]);
}

async function pruneWorkflowRunsUnlocked(ownerId: string): Promise<void> {
  const summaries = await listWorkflowRunSummaries(ownerId);
  const keep = new Set<string>();
  for (const summary of summaries) {
    if (summary.status === "queued" || summary.status === "running") keep.add(summary.id);
  }
  for (const summary of summaries) {
    if (keep.has(summary.id)) continue;
    if (keep.size < MAX_WORKFLOW_RUNS_PER_OWNER) keep.add(summary.id);
    else await deleteWorkflowRunFiles(ownerId, summary.id);
  }
}

export async function deleteWorkflow(ownerId: string, id: string): Promise<DeleteWorkflowResult> {
  if (!safeId(id)) return "not_found";
  const ownerLock = path.join(runDir(ownerId), ".create-run.lock");
  return withFileLock(ownerLock, async () => {
    const target = workflowPath(ownerId, id);
    if (!(await readJson<WorkflowDefinition>(target))) return "not_found";
    const runs = await listWorkflowRunSummaries(ownerId, id);
    if (runs.some((run) => run.status === "queued" || run.status === "running")) return "active_run";
    await withFileLock(target, () => fs.unlink(target));
    for (const run of runs) await deleteWorkflowRunFiles(ownerId, run.id);
    return "deleted";
  });
}

export async function createWorkflowRun(
  ownerId: string,
  workflow: WorkflowDefinition,
  inputs: Record<string, string>,
  stopAfterNodeId?: string,
): Promise<WorkflowRun> {
  const now = Date.now();
  const run: WorkflowRun = {
    id: randomUUID(),
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowName: workflow.name,
    workflowSnapshot: structuredClone(workflow),
    inputs: structuredClone(inputs),
    status: "queued",
    steps: workflow.nodes.map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      name: node.name,
      status: node.enabled === false ? "skipped" : "pending",
      attempts: 0,
      outputs: {},
    })),
    outputs: {},
    ...(stopAfterNodeId ? { stopAfterNodeId } : {}),
    stopRequested: false,
    createdAt: now,
    updatedAt: now,
  };
  const target = runPath(ownerId, run.id);
  await withFileLock(target, async () => {
    await atomicWriteJson(target, run);
    await atomicWriteJson(runSummaryPath(ownerId, run.id), toWorkflowRunSummary(run));
  });
  return run;
}

export async function createWorkflowRunIfIdle(
  ownerId: string,
  workflow: WorkflowDefinition,
  inputs: Record<string, string>,
  stopAfterNodeId?: string,
): Promise<{ run: WorkflowRun | null; active: WorkflowRun | null }> {
  const ownerLock = path.join(runDir(ownerId), ".create-run.lock");
  return withFileLock(ownerLock, async () => {
    const active = await findActiveWorkflowRun(ownerId);
    if (active) return { run: null, active };
    const run = await createWorkflowRun(ownerId, workflow, inputs, stopAfterNodeId);
    await pruneWorkflowRunsUnlocked(ownerId);
    return { run, active: null };
  });
}

export async function writeWorkflowRun(ownerId: string, run: WorkflowRun, expectedLeaseToken?: string): Promise<WorkflowRun> {
  const target = runPath(ownerId, run.id);
  const commit = () => withFileLock(target, async () => {
      const latest = await readJson<WorkflowRun>(target);
      const next: WorkflowRun = {
        ...run,
        stopRequested: !!(run.stopRequested || latest?.stopRequested),
        updatedAt: Date.now(),
      };
      await atomicWriteJson(target, next);
      await atomicWriteJson(runSummaryPath(ownerId, next.id), toWorkflowRunSummary(next));
      return next;
    });
  if (!expectedLeaseToken) return commit();
  const leaseGuard = `${executionLeaseDir(ownerId, run.id)}.guard`;
  return withFileLock(leaseGuard, async () => {
    const current = await readJson<StoredRunLease>(executionLeaseFile(ownerId, run.id));
    if (!current || current.token !== expectedLeaseToken || current.expiresAt <= Date.now()) {
      throw new WorkflowRunLeaseLostError();
    }
    return commit();
  });
}

export async function updateWorkflowRun(
  ownerId: string,
  id: string,
  update: (run: WorkflowRun) => WorkflowRun | Promise<WorkflowRun>,
): Promise<WorkflowRun | null> {
  const target = runPath(ownerId, id);
  return withFileLock(target, async () => {
    const current = await readJson<WorkflowRun>(target);
    if (!current) return null;
    const next = await update(current);
    next.updatedAt = Date.now();
    await atomicWriteJson(target, next);
    await atomicWriteJson(runSummaryPath(ownerId, next.id), toWorkflowRunSummary(next));
    return next;
  });
}

export async function updateWorkflowRunIfIdle(
  ownerId: string,
  id: string,
  update: (run: WorkflowRun) => WorkflowRun | Promise<WorkflowRun>,
): Promise<{ run: WorkflowRun | null; active: WorkflowRun | null }> {
  const ownerLock = path.join(runDir(ownerId), ".create-run.lock");
  return withFileLock(ownerLock, async () => {
    const active = await findActiveWorkflowRun(ownerId);
    if (active) return { run: null, active };
    return { run: await updateWorkflowRun(ownerId, id, update), active: null };
  });
}

export async function findActiveWorkflowRun(ownerId: string): Promise<WorkflowRun | null> {
  const summaries = await listWorkflowRunSummaries(ownerId);
  const active = summaries.find((run) => run.status === "queued" || run.status === "running");
  return active ? readWorkflowRun(ownerId, active.id) : null;
}
