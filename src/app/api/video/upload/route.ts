// 视频创作素材上传代理。协议移植自 comfyui_o1key 的 r2_uploader.py：
// 先获取预签名，再按 provider/method/headers 上传原始字节，最终返回公网 URL。

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { resolveBaseUrl } from "@/lib/o1key";
import { MediaValidationError, uploadMediaFile } from "@/lib/mediaUpload.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const s = await readSettings();
  if (!s.apiKey) return NextResponse.json({ error: "未设置 API 令牌" }, { status: 400 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });

  const file = formData.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  const baseUrl = resolveBaseUrl(s.route);
  try {
    const result = await uploadMediaFile({
      file: file as Blob & { name?: string },
      baseUrl,
      apiKey: s.apiKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "素材上传失败";
    const status = error instanceof MediaValidationError ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
