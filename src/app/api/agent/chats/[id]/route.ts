import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteChat, readChat } from "@/lib/agentStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const chat = await readChat(id);
  if (!chat) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({ chat });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  const ok = await deleteChat(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
