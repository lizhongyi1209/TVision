import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 模板配图（PLAN-TEMPLATE 展示图）：约定式文件夹 data/template-images/<模板名>/，
// 用户手工往里放图。文件名含「参考」或以 ref 开头 → 参考图；其余（含「效果」、
// result、out…）→ 效果图。GET 无参返回 { 模板名: { refs: [url], results: [url] } }
// 的完整清单，客户端按模板 name 匹配（预设模板不在 templates.json 里，按名字
// 匹配可以同时覆盖预设和用户模板）；GET ?t=<模板名>&f=<文件名> 流式返回图片。

const MEDIA_DIR = path.join(process.cwd(), "data", "template-images");
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function isRef(file: string): boolean {
  const lower = file.toLowerCase();
  return file.includes("参考") || lower.startsWith("ref");
}

export async function GET(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const t = url.searchParams.get("t");
  const f = url.searchParams.get("f");

  // 单文件流式返回。basename 防目录穿越（与 api/media 同一惯例）。
  if (t && f) {
    const safeT = path.basename(t);
    const safeF = path.basename(f);
    const type = TYPES[path.extname(safeF).toLowerCase()];
    if (!type) return new Response("Not found", { status: 404 });
    try {
      const buf = await fs.readFile(path.join(MEDIA_DIR, safeT, safeF));
      return new Response(new Uint8Array(buf), {
        headers: { "Content-Type": type, "Cache-Control": "no-cache" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  // 全量清单：遍历一层子文件夹。
  const map: Record<string, { refs: string[]; results: string[] }> = {};
  try {
    for (const dir of await fs.readdir(MEDIA_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const files = (await fs.readdir(path.join(MEDIA_DIR, dir.name)))
        .filter((x) => TYPES[path.extname(x).toLowerCase()])
        .sort();
      if (!files.length) continue;
      const toUrl = (x: string) => `/api/templates/media?t=${encodeURIComponent(dir.name)}&f=${encodeURIComponent(x)}`;
      map[dir.name] = {
        refs: files.filter(isRef).map(toUrl),
        results: files.filter((x) => !isRef(x)).map(toUrl),
      };
    }
  } catch {
    // 文件夹还没建 — 返回空清单即可
  }
  return NextResponse.json({ map });
}
