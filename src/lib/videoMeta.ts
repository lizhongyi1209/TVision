// Server-side sidecar for generated videos: video_meta table maps
// (uid, taskId) → VideoMeta, so HistoryPage can restore params when a video
// card is clicked. Mirrors the pattern in historyMeta.ts; per-tenant.

import type { VideoMeta } from "./types";
import { getDb } from "./db.server.ts";

const MAX_ENTRIES = 200;

export async function readVideoMetaMap(uid: string): Promise<Record<string, VideoMeta>> {
  const rows = getDb()
    .prepare("SELECT task_id, meta_json FROM video_meta WHERE uid = ?")
    .all(uid) as { task_id: string; meta_json: string }[];
  const map: Record<string, VideoMeta> = {};
  for (const row of rows) {
    try {
      map[row.task_id] = JSON.parse(row.meta_json) as VideoMeta;
    } catch {
      // skip corrupt rows
    }
  }
  return map;
}

export async function appendVideoMeta(uid: string, meta: VideoMeta): Promise<void> {
  try {
    const db = getDb();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO video_meta (uid, task_id, meta_json, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(uid, task_id) DO UPDATE SET meta_json = excluded.meta_json, created_at = excluded.created_at`,
      ).run(uid, meta.taskId, JSON.stringify(meta), meta.createdAt);
      db.prepare(
        `DELETE FROM video_meta WHERE uid = ? AND task_id NOT IN
           (SELECT task_id FROM video_meta WHERE uid = ? ORDER BY created_at DESC LIMIT ?)`,
      ).run(uid, uid, MAX_ENTRIES);
    })();
  } catch {
    // best-effort; never block on it
  }
}

/** video-<taskId>.mp4 → taskId */
export function taskIdForVideoFile(name: string): string {
  return name.replace(/^video-/, "").replace(/\.mp4$/i, "");
}
