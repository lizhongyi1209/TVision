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
import {
  AGENT_FILE_ACCEPT,
  classifyFile,
  formatBytes,
  MAX_AGENT_FILES,
  MAX_AUDIO_BYTES,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  MAX_VIDEO_BYTES,
  videoMime,
} from "@/lib/agentFiles";
import {
  AGENT_MODELS,
  modelSupportsAudio,
  modelSupportsPdf,
  modelSupportsVideo,
  REASONING_LEVELS,
  REASONING_LEVEL_LABELS,
  type ReasoningLevel,
} from "@/lib/agentModels";
import type { AgentAttachment, AgentMessage } from "@/lib/agentTypes";
import { useStudio } from "@/lib/store";
import { cn, downscaleImageSrc, extractVideoFrames, fileToDataURL } from "@/lib/utils";
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

// ── Right pane: message stream + composer (model/reasoning picked in the
//    composer's tool row, see AgentComposer) ─────────────────────────────────

function AgentChatArea() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
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

const FILE_KIND_ICONS: Record<AgentAttachment["kind"], string> = {
  pdf: "FilePdf",
  text: "FileText",
  audio: "FileAudio",
  video: "FileVideo",
};

/** Small pill showing one non-image attachment (used in the composer with a
 *  remove button, and read-only inside sent user messages). */
function FileChip({ file, onRemove }: { file: AgentAttachment; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-control border border-line bg-panel-2/60 py-1.5 pl-2.5 pr-2 text-xs text-fg-dim">
      <Icon name={FILE_KIND_ICONS[file.kind]} size={14} className="shrink-0 text-accent" />
      <span className="max-w-[180px] truncate" title={file.name}>
        {file.name}
      </span>
      <span className="text-fg-mute">{formatBytes(file.size)}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="移除文件"
          className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-fg-mute transition-colors hover:bg-white/10 hover:text-fg"
        >
          <Icon name="X" size={10} />
        </button>
      ) : null}
    </div>
  );
}

/** Message timestamp: same-day → "HH:mm", older → "M/D HH:mm". */
function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function MessageRow({ message, streaming }: { message: AgentMessage; streaming: boolean }) {
  const isUser = message.role === "user";
  const isLast = useAgentChat((s) => s.messages[s.messages.length - 1]?.id === message.id);
  const resendFrom = useAgentChat((s) => s.resendFrom);
  const showToast = useStudio((s) => s.showToast);
  // Edit-and-resend state (user messages only) — draft is (re)seeded from the
  // message content each time editing opens.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const hasReasoning = !!message.reasoning;
  const hasContent = !!message.content;
  const isActive = !isUser && streaming && isLast && !message.error;
  const showCursor = isActive && hasContent;
  const isPending = isActive && !hasContent && !hasReasoning;

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(message.content);
      showToast("success", "已复制");
    } catch {
      showToast("error", "复制失败");
    }
  }

  function confirmResend() {
    const next = draft.trim();
    if (!next && !message.images?.length && !message.files?.length) return;
    setEditing(false);
    resendFrom(message.id, next);
  }

  // A turn that failed before any content arrived renders as the error line
  // alone; a partial answer keeps its content and shows the error line below
  // it (inside the assistant branch further down).
  if (message.error && !hasContent) {
    return (
      <div className="flex items-start gap-2 text-sm text-red-400/80">
        <Icon name="Warning" size={15} className="mt-0.5 shrink-0" />
        <span>⚠ {message.error}</span>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-2">
        {message.files?.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {message.files.map((f, i) => (
              <FileChip key={i} file={f} />
            ))}
          </div>
        ) : null}
        {message.images?.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {message.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="h-24 w-24 rounded-control border border-line object-cover" />
            ))}
          </div>
        ) : null}
        {editing ? (
          <div className="w-full max-w-[85%] rounded-panel border border-accent/50 bg-panel-2/60 p-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  confirmResend();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              rows={Math.min(6, Math.max(2, draft.split("\n").length))}
              autoFocus
              className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-relaxed text-fg focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-end gap-2">
              <span className="mr-auto pl-2 text-[11px] text-fg-mute">重发将丢弃这条消息之后的对话</span>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-control px-2.5 py-1 text-xs text-fg-dim transition-colors hover:bg-white/5 hover:text-fg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmResend}
                disabled={!draft.trim() && !message.images?.length && !message.files?.length}
                className="flex items-center gap-1 rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-accent-2 disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon name="PaperPlaneRight" size={12} weight="fill" />
                重新发送
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.content ? (
              <div className="glass max-w-[85%] whitespace-pre-wrap rounded-panel px-4 py-2.5 text-sm leading-relaxed text-fg">
                {message.content}
              </div>
            ) : null}
            <div className="flex items-center gap-1 text-fg-mute">
              <button
                type="button"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
                disabled={streaming}
                title="编辑并重新发送"
                className="flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-white/10 hover:text-fg group-hover:opacity-100 disabled:pointer-events-none"
              >
                <Icon name="PencilSimple" size={13} />
              </button>
              {message.content ? (
                <button
                  type="button"
                  onClick={copyContent}
                  title="复制内容"
                  className="flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-white/10 hover:text-fg group-hover:opacity-100"
                >
                  <Icon name="Copy" size={13} />
                </button>
              ) : null}
              <span className="text-[11px]">{formatTime(message.createdAt)}</span>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-accent">
        <Icon name="Sparkle" size={13} />
      </span>
      <div className="min-w-0 flex-1">
        {message.search ? <SearchBlock search={message.search} /> : null}
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
        {message.error ? (
          <div className="mt-1.5 flex items-start gap-2 text-xs text-red-400/80">
            <Icon name="Warning" size={13} className="mt-0.5 shrink-0" />
            <span>⚠ {message.error}</span>
          </div>
        ) : null}
        {hasContent && !isActive ? (
          <div className="mt-1.5 flex items-center gap-1 text-fg-mute">
            <span className="text-[11px]">{formatTime(message.createdAt)}</span>
            <button
              type="button"
              onClick={copyContent}
              title="复制内容"
              className="flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-white/10 hover:text-fg group-hover:opacity-100"
            >
              <Icon name="Copy" size={13} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Search trace for one assistant turn: what was searched and which sources
// went to the model. Collapsed one-liner by default; expands to source links.
function SearchBlock({ search }: { search: NonNullable<AgentMessage["search"]> }) {
  const [open, setOpen] = useState(false);

  if (search.error) {
    return (
      <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-300/80">
        <Icon name="Globe" size={12} className="shrink-0" />
        <span>联网搜索失败（{search.error}），已在未联网状态下回答</span>
      </div>
    );
  }

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
        <Icon name="Globe" size={12} className="shrink-0" />
        <span className="truncate">
          已联网搜索「{search.query}」 · {search.results.length} 条来源
        </span>
      </button>
      {open ? (
        <div className="space-y-1 px-2.5 pb-2">
          {search.results.map((r, i) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              title={r.url}
              className="block truncate text-xs text-fg-mute transition-colors hover:text-accent"
            >
              [{i + 1}] {r.title}
            </a>
          ))}
        </div>
      ) : null}
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
  const model = useAgentChat((s) => s.model);
  const setModel = useAgentChat((s) => s.setModel);
  const effort = useAgentChat((s) => s.effort);
  const setEffort = useAgentChat((s) => s.setEffort);
  const webSearch = useAgentChat((s) => s.webSearch);
  const setWebSearch = useAgentChat((s) => s.setWebSearch);
  const showToast = useStudio((s) => s.showToast);

  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<AgentAttachment[]>([]);
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

  // Routes each dropped/picked file by kind (see agentFiles.ts for the probed
  // upstream support behind each branch). Unsupported kinds toast and skip —
  // one bad file doesn't block the rest of the batch.
  const addFiles = useCallback(
    async (list: File[]) => {
      const room = MAX_AGENT_FILES - images.length - files.length;
      if (list.length > room) {
        showToast("info", `一条消息最多带 ${MAX_AGENT_FILES} 个附件`);
        list = list.slice(0, Math.max(0, room));
      }
      if (!list.length) return;
      setBusy(true);
      const newImages: string[] = [];
      const newFiles: AgentAttachment[] = [];
      try {
        for (const f of list) {
          const kind = classifyFile(f.name, f.type);
          if (kind === "image") {
            const dataUrl = await fileToDataURL(f);
            newImages.push((await downscaleImageSrc(dataUrl, 1568, 0.92)).dataUrl);
          } else if (kind === "pdf") {
            if (f.size > MAX_FILE_BYTES) {
              showToast("error", `${f.name} 超过 50MB 上限`);
              continue;
            }
            newFiles.push({ kind: "pdf", name: f.name, size: f.size, data: await fileToDataURL(f) });
          } else if (kind === "text") {
            let content = await f.text();
            if (content.length > MAX_TEXT_CHARS) content = `${content.slice(0, MAX_TEXT_CHARS)}\n…（内容过长，已截断）`;
            if (!content.trim()) {
              showToast("info", `${f.name} 是空文件，已跳过`);
              continue;
            }
            newFiles.push({ kind: "text", name: f.name, size: f.size, data: content });
          } else if (kind === "office") {
            if (f.size > MAX_FILE_BYTES) {
              showToast("error", `${f.name} 超过 50MB 上限`);
              continue;
            }
            const r = await fetch("/api/agent/extract", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: f.name, dataUrl: await fileToDataURL(f) }),
            }).then((x) => x.json());
            if (typeof r.text !== "string" || !r.text) {
              showToast("error", r.error || `${f.name} 解析失败`);
              continue;
            }
            if (r.truncated) showToast("info", `${f.name} 内容过长，已截断`);
            newFiles.push({ kind: "text", name: f.name, size: f.size, data: r.text });
          } else if (kind === "audio") {
            if (f.size > MAX_AUDIO_BYTES) {
              showToast("error", `${f.name} 超过 20MB 音频上限`);
              continue;
            }
            newFiles.push({ kind: "audio", name: f.name, size: f.size, data: await fileToDataURL(f) });
          } else if (kind === "video") {
            if (f.size > MAX_VIDEO_BYTES) {
              showToast("error", `${f.name} 超过 15MB 视频上限，请先压缩或剪辑`);
              continue;
            }
            // Re-wrap the data URL with an accurate video MIME — FileReader
            // yields application/octet-stream for exts the browser doesn't
            // recognize (mov/mkv…), and the gateway routes on the MIME.
            const raw = await fileToDataURL(f);
            const dataUrl = `data:${videoMime(f.name, f.type)};base64,${raw.slice(raw.indexOf("base64,") + 7)}`;
            // Frames feed the non-Gemini fallback. A container the browser
            // can't decode (avi/wmv/…) just means no frames — the attachment
            // still works on Gemini; submit() gates the rest.
            let frames: string[] | undefined;
            try {
              frames = await extractVideoFrames(dataUrl);
            } catch {
              frames = undefined;
            }
            newFiles.push({ kind: "video", name: f.name, size: f.size, data: dataUrl, frames });
          } else if (kind === "legacy-office") {
            showToast("info", `${f.name}：旧版 Office 格式暂不支持，请另存为 docx / xlsx 后再传`);
          } else if (kind === "unsupported-audio") {
            showToast("info", `${f.name}：音频仅支持 wav / mp3`);
          } else {
            showToast("info", `${f.name}：暂不支持该文件类型`);
          }
        }
        if (newImages.length) setImages((prev) => [...prev, ...newImages]);
        if (newFiles.length) setFiles((prev) => [...prev, ...newFiles]);
      } catch {
        showToast("error", "读取文件失败");
      } finally {
        setBusy(false);
      }
    },
    [images.length, files.length, showToast],
  );

  function onPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pasted: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  }

  function onDrop(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    addFiles(Array.from(e.dataTransfer?.files || []));
  }

  async function submit() {
    if (streaming) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0 && files.length === 0) return;
    // Attachment × model gating (probed live — see agentModels.ts): block
    // before sending so the attachments stay in the composer and the user
    // can just switch model and hit send again.
    if (files.some((f) => f.kind === "pdf") && !modelSupportsPdf(model)) {
      showToast("info", "当前模型不支持 PDF，请切换到 Gemini 或 Claude 后再发送");
      return;
    }
    if (files.some((f) => f.kind === "audio") && !modelSupportsAudio(model)) {
      showToast("info", "音频分析目前仅 Gemini 支持，请切换模型后再发送");
      return;
    }
    // Non-Gemini models analyze video via extracted frames — a container the
    // browser couldn't decode has none, so it can only go to Gemini.
    if (files.some((f) => f.kind === "video" && !f.frames?.length) && !modelSupportsVideo(model)) {
      showToast("info", "该视频格式无法抽帧，只有 Gemini 能直接分析，请切换模型后再发送");
      return;
    }
    setText("");
    setImages([]);
    setFiles([]);
    await send(trimmed, images, files);
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
        {files.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <FileChip key={i} file={f} onRemove={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} />
            ))}
          </div>
        ) : null}
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
            "flex flex-col gap-2 rounded-panel border bg-panel-2/60 p-2 transition-colors",
            drag ? "border-accent bg-accent/5" : "border-line",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={AGENT_FILE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder="输入消息，可附图片 / PDF / 文档 / 代码 / 音频 / 视频…（Enter 发送，Shift+Enter 换行）"
            className="max-h-[136px] min-h-9 w-full resize-none bg-transparent px-1 py-1.5 text-sm leading-5 text-fg placeholder:text-fg-mute focus:outline-none"
          />

          {/* Tool row under the textarea: attachments / web search, then the
              reasoning + model pickers. Send/stop is pushed to the right edge
              with ml-auto. flex-wrap lets the row spill onto a second line on
              narrow/split windows instead of clipping the send button — every
              control keeps its intrinsic width (shrink-0). Buttons are h-10 to
              match Select's fixed height, same pairing as GenerateBar/VideoBar. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              aria-label="添加图片或文件"
              title="图片 / PDF / Word / Excel / 文本代码 / 音频 / 视频"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-fg-dim transition-colors hover:bg-white/5 hover:text-fg disabled:opacity-40"
            >
              <Icon name={busy ? "CircleNotch" : "Paperclip"} size={18} className={busy ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              onClick={() => setWebSearch(!webSearch)}
              aria-label="联网搜索"
              title={webSearch ? "联网搜索：开（回答前会先搜索网页）" : "联网搜索：关"}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-control transition-colors",
                webSearch ? "bg-accent/15 text-accent" : "text-fg-dim hover:bg-white/5 hover:text-fg",
              )}
            >
              <Icon name="Globe" size={18} weight={webSearch ? "fill" : "regular"} />
            </button>

            <div className="mx-1 h-5 w-px shrink-0 bg-line" />

            <Select
              value={effort}
              onChange={(v) => setEffort(v as ReasoningLevel)}
              disabled={streaming}
              options={REASONING_LEVELS.map((lv) => ({ value: lv, label: REASONING_LEVEL_LABELS[lv] }))}
              className="w-[104px] shrink-0"
            />
            <Select
              value={model}
              onChange={setModel}
              disabled={streaming}
              options={AGENT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
              className="w-[176px] shrink-0"
            />

            {streaming ? (
              <button
                type="button"
                onClick={stop}
                className="ml-auto flex h-10 shrink-0 items-center gap-1.5 rounded-control bg-white/10 px-3 text-sm text-fg transition-colors hover:bg-white/15"
              >
                <Icon name="StopCircle" size={16} weight="fill" />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim() && images.length === 0 && files.length === 0}
                className="ml-auto flex h-10 shrink-0 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-medium text-ink transition-colors hover:bg-accent-2 disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon name="PaperPlaneRight" size={16} weight="fill" />
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
