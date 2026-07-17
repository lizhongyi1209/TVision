"use client";

import { create } from "zustand";
import { useStudio } from "./store";
import {
  createDefaultWorkflow,
  getAvailableBindings,
  MAX_WORKFLOW_STEPS,
  toWorkflowRunSummary,
  validateWorkflow,
  type WorkflowDefinition,
  type WorkflowDraft,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRun,
  type WorkflowRunSummary,
} from "./workflowTypes";

export type TaskView = "design" | "runs";

export interface EditableWorkflow extends WorkflowDraft {
  id?: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
}

interface TaskState {
  ownerKey: string | null;
  workflows: WorkflowDefinition[];
  draft: EditableWorkflow | null;
  selectedNodeId: string | null;
  view: TaskView;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  /** Increments for every draft mutation; async saves only clear dirty when it still matches. */
  revision: number;
  /** Increments when the editor switches to another draft, invalidating stale requests. */
  draftKey: number;
  runs: WorkflowRunSummary[];
  runsLoading: boolean;
  currentRun: WorkflowRun | null;
  runDialogOpen: boolean;
  runInputs: Record<string, string>;

  reset: (ownerKey: string | null) => void;
  loadWorkflows: () => Promise<void>;
  selectWorkflow: (id: string) => void;
  newWorkflow: (force?: boolean) => void;
  duplicateWorkflow: () => Promise<void>;
  deleteWorkflow: () => Promise<void>;
  saveWorkflow: () => Promise<boolean>;
  setDraftName: (name: string) => void;
  setDraftDescription: (description: string) => void;
  selectNode: (id: string | null) => void;
  replaceNode: (node: WorkflowNode) => void;
  addNode: (type: WorkflowNodeType, afterNodeId?: string) => void;
  duplicateNode: (id: string) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, direction: -1 | 1) => void;
  setView: (view: TaskView) => void;

  openRunDialog: (stopAfterNodeId?: string) => void;
  closeRunDialog: () => void;
  setRunInput: (fieldId: string, value: string) => void;
  startRun: (stopAfterNodeId?: string) => Promise<boolean>;
  loadRuns: (workflowId?: string) => Promise<void>;
  openRun: (id: string) => Promise<void>;
  stopRun: () => Promise<void>;
  retryRun: (fromStepId?: string) => Promise<void>;
}

const POLL_INTERVAL_MS = 1400;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let trackedRunId: string | null = null;
let trackedWorkflowId: string | null = null;
let pollFailureCount = 0;
let saveRequestSeq = 0;

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function asEditable(item: WorkflowDefinition): EditableWorkflow {
  return clone(item);
}

function toast(kind: "success" | "error" | "info", message: string) {
  useStudio.getState().showToast(kind, message);
}

class TaskApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TaskApiError";
    this.status = status;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok || payload.error) throw new TaskApiError(payload.error || `请求失败 HTTP ${response.status}`, response.status);
  return payload;
}

function replaceSummary(items: WorkflowRunSummary[], run: WorkflowRun): WorkflowRunSummary[] {
  const summary = toWorkflowRunSummary(run);
  return [summary, ...items.filter((item) => item.id !== run.id)].sort((a, b) => b.createdAt - a.createdAt);
}

function isRunActive(run: WorkflowRun): boolean {
  return run.status === "queued" || run.status === "running";
}

function cancelRunPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  trackedRunId = null;
  trackedWorkflowId = null;
  pollFailureCount = 0;
}

function scheduleRunPoll(runId: string, workflowId: string, delay = POLL_INTERVAL_MS) {
  trackedRunId = runId;
  trackedWorkflowId = workflowId;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void pollRun(runId, workflowId), delay);
}

function trackRun(runId: string, workflowId: string) {
  pollFailureCount = 0;
  scheduleRunPoll(runId, workflowId);
}

async function pollRun(runId: string, workflowId: string) {
  if (trackedRunId !== runId || trackedWorkflowId !== workflowId) return;
  const ownerKey = useTaskStore.getState().ownerKey;
  try {
    const { run } = await api<{ run: WorkflowRun }>(`/api/workflow-runs/${encodeURIComponent(runId)}`);
    const current = useTaskStore.getState();
    // This response may belong to a request that was already in flight when
    // another run became the tracked one. It must not cancel the new poll.
    if (trackedRunId !== runId || trackedWorkflowId !== workflowId) return;
    if (current.ownerKey !== ownerKey || current.draft?.id !== workflowId || run.workflowId !== workflowId) {
      cancelRunPoll();
      return;
    }
    pollFailureCount = 0;
    useTaskStore.setState((state) => ({ currentRun: run, runs: replaceSummary(state.runs, run) }));
    if (isRunActive(run)) {
      scheduleRunPoll(runId, workflowId);
    } else {
      cancelRunPoll();
      toast(run.status === "success" ? "success" : "info", run.status === "success" ? "任务流程已完成" : run.error || "任务流程已结束");
    }
  } catch (error) {
    if (trackedRunId !== runId || trackedWorkflowId !== workflowId || useTaskStore.getState().ownerKey !== ownerKey) return;
    if (error instanceof TaskApiError && [401, 403, 404].includes(error.status)) {
      cancelRunPoll();
      if (error.status === 401 || error.status === 403) useTaskStore.getState().reset(null);
      return;
    }
    pollFailureCount += 1;
    const delay = Math.min(15_000, POLL_INTERVAL_MS * 2 ** Math.min(pollFailureCount, 4));
    scheduleRunPoll(runId, workflowId, delay);
    console.warn("workflow poll failed", error);
  }
}

function remapNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const idMap = new Map(nodes.map((node) => [node.id, makeId(node.type)]));
  return clone(nodes).map((node) => {
    const next = { ...node, id: idMap.get(node.id)! } as WorkflowNode;
    const remapBinding = <T extends { sourceNodeId: string } | null | undefined>(binding: T): T =>
      binding ? ({ ...binding, sourceNodeId: idMap.get(binding.sourceNodeId) || binding.sourceNodeId } as T) : binding;
    if (next.type === "reverse") next.config.image = remapBinding(next.config.image);
    if (next.type === "prompt") next.config.bindings = next.config.bindings.map((item) => ({ ...item, source: remapBinding(item.source)! }));
    if (next.type === "image") {
      next.config.prompt = remapBinding(next.config.prompt);
      next.config.baseImage = remapBinding(next.config.baseImage);
      next.config.referenceImages = next.config.referenceImages?.map((item) => remapBinding(item)!);
    }
    if (next.type === "output") next.config.images = remapBinding(next.config.images);
    return next;
  });
}

function createNode(type: WorkflowNodeType, draft: EditableWorkflow, beforeNodeId: string): WorkflowNode {
  const id = makeId(type);
  const image = getAvailableBindings(draft, beforeNodeId, ["image"])[0];
  const text = getAvailableBindings(draft, beforeNodeId, ["text"])[0];
  const images = getAvailableBindings(draft, beforeNodeId, ["images"])[0];
  if (type === "input") {
    return {
      id,
      type,
      name: "任务输入",
      config: { fields: [{ id: makeId("field"), name: "文本输入", type: "text", required: true, defaultValue: "" }] },
    };
  }
  if (type === "reverse") {
    return { id, type, name: "视觉反推", config: { image: image?.binding || null, mode: "structured" } };
  }
  if (type === "prompt") {
    const source = text?.binding;
    return {
      id,
      type,
      name: "提示词组合",
      config: { template: source ? "{{source}}" : "", bindings: source ? [{ key: "source", source }] : [] },
    };
  }
  if (type === "image") {
    return {
      id,
      type,
      name: "图片生成",
      config: {
        prompt: text?.binding || null,
        referenceImages: image ? [image.binding] : [],
        model: "Nano Banana Pro",
        resolution: "2K",
        aspectRatio: "auto",
        billing: "特价",
        quality: "auto",
        count: 1,
      },
    };
  }
  return { id, type, name: "任务输出", config: { images: images?.binding || null, syncHistory: true } };
}

function markDraft(state: TaskState, draft: EditableWorkflow, selectedNodeId = state.selectedNodeId) {
  return { draft, selectedNodeId, dirty: true, revision: state.revision + 1 };
}

export const useTaskStore = create<TaskState>((set, get) => ({
  ownerKey: null,
  workflows: [],
  draft: null,
  selectedNodeId: null,
  view: "design",
  loading: false,
  saving: false,
  dirty: false,
  revision: 0,
  draftKey: 0,
  runs: [],
  runsLoading: false,
  currentRun: null,
  runDialogOpen: false,
  runInputs: {},

  reset: (ownerKey) => {
    cancelRunPoll();
    saveRequestSeq += 1;
    set((state) => ({
      ownerKey,
      workflows: [],
      draft: null,
      selectedNodeId: null,
      view: "design",
      loading: false,
      saving: false,
      dirty: false,
      revision: 0,
      draftKey: state.draftKey + 1,
      runs: [],
      runsLoading: false,
      currentRun: null,
      runDialogOpen: false,
      runInputs: {},
    }));
  },

  loadWorkflows: async () => {
    const ownerKey = get().ownerKey;
    const requestDraftKey = get().draftKey;
    if (!ownerKey) return;
    set({ loading: true });
    try {
      const { items } = await api<{ items: WorkflowDefinition[] }>("/api/workflows");
      if (get().ownerKey !== ownerKey || get().draftKey !== requestDraftKey) return;
      const currentId = get().draft?.id;
      const current = items.find((item) => item.id === currentId) || items[0];
      if (current) {
        set((state) => ({
          workflows: items,
          draft: asEditable(current),
          selectedNodeId: current.nodes[0]?.id || null,
          dirty: false,
          revision: 0,
          draftKey: state.draftKey + 1,
          loading: false,
        }));
        void get().loadRuns(current.id);
      } else {
        const draft = createDefaultWorkflow("我的第一个任务流程");
        set((state) => ({
          workflows: [],
          draft,
          selectedNodeId: draft.nodes[0]?.id || null,
          dirty: true,
          revision: 1,
          draftKey: state.draftKey + 1,
          runs: [],
          loading: false,
        }));
      }
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draftKey === requestDraftKey) {
        set({ loading: false });
        toast("error", (error as Error).message || "读取任务流程失败");
      }
    }
  },

  selectWorkflow: (id) => {
    if (get().draft?.id === id) return;
    const workflow = get().workflows.find((item) => item.id === id);
    if (!workflow) return;
    cancelRunPoll();
    saveRequestSeq += 1;
    set((state) => ({
      draft: asEditable(workflow),
      selectedNodeId: workflow.nodes[0]?.id || null,
      dirty: false,
      revision: 0,
      draftKey: state.draftKey + 1,
      saving: false,
      view: "design",
      runs: [],
      currentRun: null,
      runDialogOpen: false,
      runInputs: {},
    }));
    void get().loadRuns(id);
  },

  newWorkflow: (force = false) => {
    if (
      get().dirty &&
      !force &&
      typeof window !== "undefined" &&
      !window.confirm("当前流程有未保存修改，确定新建流程吗？")
    ) return;
    cancelRunPoll();
    saveRequestSeq += 1;
    const draft = createDefaultWorkflow("未命名任务流程");
    set((state) => ({
      draft,
      selectedNodeId: draft.nodes[0]?.id || null,
      dirty: true,
      revision: 1,
      draftKey: state.draftKey + 1,
      saving: false,
      view: "design",
      runs: [],
      currentRun: null,
      runDialogOpen: false,
      runInputs: {},
    }));
  },

  duplicateWorkflow: async () => {
    const draft = get().draft;
    if (!draft) return;
    const ownerKey = get().ownerKey;
    const requestDraftKey = get().draftKey;
    try {
      const payload = { name: `${draft.name || "未命名流程"} 副本`, description: draft.description, nodes: remapNodes(draft.nodes) };
      const { item, items } = await api<{ item: WorkflowDefinition; items?: WorkflowDefinition[] }>("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (get().ownerKey !== ownerKey) return;
      if (get().draftKey !== requestDraftKey) {
        set((state) => ({ workflows: items || [item, ...state.workflows.filter((workflow) => workflow.id !== item.id)] }));
        return;
      }
      cancelRunPoll();
      saveRequestSeq += 1;
      set((state) => ({
        workflows: items || [item, ...state.workflows],
        draft: asEditable(item),
        selectedNodeId: item.nodes[0]?.id || null,
        dirty: false,
        revision: 0,
        draftKey: state.draftKey + 1,
        saving: false,
        runs: [],
        currentRun: null,
      }));
      toast("success", "流程副本已创建");
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draftKey === requestDraftKey) {
        toast("error", (error as Error).message || "复制流程失败");
      }
    }
  },

  deleteWorkflow: async () => {
    const id = get().draft?.id;
    if (!id) {
      get().newWorkflow(true);
      return;
    }
    const ownerKey = get().ownerKey;
    const requestDraftKey = get().draftKey;
    try {
      const result = await api<{ items?: WorkflowDefinition[] }>(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (get().ownerKey !== ownerKey || get().draftKey !== requestDraftKey || get().draft?.id !== id) return;
      cancelRunPoll();
      saveRequestSeq += 1;
      const items = result.items ?? get().workflows.filter((item) => item.id !== id);
      const next = items[0];
      if (next) {
        set((state) => ({
          workflows: items,
          draft: asEditable(next),
          selectedNodeId: next.nodes[0]?.id || null,
          dirty: false,
          revision: 0,
          draftKey: state.draftKey + 1,
          saving: false,
          runs: [],
          currentRun: null,
          runDialogOpen: false,
          runInputs: {},
        }));
        void get().loadRuns(next.id);
      } else {
        const draft = createDefaultWorkflow("我的第一个任务流程");
        set((state) => ({
          workflows: [],
          draft,
          selectedNodeId: draft.nodes[0]?.id || null,
          dirty: true,
          revision: 1,
          draftKey: state.draftKey + 1,
          saving: false,
          runs: [],
          currentRun: null,
          runDialogOpen: false,
          runInputs: {},
        }));
      }
      toast("success", "流程已删除");
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draftKey === requestDraftKey) {
        toast("error", (error as Error).message || "删除流程失败");
      }
    }
  },

  saveWorkflow: async () => {
    const currentDraft = get().draft;
    if (!currentDraft || get().saving) return false;
    const snapshot = clone(currentDraft);
    const ownerKey = get().ownerKey;
    const requestDraftKey = get().draftKey;
    const requestRevision = get().revision;
    const requestId = ++saveRequestSeq;
    const errors = validateWorkflow(snapshot).filter((issue) => issue.severity === "error");
    if (errors.length) {
      set({ selectedNodeId: errors[0].nodeId || get().selectedNodeId });
      toast("error", errors[0].message);
      return false;
    }
    set({ saving: true });
    try {
      const url = snapshot.id ? `/api/workflows/${encodeURIComponent(snapshot.id)}` : "/api/workflows";
      const { item, items } = await api<{ item: WorkflowDefinition; items?: WorkflowDefinition[] }>(url, {
        method: snapshot.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: snapshot.name.trim(), description: snapshot.description?.trim(), nodes: snapshot.nodes }),
      });
      if (get().ownerKey !== ownerKey || requestId !== saveRequestSeq) return false;
      let fullySaved = false;
      set((state) => {
        const workflows = items || [item, ...state.workflows.filter((workflow) => workflow.id !== item.id)];
        if (state.draftKey !== requestDraftKey) return { workflows };
        const sameTarget = snapshot.id ? state.draft?.id === snapshot.id : !state.draft?.id;
        if (!sameTarget || !state.draft) return { workflows };
        if (state.revision === requestRevision) {
          fullySaved = true;
          return {
            workflows,
            draft: asEditable(item),
            selectedNodeId: state.selectedNodeId || item.nodes[0]?.id || null,
            dirty: false,
          };
        }
        if (!snapshot.id) {
          return {
            workflows,
            draft: {
              ...state.draft,
              id: item.id,
              version: item.version,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            },
            dirty: true,
          };
        }
        return { workflows, dirty: true };
      });
      toast(fullySaved ? "success" : "info", fullySaved ? "流程已保存" : "已保存提交时版本，当前新修改仍需保存");
      return fullySaved;
    } catch (error) {
      if (get().ownerKey === ownerKey && requestId === saveRequestSeq) {
        toast("error", (error as Error).message || "保存流程失败");
      }
      return false;
    } finally {
      if (get().ownerKey === ownerKey && requestId === saveRequestSeq) set({ saving: false });
    }
  },

  setDraftName: (name) => set((state) => (state.draft ? markDraft(state, { ...state.draft, name }) : {})),
  setDraftDescription: (description) => set((state) => (state.draft ? markDraft(state, { ...state.draft, description }) : {})),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  replaceNode: (node) =>
    set((state) =>
      state.draft ? markDraft(state, { ...state.draft, nodes: state.draft.nodes.map((item) => (item.id === node.id ? node : item)) }) : {},
    ),

  addNode: (type, afterNodeId) => {
    const current = get().draft;
    if (!current || current.nodes.length >= MAX_WORKFLOW_STEPS) return;
    if ((type === "input" || type === "output") && current.nodes.some((node) => node.type === type)) {
      toast("info", type === "input" ? "首版每个流程只允许一个任务输入步骤" : "首版每个流程只允许一个任务输出步骤");
      return;
    }
    set((state) => {
      if (!state.draft) return {};
      const after = afterNodeId ? state.draft.nodes.findIndex((node) => node.id === afterNodeId) : state.draft.nodes.length - 1;
      const insertAt = Math.max(0, after + 1);
      const marker = state.draft.nodes[insertAt]?.id || "__end__";
      const node = createNode(type, state.draft, marker);
      const nodes = [...state.draft.nodes];
      nodes.splice(insertAt, 0, node);
      return markDraft(state, { ...state.draft, nodes }, node.id);
    });
  },

  duplicateNode: (id) => {
    const current = get().draft;
    const currentNode = current?.nodes.find((node) => node.id === id);
    if (!current || !currentNode || current.nodes.length >= MAX_WORKFLOW_STEPS) return;
    if (currentNode.type === "input" || currentNode.type === "output") {
      toast("info", currentNode.type === "input" ? "任务输入步骤不能重复" : "任务输出步骤不能重复");
      return;
    }
    set((state) => {
      if (!state.draft) return {};
      const index = state.draft.nodes.findIndex((node) => node.id === id);
      if (index < 0) return {};
      const source = clone(state.draft.nodes[index]);
      const node = { ...source, id: makeId(source.type), name: `${source.name} 副本` } as WorkflowNode;
      if (node.type === "input") {
        node.config.fields = node.config.fields.map((field) => ({ ...field, id: makeId("field") }));
      }
      const nodes = [...state.draft.nodes];
      nodes.splice(index + 1, 0, node);
      return markDraft(state, { ...state.draft, nodes }, node.id);
    });
  },

  removeNode: (id) =>
    set((state) => {
      if (!state.draft) return {};
      const index = state.draft.nodes.findIndex((node) => node.id === id);
      const nodes = state.draft.nodes.filter((node) => node.id !== id);
      const selectedNodeId = nodes[Math.min(index, nodes.length - 1)]?.id || null;
      return markDraft(state, { ...state.draft, nodes }, selectedNodeId);
    }),

  moveNode: (id, direction) =>
    set((state) => {
      if (!state.draft) return {};
      const index = state.draft.nodes.findIndex((node) => node.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= state.draft.nodes.length) return {};
      const nodes = [...state.draft.nodes];
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
      return markDraft(state, { ...state.draft, nodes });
    }),

  setView: (view) => set({ view }),
  openRunDialog: () => set({ runDialogOpen: true, runInputs: {} }),
  closeRunDialog: () => set({ runDialogOpen: false }),
  setRunInput: (fieldId, value) => set((state) => ({ runInputs: { ...state.runInputs, [fieldId]: value } })),

  startRun: async (stopAfterNodeId) => {
    let draft = get().draft;
    if (!draft) return false;
    if (!draft.id || get().dirty) {
      const saved = await get().saveWorkflow();
      if (!saved) return false;
      draft = get().draft;
    }
    if (!draft?.id) return false;
    const workflowId = draft.id;
    const ownerKey = get().ownerKey;
    try {
      const { run } = await api<{ run: WorkflowRun }>("/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, inputs: get().runInputs, stopAfterNodeId }),
      });
      if (get().ownerKey !== ownerKey || get().draft?.id !== workflowId || run.workflowId !== workflowId) return false;
      set((state) => ({
        currentRun: run,
        runs: replaceSummary(state.runs, run),
        runDialogOpen: false,
        view: "runs",
      }));
      trackRun(run.id, workflowId);
      toast("success", "任务流程已启动");
      return true;
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draft?.id === workflowId) {
        toast("error", (error as Error).message || "启动任务流程失败");
      }
      return false;
    }
  },

  loadRuns: async (workflowId) => {
    const id = workflowId || get().draft?.id;
    if (!id) {
      set({ runs: [], currentRun: null });
      return;
    }
    const ownerKey = get().ownerKey;
    set({ runsLoading: true });
    try {
      const { items } = await api<{ items: WorkflowRunSummary[] }>(`/api/workflow-runs?workflowId=${encodeURIComponent(id)}`);
      if (get().ownerKey !== ownerKey || get().draft?.id !== id) return;
      set({ runs: items || [] });
      const active = items.find((item) => item.status === "queued" || item.status === "running");
      if (active) void get().openRun(active.id);
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draft?.id === id) {
        toast("error", (error as Error).message || "读取运行记录失败");
      }
    } finally {
      if (get().ownerKey === ownerKey && get().draft?.id === id) set({ runsLoading: false });
    }
  },

  openRun: async (id) => {
    const workflowId = get().draft?.id;
    const ownerKey = get().ownerKey;
    if (!workflowId) return;
    try {
      const { run } = await api<{ run: WorkflowRun }>(`/api/workflow-runs/${encodeURIComponent(id)}`);
      if (get().ownerKey !== ownerKey || get().draft?.id !== workflowId || run.workflowId !== workflowId) return;
      set((state) => ({ currentRun: run, runs: replaceSummary(state.runs, run), view: "runs" }));
      if (isRunActive(run)) trackRun(run.id, workflowId);
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draft?.id === workflowId) {
        toast("error", (error as Error).message || "读取运行详情失败");
      }
    }
  },

  stopRun: async () => {
    const run = get().currentRun;
    if (!run || !isRunActive(run)) return;
    const ownerKey = get().ownerKey;
    const workflowId = run.workflowId;
    try {
      const result = await api<{ run: WorkflowRun }>(`/api/workflow-runs/${encodeURIComponent(run.id)}/stop`, { method: "POST" });
      if (
        get().ownerKey !== ownerKey ||
        get().draft?.id !== workflowId ||
        get().currentRun?.id !== run.id ||
        result.run.workflowId !== workflowId
      ) return;
      set((state) => ({ currentRun: result.run, runs: replaceSummary(state.runs, result.run) }));
      if (isRunActive(result.run)) trackRun(result.run.id, workflowId);
      else cancelRunPoll();
      toast("info", "已请求停止后续步骤，当前步骤仍会完成");
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draft?.id === workflowId && get().currentRun?.id === run.id) {
        toast("error", (error as Error).message || "停止失败");
      }
    }
  },

  retryRun: async (fromStepId) => {
    const run = get().currentRun;
    if (!run || isRunActive(run)) return;
    const ownerKey = get().ownerKey;
    const workflowId = run.workflowId;
    try {
      const result = await api<{ run: WorkflowRun }>(`/api/workflow-runs/${encodeURIComponent(run.id)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromStepId }),
      });
      if (
        get().ownerKey !== ownerKey ||
        get().draft?.id !== workflowId ||
        get().currentRun?.id !== run.id ||
        result.run.workflowId !== workflowId
      ) return;
      set((state) => ({ currentRun: result.run, runs: replaceSummary(state.runs, result.run), view: "runs" }));
      trackRun(result.run.id, workflowId);
      toast("success", "已从所选步骤重新运行");
    } catch (error) {
      if (get().ownerKey === ownerKey && get().draft?.id === workflowId && get().currentRun?.id === run.id) {
        toast("error", (error as Error).message || "重试失败");
      }
    }
  },
}));
