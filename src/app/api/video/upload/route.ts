// 图片上传代理（PLAN-VIDEO）：浏览器无法直接访问预签名接口（CORS），由此路由
// 做两步中转：
//   STEP1  POST /v1/storage/presign  → 拿到 upload_url + public_url
//   STEP2  PUT/POST 原始字节 → upload_url
//   返回 public_url 给前端，用于 kling image 字段。
// 只转发图片（PNG/JPG/WEBP）；大小上限 10MB（官方约束）。

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { resolveBaseUrl } from "@/lib/o1key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
};

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const s = await readSettings();
  if (!s.apiKey) return NextResponse.json({ error: "未设置 API 令牌" }, { status: 400 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });

  const file = formData.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });

  const contentType = ALLOWED_TYPES[file.type?.toLowerCase()] ?? "image/jpeg";
  const arrayBuf = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuf);
  if (bytes.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `图片大小 ${(bytes.length / 1024 / 1024).toFixed(1)}MB 超过 10MB 上限，请先压缩` },
      { status: 400 },
    );
  }

  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  const filename = `tvision-upload-${Date.now()}.${ext}`;
  const baseUrl = resolveBaseUrl(s.route);

  // STEP1: 预签名
  const presignRes = await fetch(`${baseUrl}/v1/storage/presign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${s.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, content_type: contentType, size: bytes.length }),
  });
  if (!presignRes.ok) {
    const txt = await presignRes.text();
    return NextResponse.json({ error: `预签名失败: ${txt.slice(0, 200)}` }, { status: 502 });
  }
  const presignData = (await presignRes.json()) as Record<string, unknown>;

  // 容错取法（同 r2_uploader.py 的 _PresignResult）
  const candidates = [presignData, presignData.data as Record<string, unknown>].filter(Boolean);
  let uploadUrl = "", publicUrl = "";
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const m = c as Record<string, unknown>;
    const uu = (m.upload_url ?? m.uploadUrl) as string | undefined;
    const pu = (m.public_url ?? m.publicUrl ?? m.url) as string | undefined;
    if (uu && pu) { uploadUrl = uu; publicUrl = pu; break; }
  }
  if (!uploadUrl || !publicUrl) {
    return NextResponse.json({ error: `预签名响应格式异常: ${JSON.stringify(presignData).slice(0, 200)}` }, { status: 502 });
  }

  const method = ((presignData.data as Record<string,unknown>)?.method ?? presignData.method ?? "PUT") as string;
  const provider = ((presignData.data as Record<string,unknown>)?.provider ?? presignData.provider ?? "r2") as string;

  // STEP2: 上传
  const uploadHeaders: Record<string, string> = { "Content-Type": contentType };
  if (provider === "local") uploadHeaders["Authorization"] = `Bearer ${s.apiKey}`;

  const uploadRes = await fetch(uploadUrl, { method: method.toUpperCase(), headers: uploadHeaders, body: bytes });
  if (![200, 201, 204].includes(uploadRes.status)) {
    const txt = await uploadRes.text();
    return NextResponse.json({ error: `上传失败 (${uploadRes.status}): ${txt.slice(0, 200)}` }, { status: 502 });
  }

  return NextResponse.json({ url: publicUrl });
}
