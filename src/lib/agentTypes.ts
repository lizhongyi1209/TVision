// Shared types for the "Agent" multimodal-chat feature, used by both the
// client store (agentChatStore.ts) and the server persistence layer
// (agentStore.server.ts) — kept dependency-free like types.ts.

export type AgentRole = "user" | "assistant" | "system";

/** One chat turn. Images are data URLs (already downscaled client-side before
 *  being attached), stored inline — same approach as history's meta sidecar,
 *  just heavier per-entry since these are full images, not references. */
export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  images?: string[];
  /** Accumulated `delta.reasoning_content` for this turn (thinking models
   *  stream this before any `delta.content`). Rendered as a collapsible
   *  "✦ 思考过程" block above the answer; persisted alongside content. */
  reasoning?: string;
  /** Present only on a failed assistant turn — rendered as a red system line
   *  in the chat stream instead of a normal bubble. */
  error?: string;
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
