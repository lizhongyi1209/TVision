import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listChats, saveChat } from "@/lib/agentStore.server";
import type { AgentMessage } from "@/lib/agentTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const items = await listChats(auth.uid);
  return NextResponse.json({ items });
}

// Full-replace save of one chat (new or existing) — the client always sends
// the whole message list after a turn completes, not a diff/patch.
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const messages = Array.isArray(body.messages) ? (body.messages as AgentMessage[]) : null;
  const model = typeof body.model === "string" ? body.model : "";
  if (!messages || !model) {
    return NextResponse.json({ error: "缺少会话数据" }, { status: 400 });
  }

  const chat = await saveChat(auth.uid, {
    id: typeof body.id === "string" ? body.id : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    model,
    messages,
  });
  return NextResponse.json({ chat });
}
