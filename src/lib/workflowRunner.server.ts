import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { appendMeta } from "./historyMeta.ts";
import {
  buildGptImageSubmitBody,
  buildModelId,
  buildSubmitBody,
  fetchResultBytes,
  isGptImage2,
  MAX_BODY_BYTES,
  pollTaskOnce,
  resolveBaseUrl,
  submitTask,
  type ResultImage,
} from "./o1key.ts";
import { embedImageText, PNG_META_KEYWORD } from "./pngMeta.ts";
import { readSettings } from "./settings.ts";
import { buildEmbeddedMeta } from "./templates.ts";
import { encodeWorkflowTaskId, workflowAssetStem } from "./workflowAssets.server.ts";
import { normalizeVisionPrompt, resolveImageToDataUrl, reverseEngineerPrompt, VisionError } from "./vision.ts";
import {
  prepareWorkflowRunForRetry,
  renderPromptTemplate,
  resolveWorkflowBinding,
  shouldStopAfterWorkflowStep,
  validateWorkflow,
  type WorkflowBinding,
  type WorkflowImageNode,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowStepRun,
  type WorkflowUpstreamJob,
  type WorkflowValue,
} from "./workflowTypes.ts";
import {
  acquireWorkflowRunLease,
  readWorkflowRun,
  releaseWorkflowRunLease,
  renewWorkflowRunLease,
  updateWorkflowRun,
  updateWorkflowRunIfIdle,
  writeWorkflowRun,
  WorkflowRunLeaseLostError,
} from "./workflowStore.server.ts";

const OUTPUT_DIR = path.join(process.cwd(), "output");
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLL_MS = 12 * 60_000;
const MIN_MAX_POLL_MS = 60_000;
const MAX_MAX_POLL_MS = 30 * 60_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 8;
const RUN_LEASE_HEARTBEAT_MS = 30_000;

const activeRuns = new Map<string, Promise<void>>();
const stopSignals = new Set<string>();

interface MutableRunContext {
  ownerId: string;
  run: WorkflowRun;
  stepIndex: number;
  leaseToken: string;
  isLeaseLost: () => boolean;
}

class WorkflowStepError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "WorkflowStepError";
    this.detail = detail;
  }
}

function runKey(ownerId: string, runId: string): string {
  return `${ownerId}:${runId}`;
}

function currentStep(ctx: MutableRunContext): WorkflowStepRun {
  return ctx.run.steps[ctx.stepIndex];
}

async function persist(ctx: MutableRunContext): Promise<void> {
  if (ctx.isLeaseLost()) throw new WorkflowRunLeaseLostError();
  ctx.run = await writeWorkflowRun(ctx.ownerId, ctx.run, ctx.leaseToken);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireValue(run: WorkflowRun, binding: WorkflowBinding | null | undefined, type: WorkflowValue["type"], label: string): WorkflowValue {
  if (!binding) throw new WorkflowStepError(`${label}未绑定`);
  const value = resolveWorkflowBinding(run, binding);
  if (!value) throw new WorkflowStepError(`${label}没有可用值`);
  if (value.type !== type) throw new WorkflowStepError(`${label}类型不匹配：需要 ${type}，实际为 ${value.type}`);
  return value;
}

function optionalImage(run: WorkflowRun, binding: WorkflowBinding | null | undefined): string | undefined {
  if (!binding) return undefined;
  const value = resolveWorkflowBinding(run, binding);
  if (!value) return undefined;
  if (value.type !== "image") throw new WorkflowStepError("图片输入类型不匹配");
  return value.value || undefined;
}

function readRunInput(run: WorkflowRun, nodeId: string, fieldId: string, fallback?: string): string {
  const scoped = run.inputs[`${nodeId}.${fieldId}`];
  if (scoped != null) return scoped;
  const plain = run.inputs[fieldId];
  if (plain != null) return plain;
  return fallback ?? "";
}

async function executeInputNode(ctx: MutableRunContext, node: Extract<WorkflowNode, { type: "input" }>): Promise<Record<string, WorkflowValue>> {
  const outputs: Record<string, WorkflowValue> = {};
  for (const field of node.config.fields) {
    const value = readRunInput(ctx.run, node.id, field.id, field.defaultValue);
    if (field.required && !value.trim()) throw new WorkflowStepError(`必填输入“${field.name}”不能为空`);
    if (field.type === "text") outputs[field.id] = { type: "text", value };
    // Image inputs stay only in run.inputs. resolveWorkflowBinding reads them
    // from there, avoiding a second multi-megabyte data URL in step.outputs.
  }
  return outputs;
}

async function executeReverseNode(ctx: MutableRunContext, node: Extract<WorkflowNode, { type: "reverse" }>): Promise<Record<string, WorkflowValue>> {
  const source = requireValue(ctx.run, node.config.image, "image", "反推图片");
  const step = currentStep(ctx);
  step.inputs = undefined;
  await persist(ctx);

  const settings = await readSettings();
  if (!settings.apiKey) throw new WorkflowStepError("未设置 API 令牌，请先在设置中填入 o1key 令牌");
  const dataUrl = await resolveImageToDataUrl(source.value as string);
  const bytes = Buffer.byteLength(dataUrl, "utf-8");
  if (bytes > MAX_BODY_BYTES) {
    throw new WorkflowStepError(`反推图片 ${(bytes / 1e6).toFixed(1)}MB 超过 20MB 上限`);
  }
  try {
    const result = await reverseEngineerPrompt(resolveBaseUrl(settings.route), settings.apiKey, dataUrl);
    const normalized = normalizeVisionPrompt(result.content);
    return {
      prompt: { type: "text", value: normalized.text },
      raw: { type: "text", value: result.content },
      model: { type: "text", value: result.model },
    };
  } catch (error) {
    const vision = error as VisionError;
    throw new WorkflowStepError(vision.message || "视觉解析失败", vision.detail);
  }
}

async function executePromptNode(ctx: MutableRunContext, node: Extract<WorkflowNode, { type: "prompt" }>): Promise<Record<string, WorkflowValue>> {
  const variables: Record<string, string> = {};
  const inputs: Record<string, WorkflowValue> = {};
  for (const named of node.config.bindings) {
    const value = requireValue(ctx.run, named.source, "text", `变量 ${named.key}`);
    variables[named.key] = value.value as string;
    inputs[named.key] = value;
  }
  currentStep(ctx).inputs = inputs;
  const text = renderPromptTemplate(node.config.template, variables);
  if (!text) throw new WorkflowStepError("组合后的提示词为空");
  return { text: { type: "text", value: text } };
}

async function findExisting(nameNoExt: string): Promise<string | null> {
  for (const ext of [".png", ".jpg", ".webp"]) {
    try {
      await fs.access(path.join(OUTPUT_DIR, nameNoExt + ext));
      return nameNoExt + ext;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

async function saveResultImages(
  images: ResultImage[],
  ownerId: string,
  taskId: string,
  apiKey: string,
  embedded: ReturnType<typeof buildEmbeddedMeta>,
): Promise<string[]> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const scopedTaskId = workflowAssetStem(ownerId, taskId);
  const saved: string[] = [];
  for (let index = 0; index < images.length; index++) {
    const nameNoExt = `${scopedTaskId}${images.length > 1 ? `--img${index}` : ""}`;
    const existing = await findExisting(nameNoExt);
    if (existing) {
      saved.push(`/api/media/${existing}`);
      continue;
    }
    try {
      const fetched = await fetchResultBytes(images[index], apiKey);
      let bytes = fetched.bytes;
      try {
        bytes = Buffer.from(embedImageText(bytes, PNG_META_KEYWORD, JSON.stringify(embedded)));
      } catch {
        // Metadata is best-effort; preserving the generated image wins.
      }
      const filename = `${nameNoExt}${fetched.ext}`;
      await fs.writeFile(path.join(OUTPUT_DIR, filename), bytes);
      saved.push(`/api/media/${filename}`);
    } catch {
      if (images[index].kind === "url") saved.push(images[index].value);
    }
  }
  return saved;
}

function imageNodeMeta(ctx: MutableRunContext, node: WorkflowImageNode, prompt: string, refCount: number) {
  return {
    prompt,
    model: node.config.model,
    resolution: node.config.resolution,
    aspectRatio: node.config.aspectRatio,
    billing: node.config.billing,
    count: node.config.count,
    refCount,
    quality: isGptImage2(node.config.model) ? (node.config.quality ?? "auto") : undefined,
    note: `${ctx.run.workflowName} · ${node.name}`.slice(0, 120),
    workflowId: ctx.run.workflowId,
    workflowRunId: ctx.run.id,
    workflowNodeId: node.id,
  };
}

function calculateJobProgress(jobs: WorkflowUpstreamJob[], desired: number): number {
  if (!desired) return 0;
  const total = jobs.reduce((sum, job) => {
    if (job.status === "success" || job.status === "failed") return sum + 1;
    return sum + Math.max(0, Math.min(1, job.progress ?? 0));
  }, 0);
  return Math.max(0, Math.min(1, total / desired));
}

async function pollImageJobs(
  ctx: MutableRunContext,
  node: WorkflowImageNode,
  apiKey: string,
  baseUrl: string,
  prompt: string,
  refCount: number,
): Promise<void> {
  const maxPollMs = Math.max(MIN_MAX_POLL_MS, Math.min(MAX_MAX_POLL_MS, node.config.maxPollMs || DEFAULT_MAX_POLL_MS));
  const deadline = Date.now() + maxPollMs;
  const consecutiveErrors = new Map<string, number>();

  while (true) {
    const step = currentStep(ctx);
    const active = (step.upstreamJobs || []).filter((job) => job.status === "submitted" || job.status === "running");
    if (!active.length) return;
    if (Date.now() >= deadline) {
      for (const job of active) {
        job.status = "failed";
        job.error = `轮询超过 ${Math.round(maxPollMs / 60_000)} 分钟`;
      }
      step.progress = calculateJobProgress(step.upstreamJobs || [], node.config.count);
      await persist(ctx);
      return;
    }

    const results = await Promise.allSettled(active.map((job) => pollTaskOnce(baseUrl, apiKey, job.taskId)));
    for (let index = 0; index < active.length; index++) {
      const job = active[index];
      const result = results[index];
      if (result.status === "rejected") {
        const errors = (consecutiveErrors.get(job.taskId) || 0) + 1;
        consecutiveErrors.set(job.taskId, errors);
        job.error = (result.reason as Error)?.message || "状态查询失败";
        if (errors >= MAX_CONSECUTIVE_POLL_ERRORS) job.status = "failed";
        continue;
      }

      consecutiveErrors.delete(job.taskId);
      const poll = result.value;
      job.progress = poll.progress;
      if (poll.status === "failed") {
        job.status = "failed";
        job.error = poll.error || "生成失败";
      } else if (poll.status === "running") {
        job.status = "running";
        job.error = undefined;
      } else {
        const meta = imageNodeMeta(ctx, node, prompt, refCount);
        const embedded = buildEmbeddedMeta({
          prompt: meta.prompt,
          model: meta.model,
          resolution: meta.resolution,
          aspectRatio: meta.aspectRatio,
          billing: meta.billing,
          quality: meta.quality,
          createdAt: Date.now(),
        });
        const saved = await saveResultImages(poll.images, ctx.ownerId, job.taskId, apiKey, embedded);
        if (!saved.length) {
          job.status = "failed";
          job.error = "生成成功但结果图片保存失败";
        } else {
          job.status = "success";
          job.progress = 1;
          job.images = saved;
          job.error = undefined;
        }
      }
    }

    const freshStep = currentStep(ctx);
    freshStep.outputs.images = {
      type: "images",
      value: (freshStep.upstreamJobs || []).filter((job) => job.status === "success").flatMap((job) => job.images),
    };
    freshStep.progress = calculateJobProgress(freshStep.upstreamJobs || [], node.config.count);
    await persist(ctx);
    if ((currentStep(ctx).upstreamJobs || []).some((job) => job.status === "submitted" || job.status === "running")) {
      await delay(POLL_INTERVAL_MS);
    }
  }
}

async function executeImageNode(ctx: MutableRunContext, node: WorkflowImageNode): Promise<Record<string, WorkflowValue>> {
  const promptValue = requireValue(ctx.run, node.config.prompt, "text", "生成提示词");
  const baseImage = optionalImage(ctx.run, node.config.baseImage);
  const referenceImages = (node.config.referenceImages || [])
    .map((binding) => optionalImage(ctx.run, binding))
    .filter((image): image is string => !!image);
  const rawImages = [...(baseImage ? [baseImage] : []), ...referenceImages];
  const step = currentStep(ctx);
  step.inputs = { prompt: promptValue };
  step.upstreamJobs ||= [];
  step.submissionErrors ||= [];
  await persist(ctx);

  const settings = await readSettings();
  if (!settings.apiKey) throw new WorkflowStepError("未设置 API 令牌，请先在设置中填入 o1key 令牌");
  const baseUrl = resolveBaseUrl(settings.route);
  const prompt = promptValue.value as string;
  const images = await Promise.all(rawImages.map((image) => resolveImageToDataUrl(image)));
  const modelId = buildModelId(node.config.model, node.config.resolution, node.config.billing);
  const submitBody = isGptImage2(node.config.model)
    ? buildGptImageSubmitBody({
        modelId,
        prompt,
        resolution: node.config.resolution,
        aspectRatio: node.config.aspectRatio,
        images,
        quality: node.config.quality ?? "auto",
      })
    : buildSubmitBody({
        modelId,
        prompt,
        resolution: node.config.resolution,
        aspectRatio: node.config.aspectRatio,
        images,
      });
  const bytes = Buffer.byteLength(JSON.stringify(submitBody), "utf-8");
  if (bytes > MAX_BODY_BYTES) {
    throw new WorkflowStepError(`生成请求体 ${(bytes / 1e6).toFixed(1)}MB 超过 20MB 上限，请使用更小的图片`);
  }

  const accounted = (currentStep(ctx).upstreamJobs?.length || 0) + (currentStep(ctx).submissionErrors?.length || 0);
  const missing = Math.max(0, node.config.count - accounted);
  for (let index = 0; index < missing; index++) {
    // The running attempt is already durable before each chargeable submit.
    await persist(ctx);
    const renewed = await renewWorkflowRunLease(ctx.ownerId, ctx.run.id, ctx.leaseToken).catch(() => false);
    if (!renewed) {
      throw new WorkflowRunLeaseLostError();
    }
    try {
      const attemptId = currentStep(ctx).attemptId || "legacy";
      const slot = accounted + index;
      const idempotencyKey = `wf-${ctx.run.id}-${node.id}-${attemptId}-${slot}`
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .slice(0, 220);
      const taskId = await submitTask(baseUrl, settings.apiKey, submitBody, { idempotencyKey });
      currentStep(ctx).upstreamJobs ||= [];
      currentStep(ctx).upstreamJobs!.push({ taskId, status: "submitted", progress: 0, images: [] });
      await persist(ctx);
      const encodedTaskId = encodeWorkflowTaskId(taskId);
      await appendMeta(
        encodedTaskId === taskId ? [taskId] : [taskId, encodedTaskId],
        imageNodeMeta(ctx, node, prompt, referenceImages.length),
      );
    } catch (error) {
      currentStep(ctx).submissionErrors ||= [];
      currentStep(ctx).submissionErrors!.push((error as Error)?.message || "提交失败");
      await persist(ctx);
    }
  }

  await pollImageJobs(ctx, node, settings.apiKey, baseUrl, prompt, referenceImages.length);
  const finalStep = currentStep(ctx);
  const imagesOut = (finalStep.upstreamJobs || []).filter((job) => job.status === "success").flatMap((job) => job.images);
  finalStep.outputs.images = { type: "images", value: imagesOut };
  const failures = [
    ...(finalStep.submissionErrors || []),
    ...(finalStep.upstreamJobs || []).filter((job) => job.status === "failed").map((job) => `${job.taskId}: ${job.error || "生成失败"}`),
  ];
  if (failures.length || (finalStep.upstreamJobs || []).filter((job) => job.status === "success").length < node.config.count) {
    throw new WorkflowStepError(
      imagesOut.length ? `部分生成失败，已保留 ${imagesOut.length} 张成功图片` : "图片生成失败",
      failures.join("\n") || "未获得足够的成功任务",
    );
  }
  return { images: { type: "images", value: imagesOut } };
}

async function executeOutputNode(ctx: MutableRunContext, node: Extract<WorkflowNode, { type: "output" }>): Promise<Record<string, WorkflowValue>> {
  if (!node.config.images) throw new WorkflowStepError("任务输出未绑定");
  let value = resolveWorkflowBinding(ctx.run, node.config.images);
  if (!value) throw new WorkflowStepError("任务输出没有可用图片");
  if (value.type === "images" && node.config.selectIndex != null) {
    const selected = value.value[node.config.selectIndex];
    if (!selected) throw new WorkflowStepError(`任务输出中不存在第 ${node.config.selectIndex + 1} 张图片`);
    value = { type: "image", value: selected };
  }
  const result: WorkflowValue = value.type === "image" ? { type: "images", value: [value.value] } : value;
  if (result.type !== "images") throw new WorkflowStepError("任务输出必须是图片或图片列表");
  currentStep(ctx).inputs = { images: result };
  return { result };
}

async function executeNode(ctx: MutableRunContext, node: WorkflowNode): Promise<Record<string, WorkflowValue>> {
  if (node.type === "input") return executeInputNode(ctx, node);
  if (node.type === "reverse") return executeReverseNode(ctx, node);
  if (node.type === "prompt") return executePromptNode(ctx, node);
  if (node.type === "image") return executeImageNode(ctx, node);
  return executeOutputNode(ctx, node);
}

function blockRemaining(run: WorkflowRun, afterIndex: number, reason: string): void {
  for (let index = afterIndex + 1; index < run.steps.length; index++) {
    const step = run.steps[index];
    if (step.status === "pending" || step.status === "running") {
      step.status = "blocked";
      step.error = reason;
      step.finishedAt = Date.now();
    }
  }
}

async function stopAfterTarget(ctx: MutableRunContext, index: number): Promise<void> {
  ctx.run.status = "stopped";
  ctx.run.currentNodeId = undefined;
  ctx.run.finishedAt = Date.now();
  blockRemaining(ctx.run, index, "已运行到指定步骤");
  await persist(ctx);
}

async function executeWorkflowRun(
  ownerId: string,
  runId: string,
  leaseToken: string,
  isLeaseLost: () => boolean,
): Promise<void> {
  if (isLeaseLost()) throw new WorkflowRunLeaseLostError();
  let run = await readWorkflowRun(ownerId, runId);
  if (!run || (run.status !== "queued" && run.status !== "running")) return;
  const key = runKey(ownerId, runId);
  const validationErrors = validateWorkflow(run.workflowSnapshot).filter((issue) => issue.severity === "error");
  if (validationErrors.length) {
    run.status = "failed";
    run.error = validationErrors.map((issue) => issue.message).join("；");
    run.finishedAt = Date.now();
    blockRemaining(run, -1, "流程检查未通过");
    await writeWorkflowRun(ownerId, run, leaseToken);
    return;
  }
  if (run.stopRequested || stopSignals.has(key)) {
    run.status = "stopped";
    run.finishedAt = Date.now();
    blockRemaining(run, -1, "已停止后续步骤");
    await writeWorkflowRun(ownerId, run, leaseToken);
    return;
  }

  run.status = "running";
  run.startedAt ||= Date.now();
  run.finishedAt = undefined;
  run.error = undefined;
  run = await writeWorkflowRun(ownerId, run, leaseToken);
  const ctx: MutableRunContext = { ownerId, run, stepIndex: 0, leaseToken, isLeaseLost };

  for (let index = 0; index < ctx.run.workflowSnapshot.nodes.length; index++) {
    ctx.stepIndex = index;
    const node = ctx.run.workflowSnapshot.nodes[index];
    let step = currentStep(ctx);
    if (node.enabled === false || step.status === "skipped") {
      if (shouldStopAfterWorkflowStep(ctx.run, node.id, "skipped")) {
        await stopAfterTarget(ctx, index);
        return;
      }
      continue;
    }
    if (step.status === "success") {
      if (shouldStopAfterWorkflowStep(ctx.run, node.id, step.status)) {
        await stopAfterTarget(ctx, index);
        return;
      }
      continue;
    }
    if (ctx.run.stopRequested || stopSignals.has(key)) {
      ctx.run.status = "stopped";
      ctx.run.currentNodeId = undefined;
      ctx.run.finishedAt = Date.now();
      blockRemaining(ctx.run, index - 1, "已停止后续步骤");
      await persist(ctx);
      return;
    }

    const resuming = step.status === "running";
    step.status = "running";
    if (!resuming) {
      step.attempts += 1;
      step.attemptId = randomUUID();
      step.startedAt = Date.now();
      step.finishedAt = undefined;
      step.progress = 0;
      step.error = undefined;
      step.errorDetail = undefined;
    } else if (!step.attemptId) {
      step.attempts = Math.max(1, step.attempts);
      step.attemptId = randomUUID();
    }
    ctx.run.currentNodeId = node.id;
    await persist(ctx);

    try {
      const outputs = await executeNode(ctx, node);
      step = currentStep(ctx);
      step.outputs = outputs;
      step.status = "success";
      step.progress = 1;
      step.finishedAt = Date.now();
      step.error = undefined;
      step.errorDetail = undefined;
      if (node.type === "output" && outputs.result) ctx.run.outputs[node.id] = outputs.result;
      await persist(ctx);
    } catch (error) {
      step = currentStep(ctx);
      const failure = error as WorkflowStepError;
      step.status = "failed";
      step.finishedAt = Date.now();
      step.error = failure?.message || "步骤执行失败";
      step.errorDetail = failure?.detail || (error as Error)?.stack;
      ctx.run.status = "failed";
      ctx.run.error = `${node.name}：${step.error}`;
      ctx.run.currentNodeId = node.id;
      ctx.run.finishedAt = Date.now();
      blockRemaining(ctx.run, index, "上游步骤失败");
      await persist(ctx);
      return;
    }

    if (shouldStopAfterWorkflowStep(ctx.run, node.id, currentStep(ctx).status)) {
      await stopAfterTarget(ctx, index);
      return;
    }
    if (ctx.run.stopRequested || stopSignals.has(key)) {
      ctx.run.status = "stopped";
      ctx.run.currentNodeId = undefined;
      ctx.run.finishedAt = Date.now();
      blockRemaining(ctx.run, index, "已停止后续步骤");
      await persist(ctx);
      return;
    }
  }

  ctx.run.status = "success";
  ctx.run.currentNodeId = undefined;
  ctx.run.finishedAt = Date.now();
  ctx.run.error = undefined;
  await persist(ctx);
}

async function failUnexpected(ownerId: string, runId: string, leaseToken: string, error: unknown): Promise<void> {
  const run = await readWorkflowRun(ownerId, runId);
  if (!run || run.status === "success" || run.status === "stopped") return;
  run.status = "failed";
  run.error = (error as Error)?.message || "工作流执行器异常退出";
  run.finishedAt = Date.now();
  const currentIndex = run.currentNodeId
    ? run.steps.findIndex((item) => item.nodeId === run.currentNodeId)
    : -1;
  if (currentIndex >= 0) {
    const step = run.steps[currentIndex];
    if (step.status === "running") {
      step.status = "failed";
      step.error = run.error;
      step.errorDetail = (error as Error)?.stack;
      step.finishedAt = Date.now();
    }
    blockRemaining(run, currentIndex, "执行器异常退出");
  }
  await writeWorkflowRun(ownerId, run, leaseToken);
}

/** Start or resume a persisted run without awaiting its long-running work. */
export function ensureWorkflowRun(ownerId: string, runId: string): boolean {
  const key = runKey(ownerId, runId);
  if (activeRuns.has(key)) return false;
  const task = (async () => {
    const lease = await acquireWorkflowRunLease(ownerId, runId);
    if (!lease) return;
    let renewing = false;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void renewWorkflowRunLease(ownerId, runId, lease.token)
        .then((renewed) => {
          if (!renewed) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        })
        .finally(() => {
          renewing = false;
        });
    }, RUN_LEASE_HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      try {
        await executeWorkflowRun(ownerId, runId, lease.token, () => leaseLost);
      } catch (error) {
        if (error instanceof WorkflowRunLeaseLostError) return;
        await failUnexpected(ownerId, runId, lease.token, error);
      }
    } finally {
      clearInterval(heartbeat);
      await releaseWorkflowRunLease(ownerId, runId, lease.token);
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      activeRuns.delete(key);
      stopSignals.delete(key);
    });
  activeRuns.set(key, task);
  return true;
}

export async function requestWorkflowRunStop(ownerId: string, runId: string): Promise<WorkflowRun | null> {
  const key = runKey(ownerId, runId);
  stopSignals.add(key);
  let requested = false;
  const updated = await updateWorkflowRun(ownerId, runId, (run) => {
    if (run.status !== "queued" && run.status !== "running") return run;
    requested = true;
    run.stopRequested = true;
    if (run.status === "queued") {
      run.status = "stopped";
      run.finishedAt = Date.now();
      blockRemaining(run, -1, "已停止后续步骤");
    }
    return run;
  });
  if (!requested) stopSignals.delete(key);
  return updated;
}

export async function retryWorkflowRun(
  ownerId: string,
  runId: string,
  fromStepId?: string,
): Promise<{ run: WorkflowRun | null; active: WorkflowRun | null }> {
  stopSignals.delete(runKey(ownerId, runId));
  const result = await updateWorkflowRunIfIdle(
    ownerId,
    runId,
    (current) => prepareWorkflowRunForRetry(current, fromStepId),
  );
  if (result.run) ensureWorkflowRun(ownerId, result.run.id);
  return result;
}
