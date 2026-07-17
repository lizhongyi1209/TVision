"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { MODELS, ASPECT_RATIOS, BILLINGS, GPT_IMAGE_2_RATIOS, resolutionsFor } from "@/lib/models";
import { MAX_REF_IMAGES } from "@/lib/limits";
import { type EditableWorkflow, useTaskStore } from "@/lib/taskStore";
import type { Billing, ModelName, Quality, Resolution } from "@/lib/types";
import { cn, downloadUrl, fileToDownscaledDataURL } from "@/lib/utils";
import {
  bindingKey,
  getAvailableBindings,
  getBindingValueType,
  getNodeOutputPorts,
  MAX_WORKFLOW_STEPS,
  validateWorkflow,
  type WorkflowBinding,
  type WorkflowInputField,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRun,
  type WorkflowStepRun,
  type WorkflowValidationIssue,
  type WorkflowValueType,
} from "@/lib/workflowTypes";
import { useStudio } from "@/lib/store";
import { Icon } from "./icons";
import { ModelIcon } from "./modelIcons";
import { Select } from "./ui";

const NODE_META: Record<WorkflowNodeType, { label: string; kind: string; icon: string; dot: string; output: string }> = {
  input: { label: "任务输入", kind: "运行时字段", icon: "ImageSquare", dot: "bg-[#81a9d8]", output: "输入变量" },
  reverse: { label: "视觉反推", kind: "图片 → 文本", icon: "MagicWand", dot: "bg-accent", output: "反推提示词" },
  prompt: { label: "提示词组合", kind: "文本 → 文本", icon: "FileText", dot: "bg-[#b8a2d8]", output: "组合提示词" },
  image: { label: "图片生成", kind: "文本 + 图片 → 图片", icon: "Sparkle", dot: "bg-[#77c49a]", output: "生成图片" },
  output: { label: "任务输出", kind: "最终结果", icon: "ArrowRight", dot: "bg-[#77c49a]", output: "最终输出" },
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  pending: "等待",
  running: "运行中",
  success: "成功",
  failed: "失败",
  stopped: "已停止",
  blocked: "已阻断",
  skipped: "已跳过",
};

function timeAgo(value: number): string {
  const delta = Date.now() - value;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(value);
}

function durationText(startedAt?: number, finishedAt?: number): string {
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.round(((finishedAt || Date.now()) - startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function bindingLabel(draft: EditableWorkflow, binding: WorkflowBinding | null | undefined): string {
  if (!binding) return "未绑定";
  const node = draft.nodes.find((item) => item.id === binding.sourceNodeId);
  const port = node && getNodeOutputPorts(node).find((item) => item.port === binding.sourcePort);
  if (!node || !port) return "无效来源";
  return `${node.name} · ${port.label}${binding.index == null ? "" : ` #${binding.index + 1}`}`;
}

function nodeBindings(node: WorkflowNode): WorkflowBinding[] {
  if (node.type === "reverse") return node.config.image ? [node.config.image] : [];
  if (node.type === "prompt") return node.config.bindings.map((item) => item.source);
  if (node.type === "image") {
    return [node.config.prompt, node.config.baseImage, ...(node.config.referenceImages || [])].filter(Boolean) as WorkflowBinding[];
  }
  if (node.type === "output") return node.config.images ? [node.config.images] : [];
  return [];
}

function nodeSummary(node: WorkflowNode): string {
  if (node.type === "input") return `${node.config.fields.length} 个运行时字段`;
  if (node.type === "reverse") return "结构化反推 · 自动选择视觉模型";
  if (node.type === "prompt") return `${node.config.bindings.length} 个文本变量 · ${node.config.template.length} 字模板`;
  if (node.type === "image") {
    const refs = node.config.referenceImages?.length || 0;
    return `${node.config.model} · ${node.config.resolution} · ${node.config.aspectRatio === "auto" ? "自动比例" : node.config.aspectRatio} · ${node.config.billing} · ×${node.config.count}${refs ? ` · ${refs} 参考图` : ""}`;
  }
  return `结果自动进入历史生成${node.config.selectIndex == null ? "" : ` · 选第 ${node.config.selectIndex + 1} 张`}`;
}

function statusTone(status?: string): string {
  if (status === "success") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  if (status === "running" || status === "queued") return "border-accent/35 bg-accent/10 text-accent";
  if (status === "failed" || status === "blocked") return "border-red-300/25 bg-red-300/10 text-red-200";
  if (status === "stopped" || status === "skipped") return "border-white/10 bg-white/[0.04] text-fg-mute";
  return "border-white/10 bg-white/[0.04] text-fg-dim";
}

function SmallIconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-mute transition-colors hover:bg-white/[0.07] hover:text-fg disabled:pointer-events-none disabled:opacity-25"
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => element.getClientRects().length > 0);
}

function trapTabKey(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== "Tab") return;
  const focusable = focusableElements(container);
  if (!focusable.length) {
    event.preventDefault();
    container?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function InsertStepButton({ draft, afterNodeId }: { draft: EditableWorkflow; afterNodeId: string }) {
  const [open, setOpen] = useState(false);
  const addNode = useTaskStore((state) => state.addNode);
  return (
    <div
      className={cn("absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2", open && "z-40")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        title="在这里插入步骤"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-fg-mute opacity-0 transition-all hover:border-accent/40 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100",
          open && "border-accent/40 text-accent opacity-100",
        )}
      >
        <Icon name="Plus" size={10} />
      </button>
      {open ? (
        <div className="absolute left-1/2 top-6 w-36 -translate-x-1/2 rounded-lg border border-line-2 bg-[#1a1a1e]/[0.98] p-1 shadow-[0_18px_48px_rgba(0,0,0,.55)] backdrop-blur-xl">
          {(Object.keys(NODE_META) as WorkflowNodeType[]).map((type) => {
            const uniqueExists = (type === "input" || type === "output") && draft.nodes.some((node) => node.type === type);
            return (
              <button
                key={type}
                type="button"
                disabled={uniqueExists || draft.nodes.length >= MAX_WORKFLOW_STEPS}
                onClick={() => {
                  addNode(type, afterNodeId);
                  setOpen(false);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[10px] text-fg-dim hover:bg-white/[0.06] hover:text-fg disabled:pointer-events-none disabled:opacity-30"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", NODE_META[type].dot)} />
                {NODE_META[type].label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function TaskWorkshop() {
  const draft = useTaskStore((state) => state.draft);
  const loadWorkflows = useTaskStore((state) => state.loadWorkflows);
  const selectedNodeId = useTaskStore((state) => state.selectedNodeId);
  const view = useTaskStore((state) => state.view);
  const currentRun = useTaskStore((state) => state.currentRun);
  const openRunDialog = useTaskStore((state) => state.openRunDialog);
  const [runTarget, setRunTarget] = useState<string | undefined>();
  const [mobilePanel, setMobilePanel] = useState<"flows" | "inspector" | null>(null);

  useEffect(() => {
    if (!draft) void loadWorkflows();
  }, [draft, loadWorkflows]);

  if (!draft) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-mute">
        <Icon name="CircleNotch" size={20} className="animate-spin" />
      </div>
    );
  }

  const selectedNode = draft.nodes.find((node) => node.id === selectedNodeId) || null;
  const displayedFlow: EditableWorkflow = view === "runs" && currentRun ? currentRun.workflowSnapshot : draft;

  return (
    <div className="relative flex w-full min-w-0 flex-1 overflow-hidden bg-ink">
      <TaskSidebar draft={draft} className="hidden xl:flex" />
      <main className="relative flex w-full min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        <TaskToolbar
          draft={draft}
          onOpenFlows={() => setMobilePanel("flows")}
          onOpenInspector={() => setMobilePanel("inspector")}
          onRun={() => {
            setRunTarget(undefined);
            openRunDialog();
          }}
        />
        <TaskFlow draft={displayedFlow} run={view === "runs" ? currentRun : null} />
      </main>
      <aside className="hidden w-[342px] shrink-0 flex-col border-l border-line bg-panel/95 xl:flex">
        {view === "design" ? (
          <TaskInspector
            draft={draft}
            node={selectedNode}
            onRunTo={(nodeId) => {
              setRunTarget(nodeId);
              openRunDialog();
            }}
          />
        ) : (
          <RunInspector draft={draft} />
        )}
      </aside>
      <MobileTaskDrawer open={mobilePanel === "flows"} side="left" title="任务流程" onClose={() => setMobilePanel(null)}>
        <TaskSidebar draft={draft} className="flex h-full !w-full" onNavigate={() => setMobilePanel(null)} />
      </MobileTaskDrawer>
      <MobileTaskDrawer open={mobilePanel === "inspector"} side="right" title={view === "design" ? "步骤设置" : "运行记录"} onClose={() => setMobilePanel(null)}>
        <aside className="flex h-full min-h-0 w-full flex-col bg-panel/95">
          {view === "design" ? (
            <TaskInspector
              draft={draft}
              node={selectedNode}
              onRunTo={(nodeId) => {
                setMobilePanel(null);
                setRunTarget(nodeId);
                openRunDialog();
              }}
            />
          ) : (
            <RunInspector draft={draft} />
          )}
        </aside>
      </MobileTaskDrawer>
      <ActiveRunBar run={currentRun} onOpenInspector={() => setMobilePanel("inspector")} />
      <RunInputDialog draft={draft} stopAfterNodeId={runTarget} onClearTarget={() => setRunTarget(undefined)} />
    </div>
  );
}

function MobileTaskDrawer({
  open,
  side,
  title,
  onClose,
  children,
}: {
  open: boolean;
  side: "left" | "right";
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-x-0 bottom-0 top-14 z-[60] bg-black/70 backdrop-blur-sm xl:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ x: side === "left" ? "-100%" : "100%" }}
            animate={{ x: 0 }}
            exit={{ x: side === "left" ? "-100%" : "100%" }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              trapTabKey(event, drawerRef.current);
            }}
            className={cn(
              "absolute inset-y-0 flex w-[min(90vw,380px)] flex-col overflow-hidden border-line-2 bg-ink-2 shadow-[0_24px_70px_rgba(0,0,0,.55)]",
              side === "left" ? "left-0 border-r" : "right-0 border-l",
            )}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
              <div id={titleId} className="text-xs font-semibold text-fg">{title}</div>
              <button
                ref={closeRef}
                type="button"
                aria-label={`关闭${title}`}
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-md text-fg-mute hover:bg-white/[0.06] hover:text-fg"
              >
                <Icon name="X" size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function TaskSidebar({ draft, className, onNavigate }: { draft: EditableWorkflow; className?: string; onNavigate?: () => void }) {
  const workflows = useTaskStore((state) => state.workflows);
  const loading = useTaskStore((state) => state.loading);
  const dirty = useTaskStore((state) => state.dirty);
  const selectWorkflow = useTaskStore((state) => state.selectWorkflow);
  const newWorkflow = useTaskStore((state) => state.newWorkflow);
  const duplicateWorkflow = useTaskStore((state) => state.duplicateWorkflow);
  const deleteWorkflow = useTaskStore((state) => state.deleteWorkflow);
  const addNode = useTaskStore((state) => state.addNode);

  const activate = (id: string) => {
    if (dirty && draft.id !== id && !window.confirm("当前流程有未保存修改，确定切换吗？")) return;
    selectWorkflow(id);
    onNavigate?.();
  };

  return (
    <aside className={cn("w-[226px] shrink-0 flex-col border-r border-line bg-ink-2/95 px-2.5 py-3", className)}>
      <div className="flex items-center justify-between px-1.5 pb-3">
        <div>
          <div className="text-sm font-semibold text-fg">任务流程</div>
          <div className="mt-0.5 text-[10px] text-fg-mute">可保存、复用和追踪</div>
        </div>
        <button
          type="button"
          onClick={() => newWorkflow()}
          title="新建流程"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-2 bg-white/[0.025] text-fg-dim transition-colors hover:border-accent/50 hover:text-accent"
        >
          <Icon name="Plus" size={15} weight="bold" />
        </button>
      </div>

      <div className="mb-1 flex items-center justify-between px-1.5 text-[10px] font-medium text-fg-mute">
        <span>我的流程</span>
        <span>{workflows.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-3">
        {!draft.id ? <FlowListItem draft={draft} active unsaved onClick={() => {}} /> : null}
        {loading ? (
          <div className="flex h-20 items-center justify-center text-fg-mute"><Icon name="CircleNotch" size={16} className="animate-spin" /></div>
        ) : workflows.length ? (
          workflows.map((workflow, index) => (
            <FlowListItem
              key={workflow.id}
              draft={workflow.id === draft.id ? draft : workflow}
              index={index}
              active={workflow.id === draft.id}
              unsaved={workflow.id === draft.id && dirty}
              onClick={() => activate(workflow.id)}
            />
          ))
        ) : draft.id ? (
          <div className="px-2 py-5 text-center text-xs text-fg-mute">还没有保存的流程</div>
        ) : null}
      </div>

      <div className="border-t border-line pt-3">
        <div className="mb-2 flex items-center justify-between px-1.5">
          <span className="text-[10px] font-medium text-fg-mute">当前流程</span>
          <div className="flex items-center gap-0.5">
            <SmallIconButton icon="Copy" label="复制流程" onClick={() => void duplicateWorkflow()} />
            <SmallIconButton
              icon="Trash"
              label="删除流程"
              onClick={() => {
                if (window.confirm(`确定删除「${draft.name || "未命名流程"}」吗？`)) void deleteWorkflow();
              }}
            />
          </div>
        </div>
        <div className="mb-2 px-1.5 text-[10px] font-medium text-fg-mute">节点库</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(NODE_META) as WorkflowNodeType[]).map((type) => {
            const uniqueExists = (type === "input" || type === "output") && draft.nodes.some((node) => node.type === type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  addNode(type);
                  onNavigate?.();
                }}
                disabled={draft.nodes.length >= MAX_WORKFLOW_STEPS || uniqueExists}
                title={uniqueExists ? `${NODE_META[type].label}仅允许一个` : `添加${NODE_META[type].label}`}
                className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-line bg-white/[0.025] px-2 text-left text-[11px] text-fg-dim transition-colors hover:border-line-2 hover:bg-white/[0.045] hover:text-fg disabled:pointer-events-none disabled:opacity-35"
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", NODE_META[type].dot)} />
                <span className="truncate">{NODE_META[type].label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function FlowListItem({
  draft,
  active,
  unsaved,
  index = 0,
  onClick,
}: {
  draft: EditableWorkflow;
  active: boolean;
  unsaved: boolean;
  index?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors",
        active ? "border-accent/25 bg-accent/[0.075]" : "border-transparent hover:bg-white/[0.035]",
      )}
    >
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md border text-[10px] font-semibold", active ? "border-accent/30 text-accent" : "border-line text-fg-mute")}>
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-fg">{draft.name || "未命名流程"}</span>
        <span className="mt-0.5 block truncate text-[9px] text-fg-mute">
          {draft.nodes.length} 步 · {draft.updatedAt ? timeAgo(draft.updatedAt) : "尚未保存"}
        </span>
      </span>
      {unsaved ? <span className="h-1.5 w-1.5 rounded-full bg-accent" title="有未保存修改" /> : null}
    </button>
  );
}

function TaskToolbar({
  draft,
  onRun,
  onOpenFlows,
  onOpenInspector,
}: {
  draft: EditableWorkflow;
  onRun: () => void;
  onOpenFlows: () => void;
  onOpenInspector: () => void;
}) {
  const view = useTaskStore((state) => state.view);
  const setView = useTaskStore((state) => state.setView);
  const dirty = useTaskStore((state) => state.dirty);
  const saving = useTaskStore((state) => state.saving);
  const saveWorkflow = useTaskStore((state) => state.saveWorkflow);
  const setDraftName = useTaskStore((state) => state.setDraftName);
  const issues = useMemo(() => validateWorkflow(draft), [draft]);
  const errors = issues.filter((issue) => issue.severity === "error");

  return (
    <header className="flex min-h-[104px] shrink-0 flex-col justify-center gap-2 border-b border-line bg-[#0d0d0f]/95 px-3 py-2 md:h-[62px] md:min-h-0 md:flex-row md:items-center md:justify-between md:gap-4 md:px-4 md:py-0">
      <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
        <input
          value={draft.name}
          onChange={(event) => setDraftName(event.target.value)}
          aria-label="流程名称"
          className="h-9 min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold text-fg transition-colors hover:border-line focus:border-accent focus:bg-panel-2 focus:outline-none md:w-[240px] md:flex-none"
        />
        <button
          type="button"
          onClick={() => {
            if (errors[0]?.nodeId) useTaskStore.getState().selectNode(errors[0].nodeId);
          }}
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10px]",
            errors.length ? "border-red-300/20 bg-red-300/[0.07] text-red-200" : "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-200",
          )}
        >
          <Icon name={errors.length ? "Warning" : "Check"} size={11} weight="bold" />
          {errors.length ? `${errors.length} 项待修复` : "检查通过"}
        </button>
      </div>
      <div className="flex w-full min-w-0 items-center gap-1.5 md:w-auto md:shrink-0 md:gap-2">
        <button
          type="button"
          aria-label="打开任务流程"
          title="任务流程"
          onClick={onOpenFlows}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-white/[0.025] text-fg-dim hover:bg-white/[0.055] hover:text-fg xl:hidden"
        >
          <Icon name="Stack" size={14} />
        </button>
        <button
          type="button"
          aria-label="打开步骤设置"
          title="步骤设置"
          onClick={onOpenInspector}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-white/[0.025] text-fg-dim hover:bg-white/[0.055] hover:text-fg xl:hidden"
        >
          <Icon name="SlidersHorizontal" size={14} />
        </button>
        <div className="flex h-9 items-center rounded-lg border border-line bg-panel p-1">
          {(["design", "runs"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setView(item);
                if (item === "runs" && window.innerWidth < 1280) onOpenInspector();
              }}
              aria-pressed={view === item}
              className={cn("h-7 rounded-md px-2 text-[10px] transition-colors sm:px-3 sm:text-[11px]", view === item ? "bg-white/[0.08] text-fg" : "text-fg-mute hover:text-fg")}
            >
              {item === "design" ? "设计" : "运行记录"}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void saveWorkflow()}
          aria-label={saving ? "保存中" : dirty ? "保存流程" : "流程已保存"}
          title={saving ? "保存中" : dirty ? "保存流程" : "流程已保存"}
          className="flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line-2 bg-white/[0.025] px-0 text-[11px] font-medium text-fg-dim transition-colors hover:bg-white/[0.055] hover:text-fg disabled:pointer-events-none disabled:opacity-35 sm:w-auto sm:px-3"
        >
          <Icon name={saving ? "CircleNotch" : "BookmarksSimple"} size={13} className={saving ? "animate-spin" : undefined} />
          <span className="hidden sm:inline">{saving ? "保存中" : dirty ? "保存" : "已保存"}</span>
        </button>
        <button
          type="button"
          disabled={errors.length > 0 || saving}
          onClick={onRun}
          className="ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-ink shadow-[0_8px_24px_rgba(230,178,119,0.16)] transition-colors hover:bg-accent-2 disabled:pointer-events-none disabled:opacity-35 sm:ml-0 sm:px-3.5"
        >
          <Icon name="Play" size={13} weight="fill" />
          <span className="sm:hidden">运行</span>
          <span className="hidden sm:inline">运行流程</span>
        </button>
      </div>
    </header>
  );
}

function TaskFlow({ draft, run }: { draft: EditableWorkflow; run: WorkflowRun | null }) {
  const selectedNodeId = useTaskStore((state) => state.selectedNodeId);
  const selectNode = useTaskStore((state) => state.selectNode);
  const duplicateNode = useTaskStore((state) => state.duplicateNode);
  const removeNode = useTaskStore((state) => state.removeNode);
  const moveNode = useTaskStore((state) => state.moveNode);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const issues = useMemo(() => validateWorkflow(draft), [draft]);
  const stepMap = useMemo(() => new Map((run?.steps || []).map((step) => [step.nodeId, step])), [run]);

  const dropOn = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    let sourceIndex = useTaskStore.getState().draft?.nodes.findIndex((node) => node.id === draggedId) ?? -1;
    const targetIndex = useTaskStore.getState().draft?.nodes.findIndex((node) => node.id === targetId) ?? -1;
    if (sourceIndex < 0 || targetIndex < 0) return;
    while (sourceIndex < targetIndex) {
      moveNode(draggedId, 1);
      sourceIndex += 1;
    }
    while (sourceIndex > targetIndex) {
      moveNode(draggedId, -1);
      sourceIndex -= 1;
    }
    setDraggedId(null);
  };

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-3 pb-20 pt-4 sm:px-5 lg:px-8 lg:pt-5"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="mx-auto w-full max-w-[690px]">
        {draft.nodes.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-line-2 bg-panel/60 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-accent"><Icon name="Stack" size={18} /></span>
            <div className="mt-3 text-sm text-fg">流程还是空的</div>
            <div className="mt-1 text-xs text-fg-mute">从左侧节点库添加第一步</div>
          </div>
        ) : (
          draft.nodes.map((node, index) => {
            const selected = node.id === selectedNodeId;
            const nodeIssues = issues.filter((issue) => issue.nodeId === node.id);
            const step = stepMap.get(node.id);
            return (
              <Fragment key={node.id}>
                <motion.article
                  layout
                  role="group"
                  tabIndex={0}
                  aria-current={selected ? "step" : undefined}
                  aria-label={`步骤 ${index + 1}：${node.name}${selected ? "，已选择" : "，按 Enter 选择"}`}
                  draggable={!run}
                  onDragStart={() => setDraggedId(node.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(event: DragEvent<HTMLElement>) => event.preventDefault()}
                  onDrop={() => dropOn(node.id)}
                  onClick={() => selectNode(node.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    selectNode(node.id);
                  }}
                  className={cn(
                    "group relative grid min-h-[82px] cursor-pointer grid-cols-[42px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border bg-panel px-2.5 py-3 shadow-[0_18px_44px_rgba(0,0,0,.24)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:px-3",
                    selected ? "border-accent/70 ring-1 ring-accent/10" : "border-line-2 hover:border-white/20",
                    node.enabled === false && "opacity-45",
                    draggedId === node.id && "opacity-30",
                    step?.status === "success" && "border-emerald-300/25",
                    (step?.status === "running" || step?.status === "failed") && "border-accent/55",
                  )}
                >
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg border text-[10px] font-bold", selected ? "border-accent bg-accent text-ink" : "border-line bg-white/[0.04] text-fg-dim")}>
                    {node.type === "input" ? "IN" : node.type === "output" ? "OUT" : String(index).padStart(2, "0")}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="cursor-grab text-fg-mute" title="拖动排序">⠿</span>
                      <span className="truncate text-[13px] font-semibold text-fg">{node.name}</span>
                      <span className="hidden shrink-0 text-[9px] text-fg-mute sm:inline">{NODE_META[node.type].kind}</span>
                    </div>
                    <div className="mt-1 truncate text-[10px] text-fg-dim">{nodeSummary(node)}</div>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                      {node.type === "input" ? (
                        node.config.fields.slice(0, 4).map((field) => (
                          <Token key={field.id} type={field.type} label={field.name} />
                        ))
                      ) : (
                        <>
                          {nodeBindings(node).slice(0, 3).map((binding) => (
                            <Token key={bindingKey(binding)} type={getBindingValueType(draft, binding) || "text"} label={bindingLabel(draft, binding)} />
                          ))}
                          <span className="text-[10px] text-fg-mute">→</span>
                          <Token type={getNodeOutputPorts(node)[0]?.type || "text"} label={NODE_META[node.type].output} output />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {run ? (
                      <span className={cn("flex h-6 items-center gap-1 rounded-full border px-2 text-[9px]", statusTone(step?.status))}>
                        {step?.status === "running" ? <Icon name="CircleNotch" size={10} className="animate-spin" /> : null}
                        {STATUS_LABEL[step?.status || "pending"]}
                      </span>
                    ) : nodeIssues.length ? (
                      <span className="flex h-6 items-center gap-1 rounded-full border border-red-300/20 bg-red-300/[0.07] px-2 text-[9px] text-red-200">
                        <Icon name="Warning" size={10} /> {nodeIssues.length}
                      </span>
                    ) : (
                      <span className="flex h-6 items-center gap-1 rounded-full border border-line bg-white/[0.03] px-2 text-[9px] text-fg-mute">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/70" /> 已配置
                      </span>
                    )}
                    {!run && selected ? (
                      <div className="grid grid-cols-2 items-center rounded-md border border-line bg-ink-2/90 p-0.5 sm:flex">
                        <SmallIconButton icon="CaretUp" label="上移" disabled={index === 0} onClick={() => moveNode(node.id, -1)} />
                        <SmallIconButton icon="CaretDown" label="下移" disabled={index === draft.nodes.length - 1} onClick={() => moveNode(node.id, 1)} />
                        <SmallIconButton icon="Copy" label="复制步骤" disabled={node.type === "input" || node.type === "output"} onClick={() => duplicateNode(node.id)} />
                        <SmallIconButton
                          icon="Trash"
                          label="删除步骤"
                          onClick={() => {
                            if (window.confirm(`删除步骤「${node.name}」？后续引用可能需要重新配置。`)) removeNode(node.id);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </motion.article>
                {index < draft.nodes.length - 1 ? (
                  <div className="group relative flex h-6 items-center justify-center">
                    <span className="h-full w-px bg-line-2" />
                    <InsertStepButton draft={draft} afterNodeId={node.id} />
                  </div>
                ) : null}
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

function Token({ type, label, output }: { type: WorkflowValueType; label: string; output?: boolean }) {
  const tone = output
    ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-200/90"
    : type === "text"
      ? "border-[#b8a2d8]/20 bg-[#b8a2d8]/[0.07] text-[#cbbce1]"
      : "border-[#81a9d8]/20 bg-[#81a9d8]/[0.07] text-[#b5cee9]";
  return <span title={label} className={cn("inline-flex h-[22px] max-w-[210px] items-center truncate rounded-[5px] border px-2 text-[9px]", tone)}>{label}</span>;
}

function TaskInspector({ draft, node, onRunTo }: { draft: EditableWorkflow; node: WorkflowNode | null; onRunTo: (nodeId: string) => void }) {
  const replaceNode = useTaskStore((state) => state.replaceNode);
  const issues = useMemo(() => validateWorkflow(draft), [draft]);
  const nodeIssues = node ? issues.filter((issue) => issue.nodeId === node.id) : [];

  if (!node) {
    return <EmptyInspector icon="SlidersHorizontal" title="选择一个步骤" detail="右侧将显示输入映射、参数和运行策略" />;
  }

  const update = (next: WorkflowNode) => replaceNode(next);
  return (
    <>
      <div className="flex h-[62px] shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="min-w-0 flex-1">
          <input
            value={node.name}
            onChange={(event) => update({ ...node, name: event.target.value } as WorkflowNode)}
            aria-label="步骤名称"
            className="h-7 w-full truncate rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold text-fg hover:border-line focus:border-accent focus:bg-panel-2 focus:outline-none"
          />
          <div className="px-1 text-[9px] text-fg-mute">{NODE_META[node.type].kind}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={node.enabled !== false}
          title={node.enabled === false ? "启用步骤" : "停用步骤"}
          onClick={() => update({ ...node, enabled: node.enabled === false ? true : false } as WorkflowNode)}
          className={cn("relative h-[20px] w-9 rounded-full transition-colors", node.enabled === false ? "bg-white/10" : "bg-accent/35")}
        >
          <span className={cn("absolute top-[3px] h-3.5 w-3.5 rounded-full transition-all", node.enabled === false ? "left-[3px] bg-fg-mute" : "left-[19px] bg-accent")} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {node.type === "input" ? <InputNodeEditor node={node} onChange={update} /> : null}
        {node.type === "reverse" ? <ReverseNodeEditor draft={draft} node={node} onChange={update} /> : null}
        {node.type === "prompt" ? <PromptNodeEditor draft={draft} node={node} onChange={update} /> : null}
        {node.type === "image" ? <ImageNodeEditor draft={draft} node={node} onChange={update} /> : null}
        {node.type === "output" ? <OutputNodeEditor draft={draft} node={node} onChange={update} /> : null}

        <InspectorSection title="运行策略" last>
          {node.enabled === false ? (
            <div className="rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 text-center text-[10px] text-fg-mute">已停用步骤不能作为运行终点</div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onRunTo(node.id)}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line-2 bg-white/[0.025] text-[11px] text-fg-dim transition-colors hover:bg-white/[0.055] hover:text-fg"
              >
                <Icon name="PlayCircle" size={14} /> 运行到此步骤
              </button>
              <p className="mt-2 text-[9px] leading-relaxed text-fg-mute">已提交的当前步骤仍会完成；系统只停止后续步骤。</p>
            </>
          )}
        </InspectorSection>

        {nodeIssues.length ? <IssueList issues={nodeIssues} /> : null}
      </div>
    </>
  );
}

function InspectorSection({ title, children, last }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <section className={cn("mb-4 pb-4", !last && "border-b border-line")}>
      <div className="mb-2.5 text-[10px] font-semibold text-fg-dim">{title}</div>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[9px] text-fg-mute">{children}</div>;
}

const CONTROL = "h-9 w-full rounded-lg border border-line bg-panel-2 px-2.5 text-[11px] text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none";
const TEXTAREA = "w-full resize-none rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[11px] leading-relaxed text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none";

function InputNodeEditor({ node, onChange }: { node: Extract<WorkflowNode, { type: "input" }>; onChange: (node: WorkflowNode) => void }) {
  const changeField = (index: number, patch: Partial<WorkflowInputField>) => {
    const fields = node.config.fields.map((field, itemIndex) => (itemIndex === index ? { ...field, ...patch } : field));
    onChange({ ...node, config: { fields } });
  };
  return (
    <InspectorSection title="运行时输入">
      <div className="space-y-2">
        {node.config.fields.map((field, index) => (
          <div key={field.id} className="rounded-lg border border-line bg-white/[0.02] p-2.5">
            <div className="flex items-center gap-2">
              <input value={field.name} onChange={(event) => changeField(index, { name: event.target.value })} className={cn(CONTROL, "min-w-0 flex-1")} aria-label="字段名称" />
              <SmallIconButton icon="Trash" label="删除字段" onClick={() => onChange({ ...node, config: { fields: node.config.fields.filter((_, i) => i !== index) } })} />
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
              <Select
                value={field.type}
                onChange={(value) => changeField(index, { type: value as "text" | "image", defaultValue: value === "text" ? field.defaultValue : undefined })}
                options={[{ value: "text", label: "文本" }, { value: "image", label: "图片" }]}
                className="w-full [&_button]:h-8 [&_button]:rounded-lg [&_button]:text-[11px]"
              />
              <label className="flex h-8 items-center gap-1.5 text-[10px] text-fg-dim">
                <input type="checkbox" checked={field.required} onChange={(event) => changeField(index, { required: event.target.checked })} className="accent-[var(--color-accent)]" /> 必填
              </label>
            </div>
            {field.type === "text" ? (
              <input value={field.defaultValue || ""} onChange={(event) => changeField(index, { defaultValue: event.target.value })} placeholder="默认值（可选）" className={cn(CONTROL, "mt-2 h-8")} />
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...node, config: { fields: [...node.config.fields, { id: `field-${crypto.randomUUID()}`, name: "新字段", type: "text", required: false, defaultValue: "" }] } })}
        className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 text-[10px] text-fg-mute hover:border-accent/40 hover:text-accent"
      >
        <Icon name="Plus" size={12} /> 添加字段
      </button>
    </InspectorSection>
  );
}

function ReverseNodeEditor({ draft, node, onChange }: { draft: EditableWorkflow; node: Extract<WorkflowNode, { type: "reverse" }>; onChange: (node: WorkflowNode) => void }) {
  return (
    <>
      <InspectorSection title="输入映射">
        <FieldLabel>反推图片</FieldLabel>
        <BindingPicker draft={draft} nodeId={node.id} accepted={["image"]} value={node.config.image} onChange={(image) => onChange({ ...node, config: { ...node.config, image } })} />
      </InspectorSection>
      <InspectorSection title="反推设置">
        <div className="rounded-lg border border-line bg-white/[0.02] p-2.5">
          <div className="flex items-center gap-2 text-[10px] text-fg"><Icon name="FileText" size={13} className="text-accent" />结构化反推</div>
          <p className="mt-1.5 text-[9px] leading-relaxed text-fg-mute">视觉模型按当前可用配置自动选择，输出可组合的提示词并保留原始结构化内容。</p>
        </div>
      </InspectorSection>
    </>
  );
}

function PromptNodeEditor({ draft, node, onChange }: { draft: EditableWorkflow; node: Extract<WorkflowNode, { type: "prompt" }>; onChange: (node: WorkflowNode) => void }) {
  const firstText = getAvailableBindings(draft, node.id, ["text"])[0]?.binding;
  return (
    <>
      <InspectorSection title="文本变量">
        <div className="space-y-2">
          {node.config.bindings.map((item, index) => (
            <div key={`${item.key}-${index}`} className="rounded-lg border border-line bg-white/[0.02] p-2">
              <div className="flex items-center gap-1.5">
                <input
                  value={item.key}
                  onChange={(event) => onChange({ ...node, config: { ...node.config, bindings: node.config.bindings.map((binding, i) => i === index ? { ...binding, key: event.target.value.replace(/[^A-Za-z0-9_.-]/g, "") } : binding) } })}
                  placeholder="变量名"
                  className={cn(CONTROL, "h-8 min-w-0 flex-1 font-mono text-[10px]")}
                />
                <SmallIconButton icon="Trash" label="删除变量" onClick={() => onChange({ ...node, config: { ...node.config, bindings: node.config.bindings.filter((_, i) => i !== index) } })} />
              </div>
              <BindingPicker
                draft={draft}
                nodeId={node.id}
                accepted={["text"]}
                value={item.source}
                onChange={(source) => source && onChange({ ...node, config: { ...node.config, bindings: node.config.bindings.map((binding, i) => i === index ? { ...binding, source } : binding) } })}
                className="mt-1.5"
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={!firstText}
          onClick={() => {
            if (!firstText) return;
            let n = node.config.bindings.length + 1;
            let key = `text${n}`;
            while (node.config.bindings.some((item) => item.key === key)) key = `text${++n}`;
            onChange({ ...node, config: { ...node.config, bindings: [...node.config.bindings, { key, source: firstText }] } });
          }}
          className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 text-[10px] text-fg-mute hover:border-accent/40 hover:text-accent disabled:pointer-events-none disabled:opacity-35"
        >
          <Icon name="Plus" size={12} /> 添加变量
        </button>
      </InspectorSection>
      <InspectorSection title="组合模板">
        <textarea
          value={node.config.template}
          onChange={(event) => onChange({ ...node, config: { ...node.config, template: event.target.value } })}
          rows={8}
          spellCheck={false}
          className={cn(TEXTAREA, "border-accent/20 bg-[#111114] font-mono")}
          placeholder="使用 {{变量名}} 插入前序文本"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {node.config.bindings.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange({ ...node, config: { ...node.config, template: `${node.config.template}${node.config.template ? "\n" : ""}{{${item.key}}}` } })}
              className="h-6 rounded-md border border-[#b8a2d8]/25 bg-[#b8a2d8]/[0.08] px-2 font-mono text-[9px] text-[#cbbce1]"
            >
              {`{{${item.key}}}`}
            </button>
          ))}
        </div>
      </InspectorSection>
    </>
  );
}

function ImageNodeEditor({ draft, node, onChange }: { draft: EditableWorkflow; node: Extract<WorkflowNode, { type: "image" }>; onChange: (node: WorkflowNode) => void }) {
  const resolutions = resolutionsFor(node.config.model);
  const refs = node.config.referenceImages || [];
  return (
    <>
      <InspectorSection title="输入映射">
        <FieldLabel>生成提示词</FieldLabel>
        <BindingPicker draft={draft} nodeId={node.id} accepted={["text"]} value={node.config.prompt} onChange={(prompt) => onChange({ ...node, config: { ...node.config, prompt } })} />
        <div className="mt-3"><FieldLabel>底图（可选）</FieldLabel></div>
        <BindingPicker draft={draft} nodeId={node.id} accepted={["image"]} value={node.config.baseImage || null} allowEmpty onChange={(baseImage) => onChange({ ...node, config: { ...node.config, baseImage } })} />
        <div className="mt-3 flex items-center justify-between"><FieldLabel>参考图</FieldLabel><span className="text-[9px] text-fg-mute">{refs.length}</span></div>
        <div className="space-y-1.5">
          {refs.map((binding, index) => (
            <div key={`${bindingKey(binding)}-${index}`} className="flex items-center gap-1.5">
              <BindingPicker
                draft={draft}
                nodeId={node.id}
                accepted={["image"]}
                value={binding}
                onChange={(value) => value && onChange({ ...node, config: { ...node.config, referenceImages: refs.map((item, i) => i === index ? value : item) } })}
                className="min-w-0 flex-1"
              />
              <SmallIconButton icon="X" label="移除参考图" onClick={() => onChange({ ...node, config: { ...node.config, referenceImages: refs.filter((_, i) => i !== index) } })} />
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={refs.length >= MAX_REF_IMAGES || !getAvailableBindings(draft, node.id, ["image"]).length}
          onClick={() => {
            const binding = getAvailableBindings(draft, node.id, ["image"])[0]?.binding;
            if (binding) onChange({ ...node, config: { ...node.config, referenceImages: [...refs, binding] } });
          }}
          className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 text-[10px] text-fg-mute hover:border-accent/40 hover:text-accent disabled:pointer-events-none disabled:opacity-35"
        >
          <Icon name="Plus" size={12} /> 添加参考图
        </button>
      </InspectorSection>
      <InspectorSection title="生成参数">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <FieldLabel>模型</FieldLabel>
            <Select
              value={node.config.model}
              onChange={(value) => {
                const model = value as ModelName;
                const allowed = resolutionsFor(model);
                const aspectRatio = model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(node.config.aspectRatio) ? "auto" : node.config.aspectRatio;
                onChange({ ...node, config: { ...node.config, model, aspectRatio, resolution: allowed.includes(node.config.resolution) ? node.config.resolution : allowed[0] } });
              }}
              options={MODELS.map((model) => ({ value: model.name, label: model.name, hint: model.blurb, icon: <ModelIcon model={model.name} size={14} /> }))}
              className="w-full [&_button]:h-9 [&_button]:rounded-lg [&_button]:text-[11px]"
            />
          </div>
          <div>
            <FieldLabel>分辨率</FieldLabel>
            <Select value={node.config.resolution} onChange={(value) => onChange({ ...node, config: { ...node.config, resolution: value as Resolution } })} options={resolutions.map((value) => ({ value, label: value }))} className="w-full [&_button]:h-9 [&_button]:rounded-lg [&_button]:text-[11px]" />
          </div>
          <div>
            <FieldLabel>比例</FieldLabel>
            <Select value={node.config.aspectRatio} onChange={(aspectRatio) => onChange({ ...node, config: { ...node.config, aspectRatio } })} options={ASPECT_RATIOS.map((value) => ({ value, label: value === "auto" ? "自动" : value, disabled: node.config.model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(value) }))} className="w-full [&_button]:h-9 [&_button]:rounded-lg [&_button]:text-[11px]" />
          </div>
          <div>
            <FieldLabel>计费</FieldLabel>
            <Select value={node.config.billing} onChange={(value) => onChange({ ...node, config: { ...node.config, billing: value as Billing } })} options={BILLINGS.map((value) => ({ value, label: value }))} className="w-full [&_button]:h-9 [&_button]:rounded-lg [&_button]:text-[11px]" />
          </div>
          <div>
            <FieldLabel>张数</FieldLabel>
            <Select value={String(node.config.count)} onChange={(value) => onChange({ ...node, config: { ...node.config, count: Number(value) } })} options={[1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value} 张` }))} className="w-full [&_button]:h-9 [&_button]:rounded-lg [&_button]:text-[11px]" />
          </div>
          {node.config.model === "GPT Image 2" ? (
            <div className="col-span-2">
              <FieldLabel>质量</FieldLabel>
              <Select value={node.config.quality || "auto"} onChange={(value) => onChange({ ...node, config: { ...node.config, quality: value as Quality } })} options={["auto", "high", "medium", "low"].map((value) => ({ value, label: value }))} className="w-full [&_button]:h-9 [&_button]:rounded-lg [&_button]:text-[11px]" />
            </div>
          ) : null}
          <div className="col-span-2">
            <FieldLabel>最长等待（分钟）</FieldLabel>
            <input type="number" min={1} max={30} value={Math.round((node.config.maxPollMs || 15 * 60_000) / 60_000)} onChange={(event) => onChange({ ...node, config: { ...node.config, maxPollMs: Math.max(1, Math.min(30, Number(event.target.value) || 15)) * 60_000 } })} className={CONTROL} />
          </div>
        </div>
      </InspectorSection>
    </>
  );
}

function OutputNodeEditor({ draft, node, onChange }: { draft: EditableWorkflow; node: Extract<WorkflowNode, { type: "output" }>; onChange: (node: WorkflowNode) => void }) {
  const sourceType = node.config.images ? getBindingValueType(draft, node.config.images) : null;
  const sourceNode = node.config.images ? draft.nodes.find((item) => item.id === node.config.images?.sourceNodeId) : undefined;
  const sourceImageCount = sourceNode?.type === "image" ? Math.max(1, sourceNode.config.count) : 4;
  return (
    <InspectorSection title="最终结果">
      <FieldLabel>输出来源</FieldLabel>
      <BindingPicker
        draft={draft}
        nodeId={node.id}
        accepted={["images"]}
        value={node.config.images}
        onChange={(images) => {
          const valueType = images ? getBindingValueType(draft, images) : null;
          const nextSource = images ? draft.nodes.find((item) => item.id === images.sourceNodeId) : undefined;
          const nextMax = nextSource?.type === "image" ? Math.max(1, nextSource.config.count) : 4;
          onChange({
            ...node,
            config: {
              ...node.config,
              images,
              selectIndex: valueType === "images" && node.config.selectIndex != null
                ? Math.min(node.config.selectIndex, nextMax - 1)
                : undefined,
            },
          });
        }}
      />
      {sourceType === "images" ? (
        <div className="mt-3">
          <FieldLabel>只取某一张（1-{sourceImageCount}，留空则输出全部）</FieldLabel>
          <input
            type="number"
            min={1}
            max={sourceImageCount}
            value={node.config.selectIndex == null ? "" : node.config.selectIndex + 1}
            placeholder="全部"
            onChange={(event) => onChange({
              ...node,
              config: {
                ...node.config,
                selectIndex: event.target.value
                  ? Math.min(sourceImageCount - 1, Math.max(0, Number(event.target.value) - 1))
                  : undefined,
              },
            })}
            className={CONTROL}
          />
        </div>
      ) : null}
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-white/[0.02] p-2.5 text-[10px] text-fg-dim">
        <Icon name="Check" size={12} className="mt-0.5 shrink-0 text-emerald-300" />
        <span><span className="block text-fg">结果自动进入历史生成</span><span className="mt-0.5 block leading-relaxed text-fg-mute">同时保留流程、运行和步骤来源，便于回溯。</span></span>
      </div>
    </InspectorSection>
  );
}

function BindingPicker({
  draft,
  nodeId,
  accepted,
  value,
  onChange,
  allowEmpty,
  className,
}: {
  draft: EditableWorkflow;
  nodeId: string;
  accepted: WorkflowValueType[];
  value: WorkflowBinding | null | undefined;
  onChange: (value: WorkflowBinding | null) => void;
  allowEmpty?: boolean;
  className?: string;
}) {
  const choices = useMemo(() => {
    const result: { key: string; label: string; binding: WorkflowBinding }[] = [];
    for (const item of getAvailableBindings(draft, nodeId, accepted)) {
      if (item.requiresIndex) {
        const source = draft.nodes.find((node) => node.id === item.nodeId);
        const count = source?.type === "image" ? source.config.count : 4;
        for (let index = 0; index < count; index += 1) {
          const binding = { ...item.binding, index };
          result.push({ key: bindingKey(binding), label: `${item.nodeName} · ${item.label} #${index + 1}`, binding });
        }
      } else {
        result.push({ key: bindingKey(item.binding), label: `${item.nodeName} · ${item.label}`, binding: item.binding });
      }
    }
    return result;
  }, [draft, nodeId, accepted.join("|")]);
  const map = new Map(choices.map((item) => [item.key, item.binding]));
  const current = value ? bindingKey(value) : "";
  const options = [
    ...(allowEmpty || !value ? [{ value: "", label: allowEmpty ? "不使用" : "选择前序输出" }] : []),
    ...choices.map((item) => ({ value: item.key, label: item.label })),
  ];
  return (
    <Select
      value={current}
      onChange={(key) => onChange(key ? map.get(key) || null : null)}
      options={options}
      className={cn("w-full [&_button]:h-9 [&_button]:rounded-lg [&_button]:text-[11px]", className)}
    />
  );
}

function IssueList({ issues }: { issues: WorkflowValidationIssue[] }) {
  return (
    <div className="rounded-lg border border-red-300/15 bg-red-300/[0.045] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-red-200"><Icon name="Warning" size={12} /> 配置问题</div>
      <div className="space-y-1">
        {issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="text-[9px] leading-relaxed text-red-100/70">{issue.message}</div>)}
      </div>
    </div>
  );
}

function RunInspector({ draft }: { draft: EditableWorkflow }) {
  const runs = useTaskStore((state) => state.runs);
  const runsLoading = useTaskStore((state) => state.runsLoading);
  const run = useTaskStore((state) => state.currentRun);
  const openRun = useTaskStore((state) => state.openRun);
  const retryRun = useTaskStore((state) => state.retryRun);
  const stopRun = useTaskStore((state) => state.stopRun);
  const results = runResults(run);
  const succeeded = run?.steps.filter((step) => step.status === "success").length || 0;
  const failedStep = run?.steps.find((step) => step.status === "failed");

  return (
    <>
      <div className="flex h-[62px] shrink-0 items-center justify-between border-b border-line px-4">
        <div><div className="text-sm font-semibold text-fg">运行记录</div><div className="mt-0.5 text-[9px] text-fg-mute">{draft.name}</div></div>
        {runsLoading ? <Icon name="CircleNotch" size={14} className="animate-spin text-fg-mute" /> : <span className="text-[10px] text-fg-mute">{runs.length} 次</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {runs.length ? (
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
            {runs.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openRun(item.id)}
                className={cn("shrink-0 rounded-lg border px-2.5 py-2 text-left", run?.id === item.id ? "border-accent/40 bg-accent/[0.08]" : "border-line bg-white/[0.02] hover:border-line-2")}
              >
                <div className="flex items-center gap-1.5 text-[9px] text-fg"><span className={cn("h-1.5 w-1.5 rounded-full", item.status === "success" ? "bg-emerald-300" : item.status === "failed" ? "bg-red-300" : item.status === "running" ? "bg-accent" : "bg-fg-mute")} />{timeAgo(item.createdAt)}</div>
                <div className="mt-1 text-[8px] text-fg-mute">{STATUS_LABEL[item.status]}</div>
              </button>
            ))}
          </div>
        ) : null}

        {!run ? (
          <EmptyInspector icon="ClockCountdown" title="还没有运行记录" detail="完成输入后运行流程，步骤状态和结果会显示在这里" compact />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-1.5">
              <Metric value={String(results.length)} label="最终图片" />
              <Metric value={durationText(run.startedAt, run.finishedAt)} label="总耗时" />
              <Metric value={`${succeeded}/${run.steps.length}`} label="成功步骤" />
            </div>
            <InspectorSection title={`本次运行 · ${run.id.slice(-8)}`}>
              <div>
                {run.steps.map((step, index) => <RunStep key={step.nodeId} step={step} index={index} onRetry={() => void retryRun(step.nodeId)} />)}
              </div>
              {run.status === "running" || run.status === "queued" ? (
                <button type="button" onClick={() => void stopRun()} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-line-2 text-[10px] text-fg-dim hover:bg-white/[0.05] hover:text-fg"><Icon name="StopCircle" size={13} />停止后续步骤</button>
              ) : failedStep ? (
                <button type="button" onClick={() => void retryRun(failedStep.nodeId)} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/[0.07] text-[10px] text-accent hover:bg-accent/[0.11]"><Icon name="ArrowClockwise" size={13} />从失败步骤继续</button>
              ) : null}
            </InspectorSection>
            <InspectorSection title="最终结果" last>
              {results.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {results.map((url, index) => <ResultTile key={`${url}-${index}`} url={url} index={index} />)}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-line-2 px-4 py-8 text-center text-[10px] text-fg-mute">流程完成后在这里显示结果</div>
              )}
            </InspectorSection>
          </>
        )}
      </div>
    </>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-lg border border-line bg-panel-2 p-2.5"><div className="truncate text-sm font-semibold text-fg">{value}</div><div className="mt-1 text-[8px] text-fg-mute">{label}</div></div>;
}

function RunStep({ step, index, onRetry }: { step: WorkflowStepRun; index: number; onRetry: () => void }) {
  const canRetry = step.status === "failed";
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] gap-2 border-b border-line py-2.5 last:border-0">
      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[8px]", statusTone(step.status))}>
        {step.status === "running" ? <Icon name="CircleNotch" size={10} className="animate-spin" /> : step.status === "success" ? <Icon name="Check" size={10} /> : index + 1}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[10px] font-medium text-fg">{step.name}</div>
        <div className="mt-0.5 truncate text-[8px] text-fg-mute">{step.error || `${STATUS_LABEL[step.status]} · 尝试 ${step.attempts || 0} 次`}</div>
        {step.status === "running" && step.progress != null ? (
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(3, Math.round(step.progress * 100))}%` }} /></div>
        ) : null}
      </div>
      {canRetry ? <SmallIconButton icon="ArrowClockwise" label="从此步骤重试" onClick={onRetry} /> : <span className="text-[8px] text-fg-mute">{durationText(step.startedAt, step.finishedAt)}</span>}
    </div>
  );
}

function runResults(run: WorkflowRun | null): string[] {
  if (!run) return [];
  const out = new Set<string>();
  for (const value of Object.values(run.outputs)) {
    if (value.type === "image") out.add(value.value);
    if (value.type === "images") value.value.forEach((url) => out.add(url));
  }
  if (!out.size) {
    for (const step of run.steps) {
      if (step.nodeType !== "image") continue;
      for (const value of Object.values(step.outputs)) {
        if (value.type === "image") out.add(value.value);
        if (value.type === "images") value.value.forEach((url) => out.add(url));
      }
    }
  }
  return [...out];
}

function ResultTile({ url, index }: { url: string; index: number }) {
  const showToast = useStudio((state) => state.showToast);
  const setAsCanvas = () => {
    const image = new Image();
    image.onload = () => {
      const studio = useStudio.getState();
      studio.setImage({ src: url, width: image.naturalWidth, height: image.naturalHeight });
      studio.setWorkMode("single");
      studio.showToast("success", "已设为单图画布");
    };
    image.onerror = () => showToast("error", "读取结果图失败");
    image.src = url;
  };
  return (
    <div className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-line-2 bg-ink-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`任务结果 ${index + 1}`} className="h-full w-full object-cover" />
      <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-end gap-1 opacity-100 transition-all [@media(hover:hover)]:translate-y-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:translate-y-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100">
        <button type="button" title="设为画布" aria-label={`将任务结果 ${index + 1} 设为画布`} onClick={setAsCanvas} className="flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-fg backdrop-blur-sm"><Icon name="ImageSquare" size={12} /></button>
        <button type="button" title="下载" aria-label={`下载任务结果 ${index + 1}`} onClick={() => downloadUrl(url, `TVision任务结果-${index + 1}.png`)} className="flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-fg backdrop-blur-sm"><Icon name="DownloadSimple" size={12} /></button>
      </div>
    </div>
  );
}

function ActiveRunBar({ run, onOpenInspector }: { run: WorkflowRun | null; onOpenInspector: () => void }) {
  const setView = useTaskStore((state) => state.setView);
  const stopRun = useTaskStore((state) => state.stopRun);
  if (!run || (run.status !== "queued" && run.status !== "running")) return null;
  const currentIndex = Math.max(0, run.steps.findIndex((step) => step.nodeId === run.currentNodeId));
  const current = run.steps[currentIndex];
  const completed = run.steps.filter((step) => step.status === "success" || step.status === "skipped").length;
  const progress = run.steps.length ? ((completed + (current?.progress || 0)) / run.steps.length) * 100 : 0;
  return (
    <div className="absolute bottom-3 left-3 right-3 z-30 flex h-12 items-center gap-2 rounded-lg border border-line-2 bg-panel/95 px-2.5 shadow-[0_16px_40px_rgba(0,0,0,.38)] backdrop-blur-xl sm:h-11 sm:gap-2.5 sm:px-3 xl:left-[238px] xl:right-[354px]">
      <Icon name="CircleNotch" size={14} className="shrink-0 animate-spin text-accent" />
      <div className="min-w-0 flex-1"><div className="truncate text-[10px] font-medium text-fg">{run.workflowName} · {current?.name || "准备运行"}</div><div className="mt-0.5 truncate text-[8px] text-fg-mute">步骤 {Math.min(currentIndex + 1, run.steps.length)}/{run.steps.length} · {run.stopRequested ? "完成当前步骤后停止" : "流程执行中"}</div></div>
      <div className="hidden h-0.5 w-24 overflow-hidden rounded-full bg-white/10 sm:block"><span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(3, progress)}%` }} /></div>
      <button type="button" aria-label="停止后续步骤" title="停止后续步骤" onClick={() => void stopRun()} disabled={run.stopRequested} className="flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line px-0 text-[9px] text-fg-dim hover:bg-white/[0.05] disabled:opacity-35 sm:h-7 sm:w-auto sm:px-2"><Icon name="StopCircle" size={12} /><span className="hidden sm:inline">停止后续步骤</span></button>
      <button type="button" onClick={() => { setView("runs"); if (window.innerWidth < 1280) onOpenInspector(); }} className="h-8 shrink-0 rounded-md border border-line px-2 text-[9px] text-fg-dim hover:bg-white/[0.05] sm:h-7">查看</button>
    </div>
  );
}

function RunInputDialog({ draft, stopAfterNodeId, onClearTarget }: { draft: EditableWorkflow; stopAfterNodeId?: string; onClearTarget: () => void }) {
  const open = useTaskStore((state) => state.runDialogOpen);
  const close = useTaskStore((state) => state.closeRunDialog);
  const values = useTaskStore((state) => state.runInputs);
  const setValue = useTaskStore((state) => state.setRunInput);
  const startRun = useTaskStore((state) => state.startRun);
  const [starting, setStarting] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const readSessionRef = useRef(0);
  const readSequenceRef = useRef(0);
  const fieldReadTokensRef = useRef(new Map<string, number>());
  const inputNodes = draft.nodes.filter((node): node is Extract<WorkflowNode, { type: "input" }> => node.type === "input" && node.enabled !== false);
  const fields = inputNodes.flatMap((node) => node.config.fields);
  const missing = fields.filter((field) => field.required && !(values[field.id] || field.defaultValue || "").trim());

  useEffect(() => {
    if (!open) return;
    readSessionRef.current += 1;
    fieldReadTokensRef.current.clear();
    setReading(null);
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>('[data-run-initial-focus="true"]');
      (preferred || focusableElements(dialogRef.current)[0] || dialogRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      readSessionRef.current += 1;
      fieldReadTokensRef.current.clear();
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [open]);

  const dismiss = () => {
    if (starting) return;
    readSessionRef.current += 1;
    fieldReadTokensRef.current.clear();
    setReading(null);
    close();
    onClearTarget();
  };

  async function readImage(field: WorkflowInputField, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return useStudio.getState().showToast("error", "请选择图片文件");
    const sessionToken = readSessionRef.current;
    const requestToken = ++readSequenceRef.current;
    const storeAtStart = useTaskStore.getState();
    const ownerKey = storeAtStart.ownerKey;
    const draftKey = storeAtStart.draftKey;
    const workflowId = storeAtStart.draft?.id;
    fieldReadTokensRef.current.set(field.id, requestToken);
    setReading(field.id);
    try {
      const { dataUrl } = await fileToDownscaledDataURL(file, 1800, 0.94);
      const current = useTaskStore.getState();
      if (
        readSessionRef.current !== sessionToken ||
        fieldReadTokensRef.current.get(field.id) !== requestToken ||
        !current.runDialogOpen ||
        current.ownerKey !== ownerKey ||
        current.draftKey !== draftKey ||
        current.draft?.id !== workflowId
      ) return;
      setValue(field.id, dataUrl);
    } catch {
      if (readSessionRef.current === sessionToken && fieldReadTokensRef.current.get(field.id) === requestToken) {
        useStudio.getState().showToast("error", "读取图片失败");
      }
    } finally {
      if (readSessionRef.current === sessionToken && fieldReadTokensRef.current.get(field.id) === requestToken) {
        fieldReadTokensRef.current.delete(field.id);
        setReading((current) => current === field.id ? null : current);
      }
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                dismiss();
                return;
              }
              trapTabKey(event, dialogRef.current);
            }}
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[620px] flex-col overflow-hidden rounded-lg border border-line-2 bg-[#17171a] shadow-[0_28px_90px_rgba(0,0,0,.6)] sm:max-h-[82vh]"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
              <div><div id={titleId} className="text-sm font-semibold text-fg">运行任务流程</div><div id={descriptionId} className="mt-1 text-[10px] leading-relaxed text-fg-mute">{stopAfterNodeId ? `运行至「${draft.nodes.find((node) => node.id === stopAfterNodeId)?.name || "所选步骤"}」后停止` : "填写本次运行需要的输入，流程定义不会被改动"}</div></div>
              <SmallIconButton icon="X" label="关闭" onClick={dismiss} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {fields.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fields.map((field, index) => (
                    <label key={field.id} className={cn("flex min-w-0 flex-col", field.type === "text" && "sm:col-span-2")}>
                      <span className="mb-1.5 flex items-center gap-1.5 text-[10px] text-fg-dim">{field.name}{field.required ? <span className="text-accent">*</span> : null}</span>
                      {field.type === "text" ? (
                        <textarea data-run-initial-focus={index === 0 ? "true" : undefined} aria-required={field.required} value={values[field.id] ?? field.defaultValue ?? ""} onChange={(event) => setValue(field.id, event.target.value)} rows={3} className={TEXTAREA} placeholder="填写文本" />
                      ) : (
                        <span className="relative flex aspect-[16/10] cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-2 bg-ink-2 text-center transition-colors hover:border-accent/40 focus-within:border-accent">
                          <input data-run-initial-focus={index === 0 ? "true" : undefined} type="file" accept="image/*" aria-label={field.name} aria-required={field.required} className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => { void readImage(field, event.target.files?.[0]); event.target.value = ""; }} />
                          {values[field.id] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={values[field.id]} alt={field.name} className="h-full w-full object-cover" />
                          ) : reading === field.id ? (
                            <Icon name="CircleNotch" size={18} className="animate-spin text-accent" />
                          ) : (
                            <span className="flex flex-col items-center gap-1.5 text-[9px] text-fg-mute"><Icon name="UploadSimple" size={16} />选择图片</span>
                          )}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-line-2 px-5 py-10 text-center text-xs text-fg-mute">这个流程没有运行时输入，可直接启动</div>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3.5">
              <div className="min-w-0 text-[9px] leading-relaxed text-fg-mute">{missing.length ? `还需填写：${missing.map((field) => field.name).join("、")}` : "输入检查通过"}</div>
              <div className="flex shrink-0 justify-end gap-2">
                <button type="button" onClick={dismiss} className="h-9 rounded-lg border border-line-2 px-3 text-[10px] text-fg-dim hover:bg-white/[0.05]">取消</button>
                <button
                  type="button"
                  data-run-initial-focus={!fields.length ? "true" : undefined}
                  disabled={missing.length > 0 || starting || !!reading}
                  onClick={async () => {
                    setStarting(true);
                    const ok = await startRun(stopAfterNodeId);
                    setStarting(false);
                    if (ok) onClearTarget();
                  }}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[10px] font-semibold text-ink hover:bg-accent-2 disabled:pointer-events-none disabled:opacity-35"
                >
                  <Icon name={starting ? "CircleNotch" : "Play"} size={12} className={starting ? "animate-spin" : undefined} weight={starting ? "regular" : "fill"} />
                  {starting ? "启动中" : "开始运行"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function EmptyInspector({ icon, title, detail, compact }: { icon: string; title: string; detail: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center px-8 text-center", compact && "min-h-[260px]") }>
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white/[0.035] text-fg-mute"><Icon name={icon} size={17} /></span>
      <div className="mt-3 text-xs text-fg-dim">{title}</div>
      <div className="mt-1 max-w-[220px] text-[9px] leading-relaxed text-fg-mute">{detail}</div>
    </div>
  );
}
