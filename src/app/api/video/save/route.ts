// 将可灵生成的视频从远端 URL 下载并保存到对象存储（PLAN-VIDEO）。
// POST { videoUrl, taskId, meta? } → { localUrl }（/api/media/<filename>.mp4）
// 文件名规则：video-<taskId>.mp4，确保幂等（重复保存同一任务覆盖同一文件）。
// meta 字段（VideoMeta）写入 video_meta 表 sidecar，供历史面板还原参数。
// videoUrl 是客户端提供的任意地址 —— 下载前做与 vision.ts 同款的私网校验，
// 防止拿服务端当 SSRF 跳板。

import { NextResponse } from "next/server";
import { isIP } from "net";
import { promises as dns } from "dns";
import { requireAuth } from "@/lib/auth";
import { appendVideoMeta } from "@/lib/videoMeta";
import { isPrivateOrReservedIp } from "@/lib/vision";
import { ownsAsset, putObject, registerAsset } from "@/lib/storage.server";
import type { VideoMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB 硬顶

async function assertPublicHost(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("仅支持 HTTP(S) 视频地址");
  if (url.username || url.password) throw new Error("视频地址不能包含认证信息");
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
  const addresses = isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    throw new Error("视频地址指向私有或保留网络");
  }
  return url;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    videoUrl?: string;
    taskId?: string;
    meta?: Partial<VideoMeta>;
  };
  const { videoUrl, taskId, meta } = body;
  if (!videoUrl) return NextResponse.json({ error: "缺少 videoUrl" }, { status: 400 });

  const safe = taskId ? `video-${taskId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : `video-${Date.now()}`;
  const filename = `${safe}.mp4`;

  // 已保存过：更新 sidecar（以防首次保存时 meta 没传到），然后直接返回
  if (ownsAsset(auth.uid, filename)) {
    if (meta && taskId) {
      await appendVideoMeta(auth.uid, { ...meta, taskId, createdAt: meta.createdAt ?? Date.now() } as VideoMeta);
    }
    return NextResponse.json({ localUrl: `/api/media/${filename}` });
  }

  // 校验 + 下载远端视频
  let url: URL;
  try {
    url = await assertPublicHost(videoUrl);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "视频地址不合法" }, { status: 400 });
  }
  const res = await fetch(url, { headers: { "User-Agent": "TVision/1.0" }, redirect: "error" }).catch((e: Error) => e);
  if (res instanceof Error) return NextResponse.json({ error: `下载失败：${res.message}` }, { status: 500 });
  if (!res.ok) {
    return NextResponse.json({ error: `下载失败 HTTP ${res.status}` }, { status: 500 });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "下载内容为空" }, { status: 500 });
  if (buf.length > MAX_VIDEO_BYTES) return NextResponse.json({ error: "视频超过 500MB 上限" }, { status: 413 });

  await putObject(auth.uid, filename, buf);
  registerAsset(auth.uid, filename, "video", buf.length);

  // 写入 sidecar
  if (meta && taskId) {
    await appendVideoMeta(auth.uid, { ...meta, taskId, createdAt: meta.createdAt ?? Date.now() } as VideoMeta);
  }

  return NextResponse.json({ localUrl: `/api/media/${filename}` });
}
