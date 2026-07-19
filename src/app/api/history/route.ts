import { NextResponse } from "next/server";
import type { HistoryItem } from "@/lib/types";
import { jobIdForFile, readMetaMap } from "@/lib/historyMeta";
import { readVideoMetaMap, taskIdForVideoFile } from "@/lib/videoMeta";
import { requireAuth } from "@/lib/auth";
import { listAssets, removeAsset } from "@/lib/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// History listing comes from the per-tenant assets table (not a shared
// readdir), so users only ever see their own generations.
export async function GET() {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const [metaMap, videoMetaMap] = await Promise.all([readMetaMap(auth.uid), readVideoMetaMap(auth.uid)]);
    const items: HistoryItem[] = listAssets(auth.uid).map((a) =>
      a.kind === "video"
        ? {
            name: a.name,
            url: `/api/media/${a.name}`,
            createdAt: a.createdAt,
            size: a.bytes,
            videoMeta: videoMetaMap[taskIdForVideoFile(a.name)],
          }
        : {
            name: a.name,
            url: `/api/media/${a.name}`,
            createdAt: a.createdAt,
            size: a.bytes,
            meta: metaMap[jobIdForFile(a.name)],
          },
    );
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { name } = (await req.json().catch(() => ({ name: null }))) as { name: string | null };
  if (!name) return NextResponse.json({ ok: false }, { status: 400 });
  const ok = await removeAsset(auth.uid, name);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
