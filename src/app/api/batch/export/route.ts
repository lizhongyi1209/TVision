import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { buildZip, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_DIR = path.join(process.cwd(), "output");
/** Same allow-list as /api/media/[name] — only image files ever land in output/. */
const EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
/** One run tops out at MAX_BATCH_TASKS (=100) results; anything past that is
 *  a malformed request, not a legitimate export. */
const MAX_FILES = 200;

// Bundle a batch run's results into one STORE zip (PLAN-BATCH D10/T7).
// Body: { files: [{ file, name }] } — `file` is an output/ file name
// (basename-sanitized against traversal, mirroring /api/media/[name]),
// `name` is the desired name inside the archive ("服装名-模特N.png").
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = Array.isArray(body.files) ? body.files : null;
  if (!raw || !raw.length) return NextResponse.json({ error: "缺少文件列表" }, { status: 400 });
  if (raw.length > MAX_FILES) return NextResponse.json({ error: "文件数量过多" }, { status: 400 });

  const entries: ZipEntry[] = [];
  const usedNames = new Set<string>();
  for (const item of raw) {
    const rec = item as Record<string, unknown>;
    const file = typeof rec.file === "string" ? path.basename(rec.file) : "";
    if (!file || !EXTS.has(path.extname(file).toLowerCase())) {
      return NextResponse.json({ error: "文件名不合法" }, { status: 400 });
    }

    // Archive-internal name: strip any path separators the client sent, fall
    // back to the source file name, and de-dupe with a (2)/(3)… suffix so two
    // garments that share a display name can't silently overwrite each other.
    let name = (typeof rec.name === "string" ? rec.name : "").replace(/[\\/]+/g, "").trim() || file;
    if (usedNames.has(name)) {
      const ext = path.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let i = 2;
      while (usedNames.has(`${stem} (${i})${ext}`)) i++;
      name = `${stem} (${i})${ext}`;
    }
    usedNames.add(name);

    try {
      const data = await fs.readFile(path.join(OUTPUT_DIR, file));
      entries.push({ name, data });
    } catch {
      return NextResponse.json({ error: `文件不存在：${file}` }, { status: 404 });
    }
  }

  const zip = buildZip(entries);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="tvision-batch-${Date.now()}.zip"`,
      "Content-Length": String(zip.length),
    },
  });
}
