import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { sanitizeCount, sanitizeParams, type Template } from "@/lib/templates";
import { deleteTemplate, readTemplates, upsertTemplate } from "@/lib/templateStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Templates CRUD (PLAN-TEMPLATE). Every mutation returns the full refreshed
// list so the client panel never needs a follow-up GET.

export async function GET() {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ items: await readTemplates() });
}

export async function POST(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return NextResponse.json({ error: "模板需要一个名字" }, { status: 400 });
  const params = sanitizeParams(body);
  if (!params) return NextResponse.json({ error: "模板内容无效" }, { status: 400 });
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 200) : undefined;
  // 预设模板的 id 保留给内置列表（不落盘），外部提交不允许占用。
  const id = typeof body.id === "string" && body.id && !body.id.startsWith("preset-") ? body.id : undefined;
  const items: Template[] = await upsertTemplate({ id, name, notes, count: sanitizeCount(body.count), ...params });
  return NextResponse.json({ items });
}

export async function DELETE(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({ id: null }))) as { id: string | null };
  if (!id) return NextResponse.json({ error: "缺少模板 id" }, { status: 400 });
  return NextResponse.json({ items: await deleteTemplate(id) });
}
