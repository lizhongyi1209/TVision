// 视频创作功能类型（PLAN-VIDEO）。纯类型定义，client+server 共用。

export type KlingModel    = "v3" | "v2-6" | "v3-omni";
export type KlingMode     = "720p" | "1080p" | "4K";
export type AspectRatio   = "智能" | "16:9" | "9:16" | "1:1";

export interface ShotSegment {
  /** 分镜序号（1-based）。 */
  index: number;
  prompt: string;
  /** 该段时长（秒）。 */
  duration: number;
}

/** 前端发给 /api/video/jobs 的请求体。 */
export interface VideoJobParams {
  model:         KlingModel;
  mode:          KlingMode;
  duration:      number;
  prompt:        string;
  negativePrompt?: string;
  sound:         boolean;
  aspectRatio?:  AspectRatio;
  /** 起始帧 public_url（已由 /api/video/upload 上传后得到）。 */
  imageUrl?:     string;
  /** 尾帧 public_url（可选）。 */
  tailUrl?:      string;
  /** v3-omni 参考图 public_url 列表（最多 4 张）。 */
  refUrls?:      string[];
  /** 分镜段列表；非空时 prompt 字段可为空。 */
  shots?:        ShotSegment[];
}

export interface VideoHistoryItem {
  taskId:    string;
  model:     KlingModel;
  mode:      KlingMode;
  duration:  number;
  prompt:    string;
  shots:     ShotSegment[];
  videoUrl:  string;
  createdAt: number;
  /** 本地缓存的 blob URL（刷新后失效，仅用于当会话播放）。 */
  blobUrl?:  string;
}
