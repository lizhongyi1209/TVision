// 将可灵生成的视频从远端 URL 下载并保存到 output/ 目录（PLAN-VIDEO）。
// POST { videoUrl, taskId, meta? } → { localUrl }（/api/media/<filename>.mp4）
// 文件名规则：video-<taskId>.mp4，确保幂等（重复保存同一任务覆盖同一文件）。
// meta 字段（VideoMeta）写入 data/video-meta.json sidecar，供历史面板还原参数。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireAuth } from "@/lib/auth";
import { appendVideoMeta } from "@/lib/videoMeta";
import type { VideoMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_DIR = path.join(process.cwd(), "output");

export async function POST(req: Request) {
  if (!(await requireAuth())) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    videoUrl?: string;
    taskId?: string;
    meta?: Partial<VideoMeta>;
  };
  const { videoUrl, taskId, meta } = body;
  if (!videoUrl) return NextResponse.json({ error: "缺少 videoUrl" }, { status: 400 });

  const safe = taskId ? `video-${taskId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : `video-${Date.now()}`;
  const filename = `${safe}.mp4`;
  const filePath = path.join(OUTPUT_DIR, filename);

  // 已保存过：更新 sidecar（以防首次保存时 meta 没传到），然后直接返回
  try {
    await fs.access(filePath);
    if (meta && taskId) {
      await appendVideoMeta({ ...meta, taskId, createdAt: meta.createdAt ?? Date.now() } as VideoMeta);
    }
    return NextResponse.json({ localUrl: `/api/media/${filename}` });
  } catch { /* 不存在，继续下载 */ }

  // 下载远端视频
  const res = await fetch(videoUrl, { headers: { "User-Agent": "TVision/1.0" } });
  if (!res.ok) {
    return NextResponse.json({ error: `下载失败 HTTP ${res.status}` }, { status: 502 });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "下载内容为空" }, { status: 502 });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(filePath, buf);

  // 写入 sidecar
  if (meta && taskId) {
    await appendVideoMeta({ ...meta, taskId, createdAt: meta.createdAt ?? Date.now() } as VideoMeta);
  }

  return NextResponse.json({ localUrl: `/api/media/${filename}` });
}
