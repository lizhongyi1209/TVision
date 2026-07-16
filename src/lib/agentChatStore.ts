"use client";

// Client state for the "Agent" multimodal-chat workspace: chat list, the
// currently open chat's messages, and streaming status. Deliberately its own
// store (not merged into useStudio) — same reasoning as batchStore.ts: this
// workspace's state has nothing to do with the single-image canvas, and
// streaming text deltas would otherwise ripple into unrelated subscribers.

import { create } from "zustand";
import { DEFAULT_AGENT_MODEL, DEFAULT_REASONING_LEVEL, modelSupportsVideo, type ReasoningLevel } from "./agentModels";
import type { AgentAttachment, AgentChatMeta, AgentMessage } from "./agentTypes";

let seq = 1;
function nextId(): string {
  return `m${Date.now()}_${seq++}`;
}

// No SSE chunk (of any kind — reasoning or content) for this long aborts the
// in-flight turn client-side. Generous because thinking models can spend a
// long stretch on `reasoning_content` before the first `content` delta.
const STALL_TIMEOUT_MS = 120_000;

interface AgentChatState {
  chats: AgentChatMeta[];
  currentChatId: string | null;
  messages: AgentMessage[];
  model: string;
  effort: ReasoningLevel;
  /** "联网搜索" toggle — when on, the server searches the web for the latest
   *  question and feeds the results to the model (see route.ts). */
  webSearch: boolean;
  streaming: boolean;
  loadingChats: boolean;
  error: string | null;

  abortController: AbortController | null;

  loadChats: () => Promise<void>;
  openChat: (id: string) => Promise<void>;
  newChat: () => void;
  deleteChat: (id: string) => Promise<void>;
  setModel: (model: string) => void;
  setEffort: (effort: ReasoningLevel) => void;
  setWebSearch: (on: boolean) => void;
  send: (text: string, images: string[], files?: AgentAttachment[]) => Promise<void>;
  /** Edit-and-resend: drops the target user message and everything after it,
   *  then sends `text` (reusing the original message's images and file
   *  attachments) as a fresh turn — the follow-up persistChat in send()
   *  full-replace-saves the truncated conversation, so no server-side
   *  support is needed. */
  resendFrom: (id: string, text: string) => Promise<void>;
  stop: () => void;
}

async function persistChat(state: Pick<AgentChatState, "currentChatId" | "messages" | "model">): Promise<string | null> {
  try {
    const res = await fetch("/api/agent/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: state.currentChatId || undefined, model: state.model, messages: state.messages }),
    }).then((r) => r.json());
    return res.chat?.id ?? null;
  } catch {
    return null;
  }
}

export const useAgentChat = create<AgentChatState>((set, get) => ({
  chats: [],
  currentChatId: null,
  messages: [],
  model: DEFAULT_AGENT_MODEL,
  effort: DEFAULT_REASONING_LEVEL,
  webSearch: false,
  streaming: false,
  loadingChats: false,
  error: null,

  abortController: null,

  loadChats: async () => {
    set({ loadingChats: true });
    try {
      const res = await fetch("/api/agent/chats").then((r) => r.json());
      set({ chats: res.items || [] });
    } catch {
      // ignore — sidebar just stays empty/stale
    } finally {
      set({ loadingChats: false });
    }
  },

  openChat: async (id) => {
    try {
      const res = await fetch(`/api/agent/chats/${encodeURIComponent(id)}`).then((r) => r.json());
      if (!res.chat) return;
      set({ currentChatId: res.chat.id, messages: res.chat.messages, model: res.chat.model, error: null });
    } catch {
      // ignore — stay on whatever chat was open
    }
  },

  newChat: () => set({ currentChatId: null, messages: [], error: null }),

  deleteChat: async (id) => {
    try {
      await fetch(`/api/agent/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== id),
      ...(s.currentChatId === id ? { currentChatId: null, messages: [] } : {}),
    }));
  },

  setModel: (model) => set({ model }),
  setEffort: (effort) => set({ effort }),
  setWebSearch: (on) => set({ webSearch: on }),

  send: async (text, images, files = []) => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0 && files.length === 0) return;

    const userMsg: AgentMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
      images: images.length ? images : undefined,
      files: files.length ? files : undefined,
      createdAt: Date.now(),
    };
    // Placeholder shows up the instant send() runs — MessageRow renders an
    // empty reasoning+content assistant turn as "正在思考…" (see AgentPanel).
    const assistantMsg: AgentMessage = { id: nextId(), role: "assistant", content: "", createdAt: Date.now() };

    const baseMessages = [...get().messages, userMsg];
    set({ messages: [...baseMessages, assistantMsg], streaming: true, error: null });

    const controller = new AbortController();
    set({ abortController: controller });

    // Upstream OpenAI-style payload: multimodal content array when anything
    // is attached, plain string otherwise. Attachment shapes were probed live
    // against the gateway (see agentFiles.ts): pdf → `file` part, text-family
    // → extra labelled text part, audio → `input_audio` part (Gemini only),
    // video → `file` part with the raw data URL on Gemini (reads it natively;
    // scripts/test-video-support.mjs), extracted frames as image parts on
    // everything else.
    const videoNative = modelSupportsVideo(get().model);
    const upstreamMessages = baseMessages.map((m) => {
      const msgFiles = m.files || [];
      if (!m.images?.length && !msgFiles.length) return { role: m.role, content: m.content };
      const parts: unknown[] = m.content ? [{ type: "text", text: m.content }] : [];
      for (const f of msgFiles) {
        if (f.kind === "pdf") {
          parts.push({ type: "file", file: { filename: f.name, file_data: f.data } });
        } else if (f.kind === "audio") {
          const format = f.name.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
          parts.push({
            type: "input_audio",
            input_audio: { data: f.data.slice(f.data.indexOf("base64,") + 7), format },
          });
        } else if (f.kind === "video") {
          if (videoNative) {
            parts.push({ type: "file", file: { filename: f.name, file_data: f.data } });
          } else if (f.frames?.length) {
            // Frame fallback — label the frames so the model knows they're
            // ordered samples of one clip, not independent images.
            parts.push({
              type: "text",
              text: `【视频 ${f.name}：以下 ${f.frames.length} 张图为按时间顺序均匀抽取的关键帧】`,
            });
            for (const frame of f.frames) parts.push({ type: "image_url", image_url: { url: frame } });
          } else {
            // History replayed to a non-Gemini model, and the browser never
            // managed to extract frames — tell the model instead of silently
            // dropping the attachment. (submit() blocks this for new sends.)
            parts.push({ type: "text", text: `【视频 ${f.name}：当前模型无法读取该视频内容】` });
          }
        } else {
          parts.push({ type: "text", text: `【附件 ${f.name}】\n${f.data}` });
        }
      }
      for (const url of m.images || []) parts.push({ type: "image_url", image_url: { url } });
      return { role: m.role, content: parts };
    });

    // Aborts the turn if no chunk (reasoning or content) arrives for
    // STALL_TIMEOUT_MS — guards against the upstream connection hanging open
    // without ever closing or erroring.
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, STALL_TIMEOUT_MS);
    };

    let upstreamErrorMsg: string | null = null;

    try {
      armStallTimer();
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: get().model,
          effort: get().effort,
          webSearch: get().webSearch,
          messages: upstreamMessages,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `请求失败 (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let reasoningAcc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armStallTimer();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("data:")) continue;
          const payload = trimmedLine.slice(5).trim();
          if (payload === "[DONE]") continue;
          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // skip malformed SSE chunk
          }
          if (typeof json?.tv_error === "string") {
            upstreamErrorMsg = json.tv_error;
            continue;
          }
          // First frame of a searched turn — attach the trace to the
          // assistant message so the source list renders above the answer.
          if (json?.tv_search) {
            const search = json.tv_search as AgentMessage["search"];
            set((s) => ({
              messages: s.messages.map((m) => (m.id === assistantMsg.id ? { ...m, search } : m)),
            }));
            continue;
          }
          const reasoningDelta = json.choices?.[0]?.delta?.reasoning_content;
          const contentDelta = json.choices?.[0]?.delta?.content;
          if (typeof reasoningDelta === "string" && reasoningDelta) {
            reasoningAcc += reasoningDelta;
            set((s) => ({
              messages: s.messages.map((m) => (m.id === assistantMsg.id ? { ...m, reasoning: reasoningAcc } : m)),
            }));
          }
          if (typeof contentDelta === "string" && contentDelta) {
            acc += contentDelta;
            set((s) => ({
              messages: s.messages.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc } : m)),
            }));
          }
        }
      }

      clearTimeout(stallTimer);

      // A tv_error chunk always ends the turn as a failure — the catch below
      // decides whether it overwrites the message (empty content) or just
      // leaves an already-streamed partial answer standing.
      if (upstreamErrorMsg) {
        throw new Error(upstreamErrorMsg);
      }

      set({ streaming: false, abortController: null });
    } catch (e) {
      clearTimeout(stallTimer);
      const userStopped = (e as Error)?.name === "AbortError" && !timedOut;
      const message = timedOut ? "响应超时，请重试" : upstreamErrorMsg || (e as Error)?.message || "请求失败，请重试";
      set((s) => ({
        streaming: false,
        abortController: null,
        // User-initiated stop keeps whatever streamed so far, as-is — not an
        // error. Anything else (upstream tv_error, mid-stream disconnect,
        // stall timeout, request failure) attaches the error to the turn: a
        // partial answer is left standing with a red "中断" line under it
        // (previously the error was silently swallowed whenever any content
        // had streamed — the answer just looked mysteriously cut off), and a
        // turn with no content renders as the error line alone.
        messages: userStopped
          ? s.messages
          : s.messages.map((m) =>
              m.id === assistantMsg.id ? { ...m, error: m.content ? `回答中断：${message}` : message } : m,
            ),
      }));
    }

    // Persist the whole conversation once the turn settles (success, error, or
    // user-initiated stop all reach here) so the sidebar/title stay in sync.
    const id = await persistChat({ currentChatId: get().currentChatId, messages: get().messages, model: get().model });
    if (id) set({ currentChatId: id });
    get().loadChats();
  },

  resendFrom: async (id, text) => {
    const s = get();
    if (s.streaming) return;
    const idx = s.messages.findIndex((m) => m.id === id);
    if (idx < 0 || s.messages[idx].role !== "user") return;
    const images = s.messages[idx].images || [];
    const files = s.messages[idx].files || [];
    // send() would no-op on an empty turn — bail before truncating so the
    // original message isn't silently dropped.
    if (!text.trim() && images.length === 0 && files.length === 0) return;
    set({ messages: s.messages.slice(0, idx) });
    await get().send(text, images, files);
  },

  stop: () => {
    get().abortController?.abort();
  },
}));
