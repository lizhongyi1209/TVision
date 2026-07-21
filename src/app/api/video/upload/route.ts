// 视频创作素材上传代理。协议移植自 comfyui_o1key 的 r2_uploader.py：
// 先获取预签名，再按 provider/method/headers 上传原始字节，最终返回公网 URL。

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { LIMITS, rateLimit } from "@/lib/rateLimit.server";
import { resolveBaseUrl } from "@/lib/o1key";
import { MediaValidationError, uploadMediaFile, uploadMediaToR2 } from "@/lib/mediaUpload.server";
import { s3Enabled } from "@/lib/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!rateLimit("upload", auth.uid, LIMITS.UPLOAD_PER_UID)) {
    return NextResponse.json({ error: "上传过于频繁，请稍后再试" }, { status: 429 });
  }
  const s = await readSettings(auth.uid);
  if (!s.apiKey) return NextResponse.json({ error: "未设置 API 令牌" }, { status: 400 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });

  const file = formData.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  try {
    // 配了对象存储就直传本项目 R2（inputs/ 空间，独立于上游网关存储）；
    // 未配（本地开发）时回退到上游网关的预签名上传，保持可用。
    const result = s3Enabled
      ? await uploadMediaToR2({ file: file as Blob & { name?: string }, uid: auth.uid })
      : await uploadMediaFile({
          file: file as Blob & { name?: string },
          baseUrl: resolveBaseUrl(s.route),
          apiKey: s.apiKey,
        });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "素材上传失败";
    // 500 而不是 502：站点在 Cloudflare 后面，源站 502/504 会被 CF 换成
    // HTML 错误页，前端拿不到 JSON 错误信息（表现为 Unexpected token '<'）。
    const status = error instanceof MediaValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
