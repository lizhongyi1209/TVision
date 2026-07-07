import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { buildModelId, buildSubmitBody, MAX_BODY_BYTES, resolveBaseUrl, submitTask } from "@/lib/o1key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Submit one or more generation tasks. Returns the upstream task ids as job ids;
// the client polls GET /api/jobs/{id} for each.
export async function POST(req: Request) {
  const s = await readSettings();
  if (!s.apiKey) {
    return NextResponse.json({ error: "未设置 API 令牌，请先在设置中填入 o1key 令牌" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const prompt = String(body.prompt ?? "").trim();
  const model = String(body.model ?? s.defaults.model);
  const resolution = String(body.resolution ?? s.defaults.resolution);
  const aspectRatio = String(body.aspectRatio ?? s.defaults.aspectRatio);
  const billing = String(body.billing ?? s.defaults.billing);
  const count = Math.max(1, Math.min(4, Number(body.count) || 1));
  const baseImage = typeof body.baseImage === "string" ? body.baseImage : "";
  const refImage = typeof body.refImage === "string" ? body.refImage : "";

  if (!prompt) return NextResponse.json({ error: "缺少提示词" }, { status: 400 });
  if (!baseImage) return NextResponse.json({ error: "缺少画布底图" }, { status: 400 });

  let modelId: string;
  try {
    modelId = buildModelId(model, resolution, billing);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const images = [baseImage];
  if (refImage) images.push(refImage);

  const submitBody = buildSubmitBody({ modelId, prompt, resolution, aspectRatio, images });
  const bytes = Buffer.byteLength(JSON.stringify(submitBody), "utf-8");
  if (bytes > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `请求体 ${(bytes / 1e6).toFixed(1)}MB 超过 20MB 上限，请使用更小的图片` },
      { status: 400 },
    );
  }

  const baseUrl = resolveBaseUrl(s.route, s.baseUrlOverride);
  try {
    const ids = await Promise.all(
      Array.from({ length: count }, () => submitTask(baseUrl, s.apiKey, submitBody)),
    );
    return NextResponse.json({ jobs: ids.map((id, index) => ({ id, index })), modelId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || "提交失败" }, { status: 502 });
  }
}
