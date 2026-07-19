import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { LIMITS, rateLimit } from "@/lib/rateLimit.server";
import { MAX_BODY_BYTES, resolveBaseUrl } from "@/lib/o1key";
import { normalizeVisionPrompt, resolveImageToDataUrl, reverseEngineerPrompt, VisionError } from "@/lib/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "视觉反推": send the canvas image to a vision-capable chat model and return
// a JSON-structured description for the client to drop straight into the
// prompt box. Pure image understanding — no generation job or history record
// is created here; that only happens once the user reviews the prompt and
// clicks 生成 themselves.
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!rateLimit("generate", auth.uid, LIMITS.GENERATE_PER_UID)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  const s = await readSettings(auth.uid);
  if (!s.apiKey) {
    return NextResponse.json({ error: "未设置 API 令牌，请先在设置中填入 o1key 令牌" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const image = typeof body.image === "string" ? body.image : "";
  if (!image) return NextResponse.json({ error: "缺少图片" }, { status: 400 });

  let dataUrl: string;
  try {
    dataUrl = await resolveImageToDataUrl(image, auth.uid);
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || "读取图片失败" }, { status: 400 });
  }

  const bytes = Buffer.byteLength(dataUrl, "utf-8");
  if (bytes > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `图片 ${(bytes / 1e6).toFixed(1)}MB 超过 20MB 上限，请使用更小的图片` },
      { status: 400 },
    );
  }

  const baseUrl = resolveBaseUrl(s.route);
  try {
    const { content, model } = await reverseEngineerPrompt(baseUrl, s.apiKey, dataUrl);
    const { text, parsed } = normalizeVisionPrompt(content);
    return NextResponse.json({ prompt: text, model, parseWarning: !parsed });
  } catch (e) {
    const err = e as VisionError;
    return NextResponse.json({ error: err?.message || "视觉解析失败", detail: err?.detail }, { status: 502 });
  }
}
