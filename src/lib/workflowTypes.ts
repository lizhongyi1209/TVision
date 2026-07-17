import { MAX_REF_IMAGES } from "./limits.ts";
import { BILLINGS, MODELS, QUALITY_OPTIONS, comboError } from "./models.ts";
import type { Billing, ModelName, Quality, Resolution } from "./types";

export const WORKFLOW_SCHEMA_VERSION = 1 as const;
export const MAX_WORKFLOW_STEPS = 12;
export const MAX_WORKFLOW_INPUT_FIELDS = 40;
export const MAX_WORKFLOW_INPUT_BYTES = 30_000_000;
export const MAX_WORKFLOW_TEXT_INPUT_BYTES = 100_000;
export const MAX_WORKFLOW_IMAGE_INPUT_BYTES = 20_000_000;

export type WorkflowNodeType = "input" | "reverse" | "prompt" | "image" | "output";
export type WorkflowValueType = "text" | "image" | "images";

export interface WorkflowBinding {
  sourceNodeId: string;
  sourcePort: string;
  /** Selecting one item converts an image[] output into an image value. */
  index?: number;
}

export interface WorkflowInputField {
  id: string;
  name: string;
  type: "text" | "image";
  required: boolean;
  defaultValue?: string;
}

interface WorkflowNodeBase<TType extends WorkflowNodeType, TConfig> {
  id: string;
  type: TType;
  name: string;
  enabled?: boolean;
  config: TConfig;
}

export type WorkflowInputNode = WorkflowNodeBase<"input", {
  fields: WorkflowInputField[];
}>;

export type WorkflowReverseNode = WorkflowNodeBase<"reverse", {
  image: WorkflowBinding | null;
  mode?: "structured" | "prompt";
  /** Reserved for a future explicit model picker; the current runner uses the configured vision fallback roster. */
  model?: string;
}>;

export interface WorkflowNamedBinding {
  key: string;
  source: WorkflowBinding;
}

export type WorkflowPromptNode = WorkflowNodeBase<"prompt", {
  template: string;
  bindings: WorkflowNamedBinding[];
}>;

export type WorkflowImageNode = WorkflowNodeBase<"image", {
  prompt: WorkflowBinding | null;
  baseImage?: WorkflowBinding | null;
  referenceImages?: WorkflowBinding[];
  model: ModelName;
  resolution: Resolution;
  aspectRatio: string;
  billing: Billing;
  quality?: Quality;
  count: number;
  /** Bounds polling after submission; clamped server-side to 1-30 minutes. */
  maxPollMs?: number;
}>;

export type WorkflowOutputNode = WorkflowNodeBase<"output", {
  images: WorkflowBinding | null;
  /** Optional selection when the binding points at image[]. */
  selectIndex?: number;
  syncHistory?: boolean;
}>;

export type WorkflowNode =
  | WorkflowInputNode
  | WorkflowReverseNode
  | WorkflowPromptNode
  | WorkflowImageNode
  | WorkflowOutputNode;

export interface WorkflowDefinition {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  version: number;
  nodes: WorkflowNode[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDraft {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
}

export type WorkflowRunStatus = "queued" | "running" | "success" | "failed" | "stopped";
export type WorkflowStepStatus = "pending" | "running" | "success" | "failed" | "blocked" | "skipped";

export type WorkflowValue =
  | { type: "text"; value: string }
  | { type: "image"; value: string }
  | { type: "images"; value: string[] };

export interface WorkflowUpstreamJob {
  taskId: string;
  status: "submitted" | "running" | "success" | "failed";
  progress: number | null;
  images: string[];
  error?: string;
}

export interface WorkflowStepRun {
  nodeId: string;
  nodeType: WorkflowNodeType;
  name: string;
  status: WorkflowStepStatus;
  attempts: number;
  attemptId?: string;
  startedAt?: number;
  finishedAt?: number;
  progress?: number | null;
  inputs?: Record<string, WorkflowValue>;
  outputs: Record<string, WorkflowValue>;
  upstreamJobs?: WorkflowUpstreamJob[];
  submissionErrors?: string[];
  error?: string;
  errorDetail?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  workflowName: string;
  workflowSnapshot: WorkflowDefinition;
  inputs: Record<string, string>;
  status: WorkflowRunStatus;
  steps: WorkflowStepRun[];
  outputs: Record<string, WorkflowValue>;
  currentNodeId?: string;
  stopAfterNodeId?: string;
  stopRequested: boolean;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  workflowVersion: number;
  workflowName: string;
  status: WorkflowRunStatus;
  currentNodeId?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
}

export interface WorkflowValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  nodeId?: string;
}

export interface WorkflowOutputPort {
  nodeId: string;
  nodeName: string;
  port: string;
  label: string;
  type: WorkflowValueType;
}

export interface WorkflowAvailableBinding extends WorkflowOutputPort {
  binding: WorkflowBinding;
  /** image[] can feed an image input only after the UI chooses an index. */
  requiresIndex: boolean;
}

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultWorkflow(name = "反推并参考图生成"): WorkflowDraft {
  const inputId = makeId("input");
  const reverseId = makeId("reverse");
  const promptId = makeId("prompt");
  const imageId = makeId("image");
  const outputId = makeId("output");
  const sourceImageId = "sourceImage";
  const referenceImageId = "referenceImage";
  const customTextId = "customText";

  return {
    name,
    description: "先反推原图，再与自定义描述组合，并使用新参考图生成结果。",
    nodes: [
      {
        id: inputId,
        type: "input",
        name: "任务输入",
        config: {
          fields: [
            { id: sourceImageId, name: "原始图片", type: "image", required: true },
            { id: referenceImageId, name: "新参考图", type: "image", required: false },
            { id: customTextId, name: "自定义描述", type: "text", required: false, defaultValue: "" },
          ],
        },
      },
      {
        id: reverseId,
        type: "reverse",
        name: "视觉反推",
        config: { image: { sourceNodeId: inputId, sourcePort: sourceImageId }, mode: "structured" },
      },
      {
        id: promptId,
        type: "prompt",
        name: "提示词组合",
        config: {
          template: "{{reversePrompt}}\n\nAdditional requirements:\n{{customText}}",
          bindings: [
            { key: "reversePrompt", source: { sourceNodeId: reverseId, sourcePort: "prompt" } },
            { key: "customText", source: { sourceNodeId: inputId, sourcePort: customTextId } },
          ],
        },
      },
      {
        id: imageId,
        type: "image",
        name: "图片生成",
        config: {
          prompt: { sourceNodeId: promptId, sourcePort: "text" },
          referenceImages: [{ sourceNodeId: inputId, sourcePort: referenceImageId }],
          model: "Nano Banana Pro",
          resolution: "2K",
          aspectRatio: "auto",
          billing: "特价",
          quality: "auto",
          count: 1,
        },
      },
      {
        id: outputId,
        type: "output",
        name: "任务输出",
        config: { images: { sourceNodeId: imageId, sourcePort: "images" }, syncHistory: true },
      },
    ],
  };
}

export function bindingKey(binding: WorkflowBinding): string {
  return `${binding.sourceNodeId}.${binding.sourcePort}${binding.index == null ? "" : `[${binding.index}]`}`;
}

export function resolveWorkflowBinding(run: WorkflowRun, binding: WorkflowBinding): WorkflowValue | undefined {
  const step = run.steps.find((item) => item.nodeId === binding.sourceNodeId);
  const value = step?.outputs[binding.sourcePort];
  if (!value) {
    const source = run.workflowSnapshot.nodes.find((node) => node.id === binding.sourceNodeId);
    if (source?.type !== "input") return undefined;
    const field = source.config.fields.find((item) => item.id === binding.sourcePort);
    if (!field) return undefined;
    const raw = run.inputs[`${source.id}.${field.id}`] ?? run.inputs[field.id] ?? field.defaultValue ?? "";
    if (!raw && field.type === "image") return undefined;
    return field.type === "image" ? { type: "image", value: raw } : { type: "text", value: raw };
  }
  if (binding.index == null) return value;
  if (value.type !== "images") return undefined;
  const image = value.value[binding.index];
  return image == null ? undefined : { type: "image", value: image };
}

export function getNodeOutputPorts(node: WorkflowNode): WorkflowOutputPort[] {
  if (node.type === "input") {
    return node.config.fields.map((field) => ({
      nodeId: node.id,
      nodeName: node.name,
      port: field.id,
      label: field.name,
      type: field.type,
    }));
  }
  if (node.type === "reverse") {
    return [
      { nodeId: node.id, nodeName: node.name, port: "prompt", label: "反推提示词", type: "text" },
      { nodeId: node.id, nodeName: node.name, port: "raw", label: "结构化原文", type: "text" },
      { nodeId: node.id, nodeName: node.name, port: "model", label: "反推模型", type: "text" },
    ];
  }
  if (node.type === "prompt") {
    return [{ nodeId: node.id, nodeName: node.name, port: "text", label: "组合提示词", type: "text" }];
  }
  if (node.type === "image") {
    return [{ nodeId: node.id, nodeName: node.name, port: "images", label: "生成图片", type: "images" }];
  }
  return [{ nodeId: node.id, nodeName: node.name, port: "result", label: "最终输出", type: "images" }];
}

export function getBindingValueType(workflow: Pick<WorkflowDefinition, "nodes"> | WorkflowDraft, binding: WorkflowBinding): WorkflowValueType | null {
  const source = workflow.nodes.find((node) => node.id === binding.sourceNodeId);
  const port = source && getNodeOutputPorts(source).find((item) => item.port === binding.sourcePort);
  if (!port) return null;
  if (binding.index != null) return port.type === "images" ? "image" : null;
  return port.type;
}

export function isWorkflowTypeCompatible(actual: WorkflowValueType, expected: WorkflowValueType): boolean {
  return actual === expected || (expected === "images" && actual === "image");
}

export function isValidRunUntilTarget(
  workflow: Pick<WorkflowDefinition, "nodes"> | WorkflowDraft,
  nodeId: string | undefined,
): boolean {
  return !nodeId || workflow.nodes.some((node) => node.id === nodeId && node.enabled !== false);
}

export function shouldStopAfterWorkflowStep(
  run: Pick<WorkflowRun, "stopAfterNodeId">,
  nodeId: string,
  status: WorkflowStepStatus,
): boolean {
  return run.stopAfterNodeId === nodeId && (status === "success" || status === "skipped");
}

export function getAvailableBindings(
  workflow: Pick<WorkflowDefinition, "nodes"> | WorkflowDraft,
  beforeNodeId: string,
  acceptedTypes?: WorkflowValueType[],
): WorkflowAvailableBinding[] {
  const stop = workflow.nodes.findIndex((node) => node.id === beforeNodeId);
  const prior = stop < 0 ? workflow.nodes : workflow.nodes.slice(0, stop);
  const out: WorkflowAvailableBinding[] = [];
  for (const node of prior) {
    if (node.enabled === false) continue;
    for (const port of getNodeOutputPorts(node)) {
      const exact = !acceptedTypes?.length || acceptedTypes.some((type) => isWorkflowTypeCompatible(port.type, type));
      const selectableImage = !!acceptedTypes?.includes("image") && port.type === "images";
      if (!exact && !selectableImage) continue;
      out.push({
        ...port,
        binding: { sourceNodeId: port.nodeId, sourcePort: port.port },
        requiresIndex: selectableImage && !exact,
      });
    }
  }
  return out;
}

export function extractPromptVariables(template: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      keys.push(match[1]);
    }
  }
  return keys;
}

export function renderPromptTemplate(template: string, variables: Record<string, string>): string {
  const missing = new Set<string>();
  const rendered = template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) {
      missing.add(key);
      return "";
    }
    return variables[key];
  });
  if (missing.size) throw new Error(`提示词变量未绑定：${Array.from(missing).join("、")}`);
  return rendered.trim();
}

export function prepareWorkflowRunForRetry(run: WorkflowRun, fromStepId?: string): WorkflowRun {
  const next = structuredClone(run);
  const requested = fromStepId ? next.steps.findIndex((step) => step.nodeId === fromStepId) : -1;
  let start = requested;
  if (requested >= 0) {
    const earlierFailure = next.steps.findIndex(
      (step, index) => index <= requested && (step.status === "failed" || step.status === "running"),
    );
    if (earlierFailure >= 0) start = earlierFailure;
  }
  if (start < 0) {
    start = next.steps.findIndex((step) => ["failed", "blocked", "running"].includes(step.status));
  }
  if (start < 0) start = next.steps.findIndex((step) => step.status !== "success" && step.status !== "skipped");
  if (start < 0) start = 0;

  for (let index = start; index < next.steps.length; index++) {
    const step = next.steps[index];
    const node = next.workflowSnapshot.nodes[index];
    if (node?.enabled === false) {
      step.status = "skipped";
      continue;
    }
    const keepSuccessfulJobs = index === start && step.nodeType === "image";
    const successfulJobs = keepSuccessfulJobs
      ? (step.upstreamJobs || []).filter((job) => job.status === "success")
      : [];
    const successfulImages = successfulJobs.flatMap((job) => job.images);
    step.status = "pending";
    step.attemptId = undefined;
    step.startedAt = undefined;
    step.finishedAt = undefined;
    step.progress = null;
    step.inputs = undefined;
    step.outputs = successfulImages.length ? { images: { type: "images", value: successfulImages } } : {};
    step.upstreamJobs = successfulJobs.length ? successfulJobs : undefined;
    step.submissionErrors = undefined;
    step.error = undefined;
    step.errorDetail = undefined;
  }

  next.status = "queued";
  next.outputs = {};
  next.currentNodeId = undefined;
  next.stopRequested = false;
  next.error = undefined;
  next.startedAt = undefined;
  next.finishedAt = undefined;
  next.updatedAt = Date.now();
  return next;
}

export function validateWorkflow(workflow: Pick<WorkflowDefinition, "name" | "nodes"> | WorkflowDraft): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const error = (code: string, message: string, nodeId?: string) =>
    issues.push({ code, message, severity: "error", nodeId });
  const warning = (code: string, message: string, nodeId?: string) =>
    issues.push({ code, message, severity: "warning", nodeId });

  if (!workflow.name?.trim()) error("workflow.name", "流程需要一个名字");
  if (!nodes.length) error("workflow.empty", "流程至少需要一个步骤");
  if (nodes.length > MAX_WORKFLOW_STEPS) error("workflow.too_many_steps", `首版最多支持 ${MAX_WORKFLOW_STEPS} 个步骤`);

  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.id?.trim()) error("node.id", "步骤缺少 id");
    else if (ids.has(node.id)) error("node.duplicate_id", `步骤 id 重复：${node.id}`, node.id);
    else ids.add(node.id);
    if (!node.name?.trim()) error("node.name", "步骤需要一个名字", node.id);
  }

  const enabledInputs = nodes.filter((node) => node.type === "input" && node.enabled !== false);
  const enabledOutputs = nodes.filter((node) => node.type === "output" && node.enabled !== false);
  if (enabledInputs.length !== 1) error("workflow.input_count", "首版流程必须且只能包含一个启用的任务输入步骤");
  if (enabledOutputs.length > 1) error("workflow.output_count", "首版流程只能包含一个启用的任务输出步骤");

  const checkBinding = (
    node: WorkflowNode,
    binding: WorkflowBinding | null | undefined,
    expected: WorkflowValueType,
    label: string,
    required = true,
  ) => {
    if (!binding) {
      if (required) error("binding.required", `${label}未绑定`, node.id);
      return;
    }
    const nodeIndex = nodes.findIndex((item) => item.id === node.id);
    const sourceIndex = nodes.findIndex((item) => item.id === binding.sourceNodeId);
    if (sourceIndex < 0) {
      error("binding.source_missing", `${label}引用的步骤不存在`, node.id);
      return;
    }
    if (sourceIndex >= nodeIndex) {
      error("binding.not_prior", `${label}只能引用当前步骤之前的输出`, node.id);
      return;
    }
    const source = nodes[sourceIndex];
    if (source.enabled === false) {
      error("binding.source_disabled", `${label}引用了已停用步骤`, node.id);
      return;
    }
    const port = getNodeOutputPorts(source).find((item) => item.port === binding.sourcePort);
    if (!port) {
      error("binding.port_missing", `${label}引用的输出不存在`, node.id);
      return;
    }
    if (binding.index != null && (!Number.isInteger(binding.index) || binding.index < 0 || port.type !== "images")) {
      error("binding.bad_index", `${label}的图片序号无效`, node.id);
      return;
    }
    const actual = binding.index != null ? "image" : port.type;
    if (!isWorkflowTypeCompatible(actual, expected)) {
      error("binding.type", `${label}需要 ${expected}，当前绑定为 ${actual}`, node.id);
    }
  };

  for (const node of nodes) {
    if (node.enabled === false) continue;
    if (node.type === "input") {
      if (!node.config.fields.length) error("input.empty", "任务输入至少需要一个字段", node.id);
      if (node.config.fields.length > MAX_WORKFLOW_INPUT_FIELDS) {
        error("input.too_many_fields", `任务输入最多支持 ${MAX_WORKFLOW_INPUT_FIELDS} 个字段`, node.id);
      }
      const fieldIds = new Set<string>();
      for (const field of node.config.fields) {
        if (!field.id?.trim() || !field.name?.trim()) error("input.field", "输入字段需要名称和 id", node.id);
        else if (fieldIds.has(field.id)) error("input.duplicate_field", `输入字段 id 重复：${field.id}`, node.id);
        else fieldIds.add(field.id);
      }
    } else if (node.type === "reverse") {
      checkBinding(node, node.config.image, "image", "反推图片");
    } else if (node.type === "prompt") {
      if (!node.config.template.trim()) error("prompt.empty", "提示词模板不能为空", node.id);
      const keys = new Set<string>();
      for (const item of node.config.bindings) {
        if (!item.key.trim()) error("prompt.binding_key", "提示词变量需要一个名字", node.id);
        else if (keys.has(item.key)) error("prompt.duplicate_key", `提示词变量重复：${item.key}`, node.id);
        else keys.add(item.key);
        checkBinding(node, item.source, "text", `变量 ${item.key || "未命名"}`);
      }
      for (const key of extractPromptVariables(node.config.template)) {
        if (!keys.has(key)) error("prompt.variable_missing", `模板变量 {{${key}}} 未绑定`, node.id);
      }
      for (const key of keys) {
        if (!extractPromptVariables(node.config.template).includes(key)) {
          warning("prompt.binding_unused", `变量 ${key} 未在模板中使用`, node.id);
        }
      }
    } else if (node.type === "image") {
      checkBinding(node, node.config.prompt, "text", "生成提示词");
      checkBinding(node, node.config.baseImage, "image", "底图", false);
      const refs = node.config.referenceImages || [];
      if (refs.length > MAX_REF_IMAGES) error("image.too_many_refs", `参考图最多 ${MAX_REF_IMAGES} 张`, node.id);
      refs.forEach((binding, index) => checkBinding(node, binding, "image", `参考图 ${index + 1}`));
      const model = MODELS.find((item) => item.name === node.config.model);
      if (!model) error("image.model", `不支持的生成模型：${String(node.config.model)}`, node.id);
      if (!BILLINGS.includes(node.config.billing)) error("image.billing", `不支持的计费方式：${String(node.config.billing)}`, node.id);
      if (node.config.quality && !QUALITY_OPTIONS.some((item) => item.value === node.config.quality)) {
        error("image.quality", `不支持的质量档位：${String(node.config.quality)}`, node.id);
      }
      if (model && BILLINGS.includes(node.config.billing)) {
        const combo = comboError(node.config.model, node.config.resolution, node.config.billing, node.config.aspectRatio);
        if (combo) error("image.combo", combo, node.id);
      }
      if (!Number.isInteger(node.config.count) || node.config.count < 1 || node.config.count > 4) {
        error("image.count", "单个生成步骤的张数必须是 1-4", node.id);
      }
    } else if (node.type === "output") {
      checkBinding(node, node.config.images, "images", "任务输出");
      if (node.config.selectIndex != null && (!Number.isInteger(node.config.selectIndex) || node.config.selectIndex < 0)) {
        error("output.bad_index", "任务输出的图片序号无效", node.id);
      } else if (node.config.selectIndex != null && node.config.images) {
        const boundType = getBindingValueType(workflow, node.config.images);
        if (boundType === "image") {
          error("output.index_on_image", "单张图片输出不需要再选择图片序号", node.id);
        } else {
          const source = nodes.find((item) => item.id === node.config.images?.sourceNodeId);
          if (source?.type === "image" && node.config.selectIndex >= source.config.count) {
            error("output.index_out_of_range", `生成步骤最多输出 ${source.config.count} 张图片`, node.id);
          }
        }
      }
    }
  }

  if (!nodes.some((node) => node.type === "output" && node.enabled !== false && node.config.images)) {
    error("workflow.output_missing", "流程需要配置任务输出");
  }
  return issues;
}

export function toWorkflowRunSummary(run: WorkflowRun): WorkflowRunSummary {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    workflowName: run.workflowName,
    status: run.status,
    currentNodeId: run.currentNodeId,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  };
}

function redactDataUrl(value: string): string {
  return value.startsWith("data:") ? "[data URL omitted]" : value;
}

function redactWorkflowValue(value: WorkflowValue): WorkflowValue {
  if (value.type === "text") return value;
  if (value.type === "image") return { type: "image", value: redactDataUrl(value.value) };
  return { type: "images", value: value.value.map(redactDataUrl) };
}

/** Keep polling responses small while the durable server-side run retains its data URLs. */
export function toPublicWorkflowRun(run: WorkflowRun): WorkflowRun {
  const publicRun = structuredClone(run);
  publicRun.inputs = Object.fromEntries(
    Object.entries(publicRun.inputs).map(([key, value]) => [key, redactDataUrl(value)]),
  );
  publicRun.outputs = Object.fromEntries(
    Object.entries(publicRun.outputs).map(([key, value]) => [key, redactWorkflowValue(value)]),
  );
  for (const step of publicRun.steps) {
    if (step.inputs) {
      step.inputs = Object.fromEntries(
        Object.entries(step.inputs).map(([key, value]) => [key, redactWorkflowValue(value)]),
      );
    }
    step.outputs = Object.fromEntries(
      Object.entries(step.outputs).map(([key, value]) => [key, redactWorkflowValue(value)]),
    );
    if (step.upstreamJobs) {
      for (const job of step.upstreamJobs) job.images = job.images.map(redactDataUrl);
    }
  }
  for (const node of publicRun.workflowSnapshot.nodes) {
    if (node.type !== "input") continue;
    for (const field of node.config.fields) {
      if (field.defaultValue) field.defaultValue = redactDataUrl(field.defaultValue);
    }
  }
  return publicRun;
}
