import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { HistoryItem } from "@/lib/types";
import { jobIdForFile, readMetaMap } from "@/lib/historyMeta";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_DIR = path.join(process.cwd(), "output");

export async function GET() {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const metaMap = await readMetaMap();
    const files = await fs.readdir(OUTPUT_DIR);
    const imgs = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const items: HistoryItem[] = await Promise.all(
      imgs.map(async (f) => {
        const st = await fs.stat(path.join(OUTPUT_DIR, f));
        return { name: f, url: `/api/media/${f}`, createdAt: st.mtimeMs, size: st.size, meta: metaMap[jobIdForFile(f)] };
      }),
    );
    items.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

export async function DELETE(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { name } = (await req.json().catch(() => ({ name: null }))) as { name: string | null };
  if (!name) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await fs.unlink(path.join(OUTPUT_DIR, path.basename(name)));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
}
