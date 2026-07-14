import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings, toPublic, writeSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const s = await readSettings();
  return NextResponse.json(toPublic(s));
}

export async function POST(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<{ apiKey: string }> & { clearApiKey?: boolean } = {};

  if (typeof body.apiKey === "string" && body.apiKey.trim()) patch.apiKey = body.apiKey.trim();
  if (body.clearApiKey === true) patch.clearApiKey = true;

  const next = await writeSettings(patch);
  return NextResponse.json(toPublic(next));
}
