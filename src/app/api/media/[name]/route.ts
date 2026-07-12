import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_DIR = path.join(process.cwd(), "output");
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// Stream a generated image from /output. Path is basename-sanitized to prevent traversal.
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const safe = path.basename(name);
  const ext = path.extname(safe).toLowerCase();
  const type = TYPES[ext];
  if (!type) return new Response("Not found", { status: 404 });

  try {
    const buf = await fs.readFile(path.join(OUTPUT_DIR, safe));
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function findExisting(base: string): Promise<string | null> {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    try {
      await fs.access(path.join(OUTPUT_DIR, base + ext));
      return base + ext;
    } catch {
      // keep looking
    }
  }
  return null;
}

// Replace an existing job's output with the frontend-composited full image after local inpaint, so history shows the complete result instead of the cropped patch.
export async function PUT(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const safe = path.basename(name);
  if (!/^[\w.-]+\.png$/i.test(safe)) {
    return NextResponse.json({ ok: false, error: "文件名不合法" }, { status: 400 });
  }
  const base = safe.slice(0, -4);

  const existing = await findExisting(base);
  if (!existing) return NextResponse.json({ ok: false, error: "对应的历史文件不存在" }, { status: 404 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ ok: false, error: "内容为空" }, { status: 400 });
  if (buf.length > 100 * 1024 * 1024) return NextResponse.json({ ok: false, error: "文件过大" }, { status: 413 });

  const isPng = buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) return NextResponse.json({ ok: false, error: "不是有效的图片" }, { status: 400 });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, base + ".png"), buf);

  for (const ext of [".jpg", ".jpeg", ".webp"]) {
    try {
      await fs.unlink(path.join(OUTPUT_DIR, base + ext));
    } catch {
      // no old file to clean up
    }
  }

  return NextResponse.json({ ok: true, url: `/api/media/${base}.png` });
}
