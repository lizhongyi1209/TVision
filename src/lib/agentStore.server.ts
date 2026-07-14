// Server-side persistence for the "Agent" multimodal-chat feature: one JSON
// file per chat under data/agent-chats/<id>.json (data/ is already gitignored
// wholesale — see settings.ts/historyMeta.ts for the same pattern). Images
// live inline as data URLs inside the message list, so a single chat file can
// run to a few MB; that's accepted per spec rather than optimized away.

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AgentChat, AgentChatMeta, AgentMessage } from "./agentTypes";
import { deriveTitle } from "./agentTypes";

const CHATS_DIR = path.join(process.cwd(), "data", "agent-chats");

function chatPath(id: string): string {
  // basename-sanitized, mirrors media/[name]/route.ts's traversal guard.
  return path.join(CHATS_DIR, `${path.basename(id)}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(CHATS_DIR, { recursive: true });
}

export async function listChats(): Promise<AgentChatMeta[]> {
  try {
    await ensureDir();
    const files = await fs.readdir(CHATS_DIR);
    const metas: AgentChatMeta[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(CHATS_DIR, f), "utf-8");
        const chat = JSON.parse(raw) as AgentChat;
        metas.push({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt });
      } catch {
        // skip corrupt/partial file rather than failing the whole listing
      }
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  } catch {
    return [];
  }
}

export async function readChat(id: string): Promise<AgentChat | null> {
  try {
    const raw = await fs.readFile(chatPath(id), "utf-8");
    return JSON.parse(raw) as AgentChat;
  } catch {
    return null;
  }
}

/** Create or overwrite a chat. When `id` is omitted, a new id is generated —
 *  the caller (client store) always sends the whole message list, so this is
 *  a full-replace save, not a patch. */
export async function saveChat(input: {
  id?: string;
  title?: string;
  model: string;
  messages: AgentMessage[];
}): Promise<AgentChat> {
  await ensureDir();
  const id = input.id || randomUUID();
  const chat: AgentChat = {
    id,
    title: input.title?.trim() || deriveTitle(input.messages),
    model: input.model,
    messages: input.messages,
    updatedAt: Date.now(),
  };
  await fs.writeFile(chatPath(id), JSON.stringify(chat, null, 2), "utf-8");
  return chat;
}

export async function deleteChat(id: string): Promise<boolean> {
  try {
    await fs.unlink(chatPath(id));
    return true;
  } catch {
    return false;
  }
}
