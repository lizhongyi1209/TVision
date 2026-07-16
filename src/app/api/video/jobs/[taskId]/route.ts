// 视频任务轮询（PLAN-VIDEO）：代理 Kling 状态查询，返回归一化的
// { status, progress, videoUrl, error }。
// 端点：
//   /kling/v1/videos/image2video/{task_id}
//   /kling/v1/videos/omni-video/{task_id}
// 两个端点的响应结构相同，统一用 video_task 里相同的提取逻辑处理。

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { resolveBaseUrl } from "@/lib/o1key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUCCESS = new Set(["succeed", "success", "succeeded", "completed", "done", "finished"]);
const FAILURE = new Set(["failed", "failure", "fail", "error", "expired", "timeout", "canceled", "cancelled", "rejected"]);

function extractStatus(p: unknown): string {
  const asDicts = [];
  if (p && typeof p === "object") {
    const r = p as Record<string, unknown>;
    asDicts.push(r);
    if (r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      asDicts.push(d);
      if (d.data && typeof d.data === "object") asDicts.push(d.data as Record<string, unknown>);
    }
  }
  for (const src of asDicts) {
    for (const key of ["status", "task_status", "state"]) {
      const v = src[key];
      if (v != null && String(v).trim()) return String(v).trim().toLowerCase();
    }
  }
  return "";
}

function extractProgress(p: unknown): number {
  const asDicts = [];
  if (p && typeof p === "object") {
    const r = p as Record<string, unknown>;
    asDicts.push(r);
    if (r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      asDicts.push(d);
      if (d.data && typeof d.data === "object") asDicts.push(d.data as Record<string, unknown>);
    }
  }
  for (const src of asDicts) {
    const v = src["progress"];
    if (v != null) {
      const n = parseFloat(String(v));
      if (!isNaN(n)) return Math.max(0, Math.min(100, n > 1 ? n : n * 100));
    }
  }
  return 0;
}

function extractVideoUrl(p: unknown): string | null {
  const asDicts: Record<string, unknown>[] = [];
  if (p && typeof p === "object") {
    const r = p as Record<string, unknown>;
    asDicts.push(r);
    if (r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      asDicts.push(d);
      if (d.data && typeof d.data === "object") asDicts.push(d.data as Record<string, unknown>);
    }
  }
  for (const src of asDicts) {
    for (const key of ["video_url", "result_url", "url", "download_url"]) {
      const v = src[key];
      if (v && typeof v === "string") return v;
    }
    const result = src.result;
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      for (const key of ["video_url", "result_url", "url"]) {
        const v = r[key];
        if (v && typeof v === "string") return v;
      }
    }
    const taskResult = src.task_result;
    if (taskResult && typeof taskResult === "object") {
      const tr = taskResult as Record<string, unknown>;
      const videos = tr.videos;
      if (Array.isArray(videos) && videos.length) {
        const first = videos[0] as Record<string, unknown>;
        const v = first.url ?? first.video_url;
        if (v && typeof v === "string") return v;
      }
    }
    const metadata = src.metadata;
    if (metadata && typeof metadata === "object") {
      const m = metadata as Record<string, unknown>;
      const v = m.url ?? m.video_url;
      if (v && typeof v === "string") return v;
    }
  }
  return null;
}

function extractError(p: unknown): string {
  const asDicts: Record<string, unknown>[] = [];
  if (p && typeof p === "object") {
    const r = p as Record<string, unknown>;
    asDicts.push(r);
    if (r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      asDicts.push(d);
      if (d.data && typeof d.data === "object") asDicts.push(d.data as Record<string, unknown>);
    }
  }
  for (const src of asDicts) {
    const err = src.error;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      for (const k of ["message", "msg", "detail"]) {
        if (e[k]) return String(e[k]);
      }
    } else if (err) return String(err);
    for (const k of ["fail_reason", "failure_reason", "task_status_msg", "message", "detail"]) {
      if (src[k]) return String(src[k]);
    }
  }
  return "未知错误";
}

export async function GET(_req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await ctx.params;
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const s = await readSettings();
  if (!s.apiKey) return NextResponse.json({ error: "未设置 API 令牌" }, { status: 400 });

  const baseUrl = resolveBaseUrl(s.route);
  const headers = { Authorization: `Bearer ${s.apiKey}` };

  // 尝试两个端点（先 image2video，再 omni）
  const endpoints = [
    `/kling/v1/videos/image2video/${encodeURIComponent(taskId)}`,
    `/kling/v1/videos/omni-video/${encodeURIComponent(taskId)}`,
  ];

  let payload: unknown = null;
  for (const ep of endpoints) {
    const res = await fetch(`${baseUrl}${ep}`, { headers });
    if (res.status === 200) {
      const text = await res.text();
      try { payload = JSON.parse(text); } catch { /* skip */ }
      if (payload) break;
    }
  }

  if (!payload) {
    return NextResponse.json({ status: "failed", progress: 0, error: "状态查询失败" });
  }

  const rawStatus = extractStatus(payload);
  const progress  = Math.round(extractProgress(payload));

  if (FAILURE.has(rawStatus) || rawStatus.includes("fail") || rawStatus.includes("error")) {
    return NextResponse.json({ status: "failed", progress, error: extractError(payload) });
  }
  if (SUCCESS.has(rawStatus)) {
    const videoUrl = extractVideoUrl(payload);
    if (!videoUrl) {
      return NextResponse.json({ status: "failed", progress: 100, error: "成功但未返回视频 URL" });
    }
    return NextResponse.json({ status: "success", progress: 100, videoUrl });
  }

  return NextResponse.json({ status: "running", progress });
}
