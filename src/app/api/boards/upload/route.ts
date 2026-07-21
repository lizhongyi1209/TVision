// 画布图片上传（PLAN-BOARD）：与 video/upload 的 inputs/ 空间不同，画布卡片
// 需要「明天还在」的持久地址（画布落库存的是 asset 文件名），所以走 outputs/
// 空间 + assets 注册，得到与生成结果同款的 /api/media/<name> 稳定链接。
// 代价是占租户配额、会出现在资产页 —— 这符合直觉：放上画布的素材就是用户
// 的资产。仅收 png/jpeg/webp（media 路由只认这三种图片扩展名），其余格式由
// 客户端先转码再上传。

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { detectContentType } from "@/lib/mediaUpload.server";
import { LIMITS, rateLimit } from "@/lib/rateLimit.server";
import { putObject, quotaExceeded, registerAsset } from "@/lib/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!rateLimit("upload", auth.uid, LIMITS.UPLOAD_PER_UID)) {
    return NextResponse.json({ error: "上传过于频繁，请稍后再试" }, { status: 429 });
  }
  if (quotaExceeded(auth.uid)) {
    return NextResponse.json({ error: "存储空间已满，请先在资产页清理" }, { status: 413 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "内容为空" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "图片超过 30MB" }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  // 按魔数嗅探真实格式，不信浏览器按扩展名声明的 type。
  const detected = detectContentType(new Uint8Array(bytes));
  const ext = detected ? EXT_BY_TYPE[detected] : undefined;
  if (!ext) return NextResponse.json({ error: "仅支持 PNG / JPEG / WebP 图片" }, { status: 400 });

  const name = `board-${randomUUID()}.${ext}`;
  await putObject(auth.uid, name, bytes);
  registerAsset(auth.uid, name, "image", bytes.length);
  return NextResponse.json({ name, url: `/api/media/${name}` });
}
