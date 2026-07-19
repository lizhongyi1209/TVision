// Cheap connectivity + auth probe against the upstream: query a nonexistent
// task id. 401/403 => token rejected; anything else => reachable and accepted.
// We cannot fully validate a key without spending credits — real validation
// happens on the first generation. Shared by /api/settings (进门) and
// /api/settings/test (设置弹窗里的「测试连接」).

import { DEFAULT_ROUTE, resolveBaseUrl, TASK_ENDPOINT } from "./o1key.ts";

export interface ProbeResult {
  ok: boolean;
  reachable: boolean;
  message: string;
  baseUrl: string;
}

export async function probeApiKey(apiKey: string): Promise<ProbeResult> {
  const baseUrl = resolveBaseUrl(DEFAULT_ROUTE);
  if (!apiKey) return { ok: false, reachable: false, message: "未设置 API 令牌", baseUrl };
  const url = `${baseUrl}${TASK_ENDPOINT}connectivity-probe-000`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reachable: true,
        message: `令牌被拒绝 (HTTP ${res.status})，请检查 o1key 令牌是否正确`,
        baseUrl,
      };
    }
    return { ok: true, reachable: true, message: "测试成功！", baseUrl };
  } catch (e) {
    return {
      ok: false,
      reachable: false,
      message: `无法连接 ${baseUrl}：${(e as Error)?.message || e}。请检查网络。`,
      baseUrl,
    };
  }
}
