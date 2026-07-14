"use client";

// Client state for the "Agent" multimodal-chat workspace: chat list, the
// currently open chat's messages, and streaming status. Deliberately its own
// store (not merged into useStudio) — same reasoning as batchStore.ts: this
// workspace's state has nothing to do with the single-image canvas, and
// streaming text deltas would otherwise ripple into unrelated subscribers.

import { create } from "zustand";
import { DEFAULT_AGENT_MODEL, DEFAULT_REASONING_LEVEL, type ReasoningLevel } from "./agentModels";
import type { AgentChatMeta, AgentMessage } from "./agentTypes";

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
  send: (text: string, images: string[]) => Promise<void>;
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

  send: async (text, images) => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;

    const userMsg: AgentMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
      images: images.length ? images : undefined,
      createdAt: Date.now(),
    };
    // Placeholder shows up the instant send() runs — MessageRow renders an
    // empty reasoning+content assistant turn as "正在思考…" (see AgentPanel).
    const assistantMsg: AgentMessage = { id: nextId(), role: "assistant", content: "", createdAt: Date.now() };

    const baseMessages = [...get().messages, userMsg];
    set({ messages: [...baseMessages, assistantMsg], streaming: true, error: null });

    const controller = new AbortController();
    set({ abortController: controller });

    // Upstream OpenAI-style payload: multimodal content array when images are
    // attached, plain string otherwise (matches vision.ts's shape).
    const upstreamMessages = baseMessages.map((m) => ({
      role: m.role,
      content: m.images?.length
        ? [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
          ]
        : m.content,
    }));

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
        body: JSON.stringify({ model: get().model, effort: get().effort, messages: upstreamMessages }),
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
        // stall timeout, request failure) surfaces as a red error line, but
        // only replaces the turn when no content made it through; a partial
        // answer is left standing rather than thrown away.
        messages: userStopped
          ? s.messages
          : s.messages.map((m) => (m.id === assistantMsg.id && (timedOut || !m.content) ? { ...m, error: message } : m)),
      }));
    }

    // Persist the whole conversation once the turn settles (success, error, or
    // user-initiated stop all reach here) so the sidebar/title stay in sync.
    const id = await persistChat({ currentChatId: get().currentChatId, messages: get().messages, model: get().model });
    if (id) set({ currentChatId: id });
    get().loadChats();
  },

  stop: () => {
    get().abortController?.abort();
  },
}));
