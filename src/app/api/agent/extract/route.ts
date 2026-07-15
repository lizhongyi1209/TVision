import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fileExt, MAX_FILE_BYTES, MAX_TEXT_CHARS } from "@/lib/agentFiles";
import { docxToText, xlsxToText } from "@/lib/officeText.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Converts an office file (docx / xlsx / xlsm) to plain text for the Agent
// chat composer — no model behind the gateway accepts these formats directly,
// so the extracted text is what actually travels upstream (see agentFiles.ts).
export async function POST(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name : "";
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const b64 = dataUrl.slice(dataUrl.indexOf("base64,") + 7);
  if (!name || !b64) return NextResponse.json({ error: "缺少文件数据" }, { status: 400 });

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return NextResponse.json({ error: "文件数据无法解码" }, { status: 400 });
  }
  if (buf.length > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "文件超过 50MB 上限" }, { status: 413 });
  }

  const ext = fileExt(name);
  try {
    let text: string;
    if (ext === "docx") text = docxToText(buf);
    else if (ext === "xlsx" || ext === "xlsm") text = xlsxToText(buf);
    else return NextResponse.json({ error: `不支持提取 .${ext} 文件` }, { status: 400 });

    if (!text) return NextResponse.json({ error: "文件里没有可提取的文本" }, { status: 422 });
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = `${text.slice(0, MAX_TEXT_CHARS)}\n…（内容过长，已截断）`;
    return NextResponse.json({ text, truncated });
  } catch (e) {
    return NextResponse.json({ error: `解析失败：${(e as Error)?.message || "文件可能已损坏"}` }, { status: 422 });
  }
}
