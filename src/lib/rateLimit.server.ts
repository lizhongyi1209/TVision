// In-process sliding-window rate limiter, keyed by an arbitrary string
// (uid or ip). Single-instance deployment (see PLAN-MULTI-TENANT), so
// process-local state is the source of truth; if we ever go multi-instance
// this moves to Redis behind the same interface.

interface Window {
  stamps: number[];
}

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;

// 定期清理长期不活跃的 key，防止内存缓慢膨胀
let lastSweep = 0;
function sweep(now: number): void {
  if (now - lastSweep < 5 * 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    if (!w.stamps.length || w.stamps[w.stamps.length - 1] < now - WINDOW_MS) windows.delete(key);
  }
}

/** true = 放行并计数；false = 超限拒绝。 */
export function rateLimit(bucket: string, key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  sweep(now);
  const k = `${bucket}:${key}`;
  let w = windows.get(k);
  if (!w) windows.set(k, (w = { stamps: [] }));
  w.stamps = w.stamps.filter((t) => t > now - WINDOW_MS);
  if (w.stamps.length >= maxPerMinute) return false;
  w.stamps.push(now);
  return true;
}

/** 反代后拿真实来源 IP：信任 Caddy/Nginx 设置的 X-Forwarded-For 首项。 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export const LIMITS = {
  /** 进门/验令牌：按 IP，防爆破探测令牌 */
  ENTRY_PER_IP: 10,
  /** 生成类（jobs、video/jobs、workflow-runs、agent/chat、reverse-prompt）：按 uid */
  GENERATE_PER_UID: 30,
  /** 上传类：按 uid */
  UPLOAD_PER_UID: 20,
} as const;

/** 每 uid 同时进行中的生成任务上限（配合 jobRegistry.activeJobCount）。 */
export const MAX_ACTIVE_JOBS = Number(process.env.MAX_ACTIVE_JOBS) || 8;
