import { NextResponse } from "next/server";
import path from "path";
import { requireAuth } from "@/lib/auth";
import {
  contentTypeFor,
  getObject,
  ownsAsset,
  presignGet,
  putObject,
  registerAsset,
  removeAsset,
} from "@/lib/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4"]);

// Serve a generated asset. Ownership check runs against the assets table
// (per-tenant), so cross-tenant reads 404 even with a guessed filename.
// S3 mode redirects to a presigned/CDN URL; local mode streams bytes.
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { name } = await ctx.params;
  const safe = path.basename(name);
  const ext = path.extname(safe).toLowerCase();
  if (!TYPES.has(ext)) return new Response("Not found", { status: 404 });
  if (!ownsAsset(auth.uid, safe)) return new Response("Not found", { status: 404 });

  const direct = await presignGet(auth.uid, safe);
  if (direct) return NextResponse.redirect(direct, 302);

  const buf = await getObject(auth.uid, safe);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypeFor(safe),
      // 内容按文件名不可变，但按租户私有——绝不能进共享缓存
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

function findExisting(uid: string, base: string): string | null {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    if (ownsAsset(uid, base + ext)) return base + ext;
  }
  return null;
}

// Replace an existing job's output with the frontend-composited full image after local inpaint, so history shows the complete result instead of the cropped patch.
export async function PUT(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { name } = await ctx.params;
  const safe = path.basename(name);
  if (!/^[\w.-]+\.png$/i.test(safe)) {
    return NextResponse.json({ ok: false, error: "文件名不合法" }, { status: 400 });
  }
  const base = safe.slice(0, -4);

  const existing = findExisting(auth.uid, base);
  if (!existing) return NextResponse.json({ ok: false, error: "对应的历史文件不存在" }, { status: 404 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ ok: false, error: "内容为空" }, { status: 400 });
  if (buf.length > 100 * 1024 * 1024) return NextResponse.json({ ok: false, error: "文件过大" }, { status: 413 });

  const isPng = buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) return NextResponse.json({ ok: false, error: "不是有效的图片" }, { status: 400 });

  await putObject(auth.uid, base + ".png", buf);
  registerAsset(auth.uid, base + ".png", "image", buf.length);

  // 清掉同名旧格式文件（inpaint 结果统一存 png）
  for (const ext of [".jpg", ".jpeg", ".webp"]) {
    if (existing === base + ext) await removeAsset(auth.uid, base + ext);
  }

  return NextResponse.json({ ok: true, url: `/api/media/${base}.png` });
}
