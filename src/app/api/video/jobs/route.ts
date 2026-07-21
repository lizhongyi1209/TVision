// 视频任务提交（PLAN-VIDEO）：接收前端传来的已上传图片 URL，组装 Kling
// image2video / omni-video 请求体并提交，返回 task_id。
// 端点映射（与 K3_video.py 保持一致）：
//   v3 / v2-6       → POST /kling/v1/videos/image2video
//   v3-omni         → POST /kling/v1/videos/omni-video

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { LIMITS, MAX_ACTIVE_JOBS, rateLimit } from "@/lib/rateLimit.server";
import { activeJobCount, registerJobs } from "@/lib/jobRegistry.server";
import { resolveBaseUrl } from "@/lib/o1key";
import {
  VIDEO_MODEL_IDS,
  allowedVideoDurations,
  allowedVideoResolutions,
  buildSeedanceGenerationBody,
  extractVideoTaskId,
  isSeedanceModel,
  isVideoModel,
} from "@/lib/videoGateway";
import type { VideoJobParams } from "@/lib/videoTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENDPOINT_IMAGE2VIDEO = "/kling/v1/videos/image2video";
const ENDPOINT_OMNI        = "/kling/v1/videos/omni-video";
const ENDPOINT_UNIFIED     = "/v1/video/generations";

const MODE_MAP: Record<string, string>  = { "720p": "std", "1080p": "pro", "4K": "4k" };
const VALID_RATIOS = new Set(["智能", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!rateLimit("generate", auth.uid, LIMITS.GENERATE_PER_UID)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  if (activeJobCount(auth.uid) >= MAX_ACTIVE_JOBS) {
    return NextResponse.json({ error: `同时进行的任务过多（上限 ${MAX_ACTIVE_JOBS}），请等待部分任务完成` }, { status: 429 });
  }
  const s = await readSettings(auth.uid);
  if (!s.apiKey) return NextResponse.json({ error: "未设置 API 令牌" }, { status: 400 });

  const p = (await req.json().catch(() => ({}))) as VideoJobParams;
  const rawModel  = String(p.model ?? "v3");
  if (!isVideoModel(rawModel)) return NextResponse.json({ error: "不支持的视频模型" }, { status: 400 });
  const model     = rawModel;
  const modeValue = typeof p.mode === "string" ? p.mode : "720p";
  if (!(allowedVideoResolutions(model) as readonly string[]).includes(modeValue)) {
    return NextResponse.json({ error: `${model} 不支持 ${modeValue} 分辨率` }, { status: 400 });
  }
  const mode = modeValue as VideoJobParams["mode"];
  const requestedDuration = typeof p.duration === "number" && Number.isFinite(p.duration) ? p.duration : 5;
  if (!allowedVideoDurations(model).includes(requestedDuration)) {
    return NextResponse.json({ error: `${model} 不支持该生成时长` }, { status: 400 });
  }
  const duration = requestedDuration;
  const prompt    = typeof p.prompt === "string" ? p.prompt.trim() : "";
  const negPrompt = typeof p.negativePrompt === "string" ? p.negativePrompt.trim() : "";
  const sound     = p.sound === true;
  const watermark = p.watermark === true;
  const webSearch = p.webSearch === true;
  const cameraFixed = p.cameraFixed === true;
  const seed = typeof p.seed === "number" && Number.isInteger(p.seed) ? p.seed : undefined;
  const imageUrl  = typeof p.imageUrl === "string" ? p.imageUrl : "";
  const tailUrl   = typeof p.tailUrl === "string" ? p.tailUrl : "";
  const cleanStringArray = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const refUrls   = cleanStringArray(p.refUrls);
  const videoUrls = cleanStringArray(p.videoUrls);
  const audioUrls = cleanStringArray(p.audioUrls);
  const referType = p.referType === "base" ? "base" : "feature";
  const keepOriginalSound = p.keepOriginalSound === true;
  const aspectValue = typeof p.aspectRatio === "string" ? p.aspectRatio : "智能";
  if (!VALID_RATIOS.has(aspectValue)) {
    return NextResponse.json({ error: "不支持的视频宽高比" }, { status: 400 });
  }
  const aspectRatio = aspectValue as VideoJobParams["aspectRatio"];
  // 分镜（multishot）
  const shots = Array.isArray(p.shots)
    ? p.shots.filter((shot) =>
        !!shot && typeof shot.prompt === "string" && Number.isFinite(shot.duration),
      )
    : [];

  if (!imageUrl && model !== "v3-omni" && !isSeedanceModel(model)) {
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
  if (!isSeedanceModel(model) && refUrls.length > 7) {
    return NextResponse.json({ error: "可灵参考图最多 7 张" }, { status: 400 });
  }
  // 可灵 v3-omni 官方约束：有参考视频时图片总数 ≤4，无参考视频时 ≤7。
  // 首尾帧也计入图片总数（image_list）。
  if (model === "v3-omni") {
    const frameCount = (imageUrl ? 1 : 0) + (tailUrl ? 1 : 0);
    const imageTotal = frameCount + refUrls.length;
    const imageCap = videoUrls.length ? 4 : 7;
    if (imageTotal > imageCap) {
      return NextResponse.json(
        { error: videoUrls.length ? "有参考视频时，图片总数不能超过 4 张" : "可灵 omni 图片总数不能超过 7 张" },
        { status: 400 },
      );
    }
  }
  if (isSeedanceModel(model) && shots.length) {
    return NextResponse.json({ error: "Seedance 2.0 不支持分镜模式" }, { status: 400 });
  }
  // 参考音频仅 Seedance 支持；参考视频 Seedance 与 v3-omni 都支持，其余模型不支持。
  if (!isSeedanceModel(model) && audioUrls.length) {
    return NextResponse.json({ error: "当前模型不支持参考音频" }, { status: 400 });
  }
  if (!isSeedanceModel(model) && model !== "v3-omni" && videoUrls.length) {
    return NextResponse.json({ error: "当前模型不支持参考视频" }, { status: 400 });
  }
  // 可灵 v3-omni 原生 video_list 至多 1 段参考视频。
  if (model === "v3-omni" && videoUrls.length > 1) {
    return NextResponse.json({ error: "可灵 v3-omni 至多支持 1 段参考视频" }, { status: 400 });
  }
  // 官方约束：参考视频为「视频编辑（base）」时不支持分镜；且有参考视频时首尾帧不适用（编辑模式）。
  if (model === "v3-omni" && videoUrls.length && referType === "base" && shots.length) {
    return NextResponse.json({ error: "视频编辑（base）模式不支持分镜" }, { status: 400 });
  }

  const baseUrl = resolveBaseUrl(s.route);
  const headers = {
    Authorization: `Bearer ${s.apiKey}`,
    "Content-Type": "application/json",
  };

  const modelName = VIDEO_MODEL_IDS[model];
  const modeApi   = MODE_MAP[mode]   ?? "std";
  let body: Record<string, unknown>;
  let endpoint: string;

  if (isSeedanceModel(model)) {
    endpoint = ENDPOINT_UNIFIED;
    try {
      body = buildSeedanceGenerationBody({
        ...p,
        model,
        mode,
        duration,
        prompt,
        negativePrompt: negPrompt,
        sound,
        watermark,
        webSearch,
        cameraFixed,
        seed,
        imageUrl: imageUrl || undefined,
        tailUrl: tailUrl || undefined,
        refUrls,
        videoUrls,
        audioUrls,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Seedance 参数无效" },
        { status: 400 },
      );
    }
  } else if (model === "v3-omni") {
    endpoint = ENDPOINT_OMNI;
    const hasReferVideo = videoUrls.length > 0;
    // 官方约束：有参考视频时 sound 只能为 off。
    body = {
      model_name: modelName,
      mode: modeApi,
      duration: String(duration),
      sound: sound && !hasReferVideo ? "on" : "off",
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
    // 官方约束：参考视频为「视频编辑（base）」时不能定义首尾帧。
    const allowFrames = !(hasReferVideo && referType === "base");
    if (imageUrl && allowFrames) imageList.push({ image_url: imageUrl, type: "first_frame" });
    if (tailUrl && allowFrames)  imageList.push({ image_url: tailUrl,  type: "end_frame" });
    // 参考图（无 type 字段，官方约束：无参考视频时图片总数 ≤7，有参考视频时 ≤4）
    for (const url of refUrls) imageList.push({ image_url: url });
    if (imageList.length) body.image_list = imageList;
    // 参考视频（video_list）：至多 1 段，refer_type ∈ feature / base，
    // keep_original_sound ∈ yes / no（是否保留参考视频原声）。
    if (hasReferVideo) {
      body.video_list = videoUrls.map((url) => ({
        video_url: url,
        refer_type: referType,
        keep_original_sound: keepOriginalSound ? "yes" : "no",
      }));
    }
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
    return NextResponse.json({ error: `提交失败 HTTP ${submitRes.status}: ${text.slice(0, 300)}` }, { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: `响应非 JSON: ${text.slice(0, 200)}` }, { status: 500 });
  }

  // task_id 的提取（同 K3_video.py 的 create_resp 处理）
  const taskId = extractVideoTaskId(payload);

  if (!taskId) {
    return NextResponse.json({ error: `API 未返回 task_id: ${JSON.stringify(payload).slice(0, 200)}` }, { status: 500 });
  }

  registerJobs(auth.uid, [taskId], "video");

  // 记录提交的参数（video sidecar），用于历史还原
  return NextResponse.json({
    taskId,
    model,
    mode,
    duration,
    prompt: shots.length ? "" : prompt,
    shots,
    sound,
    aspectRatio,
    watermark,
    webSearch,
    cameraFixed,
    seed,
  });
}
