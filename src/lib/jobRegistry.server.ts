// Ownership registry for upstream generation tasks. Upstream task ids are
// bearer-ish (whoever knows one can poll it), so before the multi-tenant
// refactor any authed user could poll /api/jobs/<id> for someone else's task
// and get the result saved into their view. Registering (uid, taskId) at
// submit time lets the poll routes 404 anything the caller doesn't own.

import { getDb } from "./db.server.ts";

export type JobKind = "image" | "video";

export function registerJobs(uid: string, taskIds: string[], kind: JobKind): void {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO jobs (uid, task_id, kind, created_at) VALUES (?, ?, ?, ?)",
  );
  const now = Date.now();
  db.transaction(() => {
    for (const id of taskIds) stmt.run(uid, id, kind, now);
  })();
}

export function ownsJob(uid: string, taskId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM jobs WHERE uid = ? AND task_id = ?").get(uid, taskId);
}

export function markJobDone(uid: string, taskId: string): void {
  getDb().prepare("UPDATE jobs SET done = 1 WHERE uid = ? AND task_id = ?").run(uid, taskId);
}

/** 未完成任务数，作并发闸用（阶段 5）。只统计近 24h，免得中断的任务永久占坑。 */
export function activeJobCount(uid: string): number {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM jobs WHERE uid = ? AND done = 0 AND created_at > ?")
    .get(uid, dayAgo) as { n: number };
  return row.n;
}
