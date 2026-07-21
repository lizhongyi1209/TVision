import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { sanitizeBoardDraft, MAX_BOARD_BYTES } from "@/lib/board";
import { deleteBoard, readBoards, upsertBoard } from "@/lib/boardStore.server";
import { rateLimit } from "@/lib/rateLimit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 画布 CRUD（PLAN-BOARD）。与 templates 路由的差异：POST 是客户端 800ms 防抖
// 自动保存的落点，高频调用，所以只回存下的那一块（{ item }）而不是整个列表；
// DELETE 仍回刷新后的完整列表。

const ID_RE = /^[\w-]{1,64}$/;
// 自动保存的正常上限约 75 次/分（800ms 防抖），120 放行正常使用、拦住滥用。
const SAVES_PER_MINUTE = 120;

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ items: await readBoards(auth.uid) });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!rateLimit("board-save", auth.uid, SAVES_PER_MINUTE)) {
    return NextResponse.json({ error: "保存过于频繁，请稍后再试" }, { status: 429 });
  }
  // Content-Length 先挡一道，避免为超限请求白白缓冲整个 body。
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BOARD_BYTES) return NextResponse.json({ error: "画布内容过大" }, { status: 413 });
  const text = await req.text().catch(() => "");
  if (Buffer.byteLength(text) > MAX_BOARD_BYTES) {
    return NextResponse.json({ error: "画布内容过大" }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const draft = sanitizeBoardDraft(body);
  if (!draft) return NextResponse.json({ error: "画布内容无效" }, { status: 400 });
  // 画布 id 由客户端生成（新建即得 id，自动保存不用等首次往返换 id）。
  const id = typeof body.id === "string" && ID_RE.test(body.id) ? body.id : undefined;
  const item = await upsertBoard(auth.uid, { id, ...draft });
  return NextResponse.json({ item });
}

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({ id: null }))) as { id: string | null };
  if (!id) return NextResponse.json({ error: "缺少画布 id" }, { status: 400 });
  return NextResponse.json({ items: await deleteBoard(auth.uid, id) });
}
