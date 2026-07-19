// Server-side persistence for the "Agent" multimodal-chat feature: one row
// per chat in the agent_chats table, keyed (uid, id) — every read/write/delete
// is scoped to the calling tenant, so chats are no longer reachable by anyone
// who knows an id (the old per-file store had no owner column at all).
// Images live inline as data URLs inside the message list, so messages_json
// can run to a few MB; that's accepted per spec rather than optimized away.

import { randomUUID } from "crypto";
import type { AgentChat, AgentChatMeta, AgentMessage } from "./agentTypes";
import { deriveTitle } from "./agentTypes";
import { getDb } from "./db.server.ts";

export async function listChats(uid: string): Promise<AgentChatMeta[]> {
  const rows = getDb()
    .prepare("SELECT id, title, updated_at FROM agent_chats WHERE uid = ? ORDER BY updated_at DESC")
    .all(uid) as { id: string; title: string; updated_at: number }[];
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

export async function readChat(uid: string, id: string): Promise<AgentChat | null> {
  const row = getDb()
    .prepare("SELECT id, title, model, updated_at, messages_json FROM agent_chats WHERE uid = ? AND id = ?")
    .get(uid, id) as { id: string; title: string; model: string; updated_at: number; messages_json: string } | undefined;
  if (!row) return null;
  try {
    return {
      id: row.id,
      title: row.title,
      model: row.model,
      messages: JSON.parse(row.messages_json) as AgentMessage[],
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

/** Create or overwrite a chat. When `id` is omitted, a new id is generated —
 *  the caller (client store) always sends the whole message list, so this is
 *  a full-replace save, not a patch. */
export async function saveChat(
  uid: string,
  input: { id?: string; title?: string; model: string; messages: AgentMessage[] },
): Promise<AgentChat> {
  const id = input.id || randomUUID();
  const chat: AgentChat = {
    id,
    title: input.title?.trim() || deriveTitle(input.messages),
    model: input.model,
    messages: input.messages,
    updatedAt: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO agent_chats (uid, id, title, model, updated_at, messages_json) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid, id) DO UPDATE SET
         title = excluded.title, model = excluded.model,
         updated_at = excluded.updated_at, messages_json = excluded.messages_json`,
    )
    .run(uid, id, chat.title, chat.model, chat.updatedAt, JSON.stringify(chat.messages));
  return chat;
}

export async function deleteChat(uid: string, id: string): Promise<boolean> {
  const res = getDb().prepare("DELETE FROM agent_chats WHERE uid = ? AND id = ?").run(uid, id);
  return res.changes > 0;
}
