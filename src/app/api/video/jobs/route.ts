// 视频任务提交（PLAN-VIDEO）：接收前端传来的已上传图片 URL，组装 Kling
// image2video / omni-video 请求体并提交，返回 task_id。
// 端点映射（与 K3_video.py 保持一致）：
//   v3 / v2-6       → POST /kling/v1/videos/image2video
//   v3-omni         → POST /kling/v1/videos/omni-video

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { resolveBaseUrl } from "@/lib/o1key";
import type { VideoJobParams } from "@/lib/videoTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENDPOINT_IMAGE2VIDEO = "/kling/v1/videos/image2video";
const ENDPOINT_OMNI        = "/kling/v1/videos/omni-video";

const MODE_MAP: Record<string, string>  = { "720p": "std", "1080p": "pro", "4K": "4k" };
const MODEL_MAP: Record<string, string> = {
  "v3":      "kling-v3",
  "v2-6":    "kling-v2-6",
  "v3-omni": "kling-v3-omni",
};

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const s = await readSettings();
  if (!s.apiKey) return NextResponse.json({ error: "未设置 API 令牌" }, { status: 400 });

  const p = (await req.json().catch(() => ({}))) as VideoJobParams;
  const model     = p.model    ?? "v3";
  const mode      = p.mode     ?? "720p";
  const duration  = Math.max(3, Math.min(15, p.duration ?? 5));
  const prompt    = (p.prompt ?? "").trim();
  const negPrompt = (p.negativePrompt ?? "").trim();
  const sound     = p.sound    ?? false;
  const imageUrl  = p.imageUrl ?? "";       // 起始帧（已上传后的 public_url）
  const tailUrl   = p.tailUrl  ?? "";       // 尾帧（可选）
  // 官方约束：无参考视频时图片总数（含首尾帧）+ 主体数 ≤ 7
  const refUrls   = Array.isArray(p.refUrls) ? (p.refUrls as string[]).filter(Boolean).slice(0, 7) : [];
  const aspectRatio = p.aspectRatio ?? "智能";
  // 分镜（multishot）
  const shots = Array.isArray(p.shots) ? p.shots : [];

  if (!imageUrl && model !== "v3-omni") {
    return NextResponse.json({ error: "缺少起始帧图片" }, { status: 400 });
  }
  if (!prompt && !shots.length) {
    return NextResponse.json({ error: "提示词不能为空" }, { status: 400 });
  }

  // v2-6 能力约束
  if (model === "v2-6" && ![5, 10].includes(duration)) {
    return NextResponse.json({ error: "v2-6 时长仅支持 5s 或 10s" }, { status: 400 });
  }
  if (model === "v2-6" && mode === "4K") {
    return NextResponse.json({ error: "v2-6 不支持 4K 模式" }, { status: 400 });
  }

  const baseUrl = resolveBaseUrl(s.route);
  const headers = {
    Authorization: `Bearer ${s.apiKey}`,
    "Content-Type": "application/json",
  };

  const modelName = MODEL_MAP[model] ?? `kling-${model}`;
  const modeApi   = MODE_MAP[mode]   ?? "std";
  let body: Record<string, unknown>;
  let endpoint: string;

  if (model === "v3-omni") {
    endpoint = ENDPOINT_OMNI;
    body = {
      model_name: modelName,
      mode: modeApi,
      duration: String(duration),
      sound: sound ? "on" : "off",
      watermark_info: { enabled: false },
    };
    if (aspectRatio !== "智能") body.aspect_ratio = aspectRatio;
    if (shots.length) {
      body.multi_shot  = true;
      body.shot_type   = "customize";
      body.multi_prompt = shots.map((sh, i) => ({
        index:    i + 1,
        prompt:   sh.prompt,
        duration: String(sh.duration),
      }));
    } else {
      body.prompt = prompt;
    }
    const imageList: unknown[] = [];
    if (imageUrl) imageList.push({ image_url: imageUrl, type: "first_frame" });
    if (tailUrl)  imageList.push({ image_url: tailUrl,  type: "end_frame" });
    // 参考图（无 type 字段，官方约束：图片总数 + element 数 ≤ 7）
    for (const url of refUrls) imageList.push({ image_url: url });
    if (imageList.length) body.image_list = imageList;
    if (negPrompt) body.negative_prompt = negPrompt;
  } else {
    endpoint = ENDPOINT_IMAGE2VIDEO;
    body = {
      model_name:      modelName,
      image:           imageUrl,
      prompt:          shots.length ? shots[0].prompt : prompt,
      negative_prompt: negPrompt,
      duration:        String(duration),
      mode:            modeApi,
      sound:           sound ? "on" : "off",
      watermark_info:  { enabled: false },
    };
    if (shots.length) {
      body.multi_shot   = true;
      body.shot_type    = "customize";
      body.multi_prompt = shots.map((sh, i) => ({
        index:    i + 1,
        prompt:   sh.prompt,
        duration: String(sh.duration),
      }));
    } else if (tailUrl) {
      body.image_tail = tailUrl;
    }
  }

  const submitRes = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).catch((e) => { throw new Error(`网络连接失败: ${(e as Error).message}`); });

  const text = await submitRes.text();
  if (![200, 201, 202].includes(submitRes.status)) {
    return NextResponse.json({ error: `提交失败 HTTP ${submitRes.status}: ${text.slice(0, 300)}` }, { status: 502 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: `响应非 JSON: ${text.slice(0, 200)}` }, { status: 502 });
  }

  // task_id 的提取（同 K3_video.py 的 create_resp 处理）
  const taskId =
    (payload.task_id as string) ||
    (payload.id as string) ||
    ((payload.data as Record<string, unknown>)?.task_id as string);

  if (!taskId) {
    return NextResponse.json({ error: `API 未返回 task_id: ${JSON.stringify(payload).slice(0, 200)}` }, { status: 502 });
  }

  // 记录提交的参数（video sidecar），用于历史还原
  return NextResponse.json({
    taskId,
    model,
    mode,
    duration,
    prompt: shots.length ? "" : prompt,
    shots,
  });
}
