import type {
  AspectRatio,
  SeedanceModel,
  VideoJobParams,
  VideoModel,
  VideoResolution,
} from "./videoTypes";

export const VIDEO_MODEL_IDS: Record<VideoModel, string> = {
  "v3": "kling-v3",
  "v2-6": "kling-v2-6",
  "v3-omni": "kling-v3-omni",
  "seedance-2.0": "seedance-2.0",
  "seedance-2.0-fast": "seedance-2.0-fast",
};

const SEEDANCE_MODELS = new Set<VideoModel>(["seedance-2.0", "seedance-2.0-fast"]);

const MODEL_RESOLUTIONS: Record<VideoModel, readonly VideoResolution[]> = {
  "v3": ["720p", "1080p", "4K"],
  "v2-6": ["720p", "1080p"],
  "v3-omni": ["720p", "1080p", "4K"],
  // seedance-2.0 支持到 4K；fast 仅 720p。
  "seedance-2.0": ["720p", "1080p", "4K"],
  "seedance-2.0-fast": ["720p"],
};

// 上游接入指南：ratio 可选 16:9 / 9:16 / 4:3 / 3:4 / 1:1（默认 16:9）。
// 「智能」不是上游参数——表示不传 ratio 字段，让上游走默认。
const SEEDANCE_RATIOS = new Set<AspectRatio>([
  "智能",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
]);

export function isSeedanceModel(model: string): model is SeedanceModel {
  return SEEDANCE_MODELS.has(model as VideoModel);
}

export function isVideoModel(model: string): model is VideoModel {
  return Object.prototype.hasOwnProperty.call(VIDEO_MODEL_IDS, model);
}

export function allowedVideoResolutions(model: VideoModel): readonly VideoResolution[] {
  return MODEL_RESOLUTIONS[model];
}

export function allowedVideoDurations(model: VideoModel): readonly number[] {
  if (model === "v2-6") return [5, 10];
  // Seedance：4-15 秒整数。
  if (isSeedanceModel(model)) return [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  return [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
}

export function maxReferenceImages(model: VideoModel): number {
  return isSeedanceModel(model) ? 9 : 7;
}

// 参考视频数量上限：Seedance 最多 3 段；可灵 v3-omni 原生 video_list 至多 1 段。
export function maxReferenceVideos(model: VideoModel): number {
  if (isSeedanceModel(model)) return 3;
  if (model === "v3-omni") return 1;
  return 0;
}

export function supportsReferenceMedia(model: VideoModel): boolean {
  return model === "v3-omni" || isSeedanceModel(model);
}

export function supportsShots(model: VideoModel): boolean {
  return model !== "v2-6" && !isSeedanceModel(model);
}

function cleanUrls(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  const urls = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  if (urls.length > limit) throw new Error(`参考素材数量超过 ${limit} 个上限`);
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("参考素材 URL 格式无效");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("参考素材 URL 只支持 HTTP 或 HTTPS");
    }
  }
  return urls;
}

export function buildSeedanceGenerationBody(params: VideoJobParams): Record<string, unknown> {
  if (!isSeedanceModel(params.model)) throw new Error("不是 Seedance 2.0 模型");

  const prompt = (params.prompt ?? "").trim();
  if (!prompt) throw new Error("提示词不能为空");

  const resolutions = allowedVideoResolutions(params.model);
  if (!resolutions.includes(params.mode)) {
    throw new Error(`${params.model} 不支持 ${params.mode} 分辨率`);
  }

  // Seedance：duration 为 4-15 秒的整数。
  const duration = params.duration ?? 5;
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
    throw new Error("Seedance 时长仅支持 4-15 秒的整数");
  }

  const ratio = params.aspectRatio ?? "智能";
  if (!SEEDANCE_RATIOS.has(ratio)) throw new Error("Seedance 宽高比无效");

  const firstUrl = cleanUrls(params.imageUrl ? [params.imageUrl] : [], 1)[0];
  const lastUrl = cleanUrls(params.tailUrl ? [params.tailUrl] : [], 1)[0];
  const referenceUrls = cleanUrls(params.refUrls, 9);
  const videoUrls = cleanUrls(params.videoUrls, 3);
  const audioUrls = cleanUrls(params.audioUrls, 3);

  if ((firstUrl || lastUrl) && (referenceUrls.length || videoUrls.length || audioUrls.length)) {
    throw new Error("首尾帧模式不能与多模态参考素材混用");
  }
  if (audioUrls.length && !firstUrl && !referenceUrls.length && !videoUrls.length) {
    throw new Error("参考音频不能单独提交，请同时添加图片或视频");
  }

  // 火山方舟视频生成接入指南（/v1/video/generations，OpenAI 对齐格式）：
  //   images — 图片参考数组，对象形式 { url, role }，role ∈
  //            first_frame / last_frame / reference_image；
  //   videos — 视频参考直链 URL 字符串数组（控制运动 / 镜头轨迹）；
  //   audios — 音频参考直链 URL 字符串数组（声画融合）；
  //   resolution / ratio / duration / camera_fixed / generate_audio /
  //   web_search / seed — 顶层标量。
  const images: Record<string, unknown>[] = [];
  if (firstUrl) images.push({ url: firstUrl, role: "first_frame" });
  if (lastUrl) images.push({ url: lastUrl, role: "last_frame" });
  for (const url of referenceUrls) images.push({ url, role: "reference_image" });

  const body: Record<string, unknown> = {
    model: VIDEO_MODEL_IDS[params.model],
    prompt,
    resolution: params.mode === "4K" ? "4k" : params.mode,
    duration,
    camera_fixed: params.cameraFixed === true,
    generate_audio: params.sound === true,
    web_search: params.webSearch === true,
  };
  // 「智能」表示不传 ratio，让上游按默认（16:9）处理。
  if (ratio !== "智能") body.ratio = ratio;
  // seed 可选：仅在用户明确填写时透传。
  if (params.seed !== undefined && params.seed !== null) {
    if (!Number.isInteger(params.seed)) throw new Error("随机种子必须是整数");
    body.seed = params.seed;
  }
  if (images.length) body.images = images;
  if (videoUrls.length) body.videos = videoUrls;
  if (audioUrls.length) body.audios = audioUrls;
  return body;
}

function* payloadObjects(payload: unknown): Generator<Record<string, unknown>> {
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    yield record;
    queue.push(...Object.values(record));
  }
}

export function extractVideoTaskId(payload: unknown): string | null {
  for (const source of payloadObjects(payload)) {
    for (const key of ["task_id", "taskId", "id"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

export function extractGeneratedVideoUrl(payload: unknown): string | null {
  for (const source of payloadObjects(payload)) {
    for (const key of ["video_url", "result_url", "url", "download_url"]) {
      const value = source[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
  }
  return null;
}
