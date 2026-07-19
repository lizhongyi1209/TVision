// Server-side sidecar for generated images: gen_meta table maps
// (uid, upstream job id) -> the generation params used, so the UI can restore
// prompt/params when a history image is picked back onto the canvas.
// Per-tenant since the multi-tenant refactor; the 500-entry LRU cap is now
// per uid instead of one busy user evicting everyone's meta.

import type { GenMeta } from "./types";
import { getDb } from "./db.server.ts";
import { workflowTaskIdFromAssetStem } from "./workflowAssets.server.ts";

const MAX_ENTRIES = 500;

export async function readMetaMap(uid: string): Promise<Record<string, GenMeta>> {
  const rows = getDb()
    .prepare("SELECT task_id, meta_json FROM gen_meta WHERE uid = ?")
    .all(uid) as { task_id: string; meta_json: string }[];
  const map: Record<string, GenMeta> = {};
  for (const row of rows) {
    try {
      map[row.task_id] = JSON.parse(row.meta_json) as GenMeta;
    } catch {
      // skip corrupt rows
    }
  }
  return map;
}

export async function appendMeta(uid: string, ids: string[], meta: Omit<GenMeta, "createdAt">): Promise<void> {
  try {
    const db = getDb();
    const createdAt = Date.now();
    const insert = db.prepare(
      `INSERT INTO gen_meta (uid, task_id, meta_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(uid, task_id) DO UPDATE SET meta_json = excluded.meta_json, created_at = excluded.created_at`,
    );
    const trim = db.prepare(
      `DELETE FROM gen_meta WHERE uid = ? AND task_id NOT IN
         (SELECT task_id FROM gen_meta WHERE uid = ? ORDER BY created_at DESC LIMIT ?)`,
    );
    db.transaction(() => {
      for (const id of ids) insert.run(uid, id, JSON.stringify({ ...meta, createdAt }), createdAt);
      trim.run(uid, uid, MAX_ENTRIES);
    })();
  } catch {
    // best-effort sidecar; never block generation on it
  }
}

/** Output file name -> job id: strip extension, then a trailing _<index>. */
export function jobIdForFile(name: string): string {
  const stem = name.replace(/\.(png|jpe?g|webp)$/i, "");
  const scopedStem = stem.replace(/--img\d+$/, "");
  const scopedTaskId = workflowTaskIdFromAssetStem(scopedStem);
  return scopedTaskId ?? stem.replace(/_\d+$/, "");
}
