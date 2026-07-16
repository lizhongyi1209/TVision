// Shared types for the "Agent" multimodal-chat feature, used by both the
// client store (agentChatStore.ts) and the server persistence layer
// (agentStore.server.ts) — kept dependency-free like types.ts.

export type AgentRole = "user" | "assistant" | "system";

/** One non-image attachment on a user turn, stored inline in the chat file
 *  (same approach as images). `data` is what gets replayed upstream on every
 *  later turn: a data URL for pdf/audio/video (passed through as-is), or the
 *  extracted plain text for text/docx/xlsx files. */
export interface AgentAttachment {
  kind: "pdf" | "text" | "audio" | "video";
  name: string;
  /** Original file size in bytes (display only). */
  size: number;
  data: string;
  /** Video only: JPEG-frame data URLs extracted client-side at attach time —
   *  sent as image parts to models without native video input (Gemini gets
   *  the raw video in `data` instead). Absent when the browser couldn't
   *  decode the container; such videos are gated to Gemini in the composer. */
  frames?: string[];
}

/** One chat turn. Images are data URLs (already downscaled client-side before
 *  being attached), stored inline — same approach as history's meta sidecar,
 *  just heavier per-entry since these are full images, not references. */
export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  images?: string[];
  /** Non-image attachments (PDF / text-family / audio) on a user turn. */
  files?: AgentAttachment[];
  /** Accumulated `delta.reasoning_content` for this turn (thinking models
   *  stream this before any `delta.content`). Rendered as a collapsible
   *  "✦ 思考过程" block above the answer; persisted alongside content. */
  reasoning?: string;
  /** Present only on a failed assistant turn — rendered as a red system line
   *  in the chat stream instead of a normal bubble. */
  error?: string;
  /** Web-search trace for this assistant turn (the "联网搜索" toggle):
   *  what was searched and which sources were fed to the model. Rendered as
   *  a collapsible source list above the answer. */
  search?: {
    query: string;
    results: { title: string; url: string }[];
    /** Set when the search itself failed — the turn was answered without it. */
    error?: string;
  };
  createdAt: number;
}

/** Full persisted chat (data/agent-chats/<id>.json). */
export interface AgentChat {
  id: string;
  title: string;
  model: string;
  messages: AgentMessage[];
  updatedAt: number;
}

/** Lightweight listing entry (GET /api/agent/chats). */
export interface AgentChatMeta {
  id: string;
  title: string;
  updatedAt: number;
}

/** First 20 characters of the first user message, used as the auto title
 *  when the caller doesn't supply one. Falls back to "新会话" for an empty/
 *  imageless first turn (shouldn't normally happen — the client always has a
 *  user message before it ever saves). */
export function deriveTitle(messages: Pick<AgentMessage, "role" | "content">[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser?.content?.trim();
  if (!text) return "新会话";
  return text.slice(0, 20);
}
