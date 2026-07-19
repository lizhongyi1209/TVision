import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { LIMITS, MAX_ACTIVE_JOBS, rateLimit } from "@/lib/rateLimit.server";
import {
  buildGptImageSubmitBody,
  buildModelId,
  buildSubmitBody,
  isGptImage2,
  MAX_BODY_BYTES,
  resolveBaseUrl,
  submitTask,
} from "@/lib/o1key";
import { appendMeta } from "@/lib/historyMeta";
import { activeJobCount, registerJobs } from "@/lib/jobRegistry.server";
import { quotaExceeded } from "@/lib/storage.server";
import { MAX_REF_IMAGES } from "@/lib/limits";
import type { Billing, ModelName, Quality, Resolution } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Submit one or more generation tasks. Returns the upstream task ids as job ids;
// the client polls GET /api/jobs/{id} for each.
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!rateLimit("generate", auth.uid, LIMITS.GENERATE_PER_UID)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  if (activeJobCount(auth.uid) >= MAX_ACTIVE_JOBS) {
    return NextResponse.json({ error: `同时进行的任务过多（上限 ${MAX_ACTIVE_JOBS}），请等待部分任务完成` }, { status: 429 });
  }
  if (quotaExceeded(auth.uid)) {
    return NextResponse.json({ error: "存储空间已满，请在历史面板删除部分旧图后再生成" }, { status: 507 });
  }
  const s = await readSettings(auth.uid);
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
  const quality = String(body.quality ?? "auto");
  const baseImage = typeof body.baseImage === "string" ? body.baseImage : "";
  // Free-form multi-reference mode (PLAN-MULTI-REF): images[] order is base
  // image first, then refImages in their stored order, matching actions.ts's
  // "the first image / the second image…" prompt-wording convention.
  const refImages = Array.isArray(body.refImages)
    ? body.refImages.filter((x): x is string => typeof x === "string" && !!x).slice(0, MAX_REF_IMAGES)
    : [];
  // "视觉反推" and any future pure text-to-image action set this so the
  // canvas image is never sent upstream, even though the canvas still has
  // an image loaded (that's what the analysis was run against).
  const textOnly = body.textOnly === true;
  // Batch workshop only (PLAN-BATCH D8): a "服装文件名 · 模特N" label recorded
  // into the history sidecar so batch results stay tellable-apart. Record-only
  // — never forwarded upstream. Capped to keep the sidecar tidy.
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) : "";

  if (!prompt) return NextResponse.json({ error: "缺少提示词" }, { status: 400 });
  if (!textOnly && !baseImage) return NextResponse.json({ error: "缺少画布底图" }, { status: 400 });

  let modelId: string;
  try {
    modelId = buildModelId(model, resolution, billing);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const images: string[] = [];
  if (!textOnly) {
    if (baseImage) images.push(baseImage);
    images.push(...refImages);
  }

  const submitBody = isGptImage2(model)
    ? buildGptImageSubmitBody({
        modelId,
        prompt,
        resolution,
        aspectRatio,
        images,
        quality: (["auto", "high", "medium", "low"] as const).includes(quality as Quality)
          ? (quality as Quality)
          : "auto",
      })
    : buildSubmitBody({ modelId, prompt, resolution, aspectRatio, images });
  const bytes = Buffer.byteLength(JSON.stringify(submitBody), "utf-8");
  if (bytes > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `请求体 ${(bytes / 1e6).toFixed(1)}MB 超过 20MB 上限，请使用更小的图片` },
      { status: 400 },
    );
  }

  const baseUrl = resolveBaseUrl(s.route);
  try {
    const ids = await Promise.all(
      Array.from({ length: count }, () => submitTask(baseUrl, s.apiKey, submitBody)),
    );
    registerJobs(auth.uid, ids, "image");
    await appendMeta(auth.uid, ids, {
      prompt,
      model: model as ModelName,
      resolution: resolution as Resolution,
      aspectRatio,
      billing: billing as Billing,
      count,
      refCount: refImages.length,
      quality: isGptImage2(model) ? (quality as Quality) : undefined,
      note: note || undefined,
    });
    return NextResponse.json({ jobs: ids.map((id, index) => ({ id, index })), modelId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || "提交失败" }, { status: 500 });
  }
}
