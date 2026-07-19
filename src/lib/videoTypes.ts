// 视频创作功能类型（PLAN-VIDEO）。纯类型定义，client+server 共用。

export type KlingModel = "v3" | "v2-6" | "v3-omni";
export type SeedanceModel = "seedance-2.0" | "seedance-2.0-fast";
export type VideoModel = KlingModel | SeedanceModel;
export type VideoResolution = "480p" | "720p" | "1080p" | "4K";
export type AspectRatio = "智能" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9";

export interface ShotSegment {
  /** 分镜序号（1-based）。 */
  index: number;
  prompt: string;
  /** 该段时长（秒）。 */
  duration: number;
}

/** 前端发给 /api/video/jobs 的请求体。 */
export interface VideoJobParams {
  model:         VideoModel;
  mode:          VideoResolution;
  duration:      number;
  prompt:        string;
  negativePrompt?: string;
  sound:         boolean;
  aspectRatio?:  AspectRatio;
  watermark?:    boolean;
  webSearch?:    boolean;
  /** Seedance：是否锁定镜头（不使用运镜，静态视角拍摄）。 */
  cameraFixed?:  boolean;
  /** Seedance：随机种子（可选，整数）；不填由上游随机。 */
  seed?:         number;
  /** 起始帧 public_url（已由 /api/video/upload 上传后得到）。 */
  imageUrl?:     string;
  /** 尾帧 public_url（可选）。 */
  tailUrl?:      string;
  /** 多模态参考图 public_url 列表；Seedance 最多 9 张，Kling Omni 最多 7 张。 */
  refUrls?:      string[];
  /** Seedance 参考视频 public_url 列表（最多 3 个）。 */
  videoUrls?:    string[];
  /** Seedance 参考音频 public_url 列表（最多 3 段）。 */
  audioUrls?:    string[];
  /** 分镜段列表；非空时 prompt 字段可为空。 */
  shots?:        ShotSegment[];
}

export interface VideoHistoryItem {
  taskId:    string;
  model:     VideoModel;
  mode:      VideoResolution;
  duration:  number;
  prompt:    string;
  shots:     ShotSegment[];
  videoUrl:  string;
  createdAt: number;
  /** 本地缓存的 blob URL（刷新后失效，仅用于当会话播放）。 */
  blobUrl?:  string;
}
