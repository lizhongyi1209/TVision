"use client";

// "Agent" workspace (PLAN-AGENT phase 1): multimodal chat only — no tool
// calls / agent loop / skills yet (later phases). Three-pane layout: session
// rail (left) + message stream + composer (right), all inside one flex row
// that fills Studio.tsx's <main>, matching BatchWorkshop's "own its own
// height inside the overflow-hidden shell" contract.

import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useAgentChat } from "@/lib/agentChatStore";
import { AGENT_MODELS, REASONING_LEVELS, REASONING_LEVEL_LABELS, type ReasoningLevel } from "@/lib/agentModels";
import type { AgentMessage } from "@/lib/agentTypes";
import { useStudio } from "@/lib/store";
import { cn, downscaleImageSrc, fileToDataURL } from "@/lib/utils";
import { Icon } from "./icons";
import { Select } from "./ui";

export function AgentPanel() {
  const loadChats = useAgentChat((s) => s.loadChats);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <AgentSidebar />
      <AgentChatArea />
    </div>
  );
}

// ── Left rail: session list ─────────────────────────────────────────────────

function AgentSidebar() {
  const chats = useAgentChat((s) => s.chats);
  const currentChatId = useAgentChat((s) => s.currentChatId);
  const newChat = useAgentChat((s) => s.newChat);
  const openChat = useAgentChat((s) => s.openChat);
  const deleteChat = useAgentChat((s) => s.deleteChat);
  const streaming = useAgentChat((s) => s.streaming);

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-line">
      <div className="p-3">
        <button
          type="button"
          onClick={() => !streaming && newChat()}
          disabled={streaming}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-control border border-line text-sm text-accent transition-colors hover:border-accent hover:bg-accent/5 disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="Plus" size={15} weight="bold" />
          新会话
        </button>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {chats.length === 0 ? (
          <div className="px-2.5 py-4 text-center text-xs text-fg-mute">还没有会话</div>
        ) : (
          chats.map((c) => {
            const active = c.id === currentChatId;
            return (
              <div
                key={c.id}
                className={cn(
                  "group relative flex items-center rounded-control border-l-2 pl-2.5 pr-1.5 py-2 transition-colors",
                  active ? "border-accent bg-white/[0.05]" : "border-transparent hover:bg-white/[0.03]",
                )}
              >
                <button
                  type="button"
                  onClick={() => openChat(c.id)}
                  className={cn("min-w-0 flex-1 truncate text-left text-sm", active ? "text-fg" : "text-fg-dim")}
                  title={c.title}
                >
                  {c.title || "新会话"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteChat(c.id);
                  }}
                  aria-label="删除会话"
                  className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-mute opacity-0 transition-opacity hover:bg-white/10 hover:text-red-300 group-hover:opacity-100"
                >
                  <Icon name="X" size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

// ── Right pane: model bar + message stream + composer ───────────────────────

function AgentChatArea() {
  const model = useAgentChat((s) => s.model);
  const setModel = useAgentChat((s) => s.setModel);
  const effort = useAgentChat((s) => s.effort);
  const setEffort = useAgentChat((s) => s.setEffort);
  const streaming = useAgentChat((s) => s.streaming);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line px-4">
        <Select
          value={effort}
          onChange={(v) => setEffort(v as ReasoningLevel)}
          disabled={streaming}
          options={REASONING_LEVELS.map((lv) => ({ value: lv, label: REASONING_LEVEL_LABELS[lv] }))}
          className="w-[112px]"
        />
        <Select
          value={model}
          onChange={setModel}
          disabled={streaming}
          options={AGENT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
          className="w-[200px]"
        />
      </div>
      <AgentMessages />
      <AgentComposer />
    </div>
  );
}

function AgentMessages() {
  const messages = useAgentChat((s) => s.messages);
  const streaming = useAgentChat((s) => s.streaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
    setShowJump(false);
  }, []);

  // Follow new content while autoScroll is on (user hasn't scrolled up).
  useEffect(() => {
    if (!autoScroll) {
      setShowJump(true);
      return;
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAutoScroll(atBottom);
    if (atBottom) setShowJump(false);
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-fg-mute">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-accent">
              <Icon name="Sparkle" size={22} />
            </span>
            <p className="text-sm">有什么可以帮你？可以发图片让我分析，或直接提问</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-5">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} streaming={streaming} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showJump ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={scrollToBottom}
            className="glass absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs text-fg-dim hover:text-fg"
          >
            ↓ 回到底部
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MessageRow({ message, streaming }: { message: AgentMessage; streaming: boolean }) {
  const isUser = message.role === "user";
  const isLast = useAgentChat((s) => s.messages[s.messages.length - 1]?.id === message.id);
  const hasReasoning = !!message.reasoning;
  const hasContent = !!message.content;
  const isActive = !isUser && streaming && isLast && !message.error;
  const showCursor = isActive && hasContent;
  const isPending = isActive && !hasContent && !hasReasoning;

  if (message.error) {
    return (
      <div className="flex items-start gap-2 text-sm text-red-400/80">
        <Icon name="Warning" size={15} className="mt-0.5 shrink-0" />
        <span>⚠ {message.error}</span>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-2">
        {message.images?.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {message.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="h-24 w-24 rounded-control border border-line object-cover" />
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="glass max-w-[85%] rounded-panel px-4 py-2.5 text-sm leading-relaxed text-fg">
            {message.content}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-accent">
        <Icon name="Sparkle" size={13} />
      </span>
      <div className="min-w-0 flex-1">
        {isPending ? (
          <div className="flex h-6 items-center gap-2 text-sm text-accent/90">
            <Icon name="CircleNotch" size={14} className="animate-spin" />
            <span>正在思考…</span>
          </div>
        ) : null}
        {hasReasoning ? <ReasoningBlock text={message.reasoning!} collapseWhen={hasContent} /> : null}
        {hasContent ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
            {message.content}
            {showCursor ? <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Thinking transcript for one assistant turn. Starts expanded so the reader
// can watch it stream in; the instant the real answer starts arriving
// (collapseWhen flips true) it folds itself down to one clickable line —
// after that the user drives open/closed state directly.
function ReasoningBlock({ text, collapseWhen }: { text: string; collapseWhen: boolean }) {
  const [open, setOpen] = useState(true);
  const autoCollapsed = useRef(false);

  useEffect(() => {
    if (collapseWhen && !autoCollapsed.current) {
      autoCollapsed.current = true;
      setOpen(false);
    }
  }, [collapseWhen]);

  return (
    <div className={cn("mb-2", open && "rounded-control border border-line/60 bg-white/[0.02]")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1.5 text-xs text-fg-mute transition-colors hover:text-fg-dim",
          open ? "px-2.5 py-1.5" : "py-0.5",
        )}
      >
        <Icon name={open ? "CaretDown" : "CaretRight"} size={11} className="shrink-0" />
        <span>✦ 思考过程</span>
      </button>
      {open ? (
        <div className="whitespace-pre-wrap px-2.5 pb-2 text-xs leading-relaxed text-fg-mute/80">{text}</div>
      ) : null}
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

const MAX_TEXTAREA_ROWS = 6;

function AgentComposer() {
  const send = useAgentChat((s) => s.send);
  const stop = useAgentChat((s) => s.stop);
  const streaming = useAgentChat((s) => s.streaming);
  const showToast = useStudio((s) => s.showToast);

  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 20;
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS + 16;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [text]);

  const addImageFiles = useCallback(
    async (files: File[]) => {
      const imgFiles = files.filter((f) => f.type.startsWith("image/"));
      if (files.length && !imgFiles.length) {
        showToast("info", "暂只支持图片，文件分析后续版本支持");
        return;
      }
      if (!imgFiles.length) return;
      setBusy(true);
      try {
        const downscaled = await Promise.all(
          imgFiles.map(async (f) => {
            const dataUrl = await fileToDataURL(f);
            return (await downscaleImageSrc(dataUrl, 1568, 0.92)).dataUrl;
          }),
        );
        setImages((prev) => [...prev, ...downscaled]);
      } catch {
        showToast("error", "读取图片失败");
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  function onPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addImageFiles(files);
    }
  }

  function onDrop(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    addImageFiles(Array.from(e.dataTransfer?.files || []));
  }

  async function submit() {
    if (streaming) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    setText("");
    setImages([]);
    await send(trimmed, images);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="shrink-0 border-t border-line p-4">
      <div className="mx-auto max-w-[760px]">
        {images.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-16 w-16 rounded-control border border-line object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-fg opacity-0 transition-opacity hover:bg-black/90 group-hover:opacity-100"
                  aria-label="移除图片"
                >
                  <Icon name="X" size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn(
            "flex items-end gap-2 rounded-panel border bg-panel-2/60 p-2 transition-colors",
            drag ? "border-accent bg-accent/5" : "border-line",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addImageFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="添加图片"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-fg-dim transition-colors hover:bg-white/5 hover:text-fg disabled:opacity-40"
          >
            <Icon name={busy ? "CircleNotch" : "ImageSquare"} size={18} className={busy ? "animate-spin" : undefined} />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
            className="max-h-[136px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-fg placeholder:text-fg-mute focus:outline-none"
          />

          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-control bg-white/10 px-3 text-sm text-fg transition-colors hover:bg-white/15"
            >
              <Icon name="StopCircle" size={16} weight="fill" />
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() && images.length === 0}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-medium text-ink transition-colors hover:bg-accent-2 disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="PaperPlaneRight" size={16} weight="fill" />
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
