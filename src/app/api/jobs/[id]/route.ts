import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { readMetaMap } from "@/lib/historyMeta";
import { markJobDone, ownsJob } from "@/lib/jobRegistry.server";
import { fetchResultBytes, pollTaskOnce, resolveBaseUrl } from "@/lib/o1key";
import { embedImageText, PNG_META_KEYWORD } from "@/lib/pngMeta";
import { ownsAsset, putObject, registerAsset } from "@/lib/storage.server";
import { buildEmbeddedMeta } from "@/lib/templates";
import type { JobStatusResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function findExisting(uid: string, nameNoExt: string): string | null {
  for (const ext of [".png", ".jpg", ".webp"]) {
    if (ownsAsset(uid, nameNoExt + ext)) return nameNoExt + ext;
  }
  return null;
}

// Poll one task upstream. On success, download the result image(s) to /output
// and return local media URLs. Idempotent: re-polling a saved job reuses files.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // 上游 taskId 谁知道谁就能查——先验归属，不是本人提交的任务一律 404。
  if (!ownsJob(auth.uid, id)) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const s = await readSettings(auth.uid);

  const fail = (error: string): JobStatusResponse => ({ id, status: "failed", progress: null, images: [], error });
  if (!s.apiKey) return NextResponse.json(fail("未设置 API 令牌"));

  const baseUrl = resolveBaseUrl(s.route);
  try {
    const poll = await pollTaskOnce(baseUrl, s.apiKey, id);

    if (poll.status === "success") {
      // Generation params for this job (history sidecar) — embedded into the
      // image itself (PNG iTXt / JPEG COM, see pngMeta.ts) so the file
      // carries its own recipe: dropping it back onto the canvas restores
      // these settings without needing the sidecar. Best-effort: webp skips.
      const genMeta = (await readMetaMap(auth.uid))[id];
      const saved: string[] = [];
      for (let i = 0; i < poll.images.length; i++) {
        const nameNoExt = `${id}${poll.images.length > 1 ? `_${i}` : ""}`;
        const existing = findExisting(auth.uid, nameNoExt);
        if (existing) {
          saved.push(`/api/media/${existing}`);
          continue;
        }
        try {
          const fetched = await fetchResultBytes(poll.images[i], s.apiKey);
          const ext = fetched.ext;
          let bytes = fetched.bytes;
          if (genMeta) {
            try {
              bytes = Buffer.from(embedImageText(bytes, PNG_META_KEYWORD, JSON.stringify(buildEmbeddedMeta(genMeta))));
            } catch {
              // embedding must never block saving the image itself
            }
          }
          const fname = `${nameNoExt}${ext}`;
          await putObject(auth.uid, fname, bytes);
          registerAsset(auth.uid, fname, "image", bytes.length);
          saved.push(`/api/media/${fname}`);
        } catch {
          if (poll.images[i].kind === "url") saved.push(poll.images[i].value); // fallback to upstream URL
        }
      }
      markJobDone(auth.uid, id);
      const res: JobStatusResponse = { id, status: "success", progress: 1, images: saved };
      return NextResponse.json(res);
    }

    if (poll.status === "failed") {
      markJobDone(auth.uid, id);
      return NextResponse.json(fail(poll.error || "生成失败"));
    }

    const res: JobStatusResponse = { id, status: "running", progress: poll.progress, images: [] };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(fail((e as Error)?.message || "查询失败"));
  }
}
