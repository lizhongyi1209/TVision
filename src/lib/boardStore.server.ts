// 画布的服务端持久化（PLAN-BOARD）：boards 表按 (uid, id) 存整块画布 JSON，
// 与 templateStore.server.ts 同构 —— 画布 JSON 很小（卡片只存 asset 文件名 +
// 位置，不含图片字节），SQLite 事务足够，不需要 workflowStore 那套文件锁。

import { randomUUID } from "crypto";
import { MAX_BOARDS, type Board } from "./board.ts";
import { getDb } from "./db.server.ts";

export async function readBoards(uid: string): Promise<Board[]> {
  const rows = getDb()
    .prepare("SELECT data_json FROM boards WHERE uid = ? ORDER BY created_at DESC")
    .all(uid) as { data_json: string }[];
  const list: Board[] = [];
  for (const row of rows) {
    try {
      list.push(JSON.parse(row.data_json) as Board);
    } catch {
      // skip corrupt rows
    }
  }
  return list;
}

/** 无 id 新建、有 id 覆盖一块画布。超过 MAX_BOARDS 时丢最旧的。 */
export async function upsertBoard(
  uid: string,
  input: Omit<Board, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<Board> {
  const db = getDb();
  const now = Date.now();
  let saved: Board;
  db.transaction(() => {
    const existingRow = input.id
      ? (db.prepare("SELECT data_json, created_at FROM boards WHERE uid = ? AND id = ?").get(uid, input.id) as
          | { data_json: string; created_at: number }
          | undefined)
      : undefined;
    if (existingRow && input.id) {
      let createdAt = existingRow.created_at;
      try {
        createdAt = (JSON.parse(existingRow.data_json) as Board).createdAt ?? createdAt;
      } catch {
        // 损坏的旧行直接整块覆盖
      }
      saved = { ...input, id: input.id, createdAt, updatedAt: now };
      db.prepare("UPDATE boards SET data_json = ? WHERE uid = ? AND id = ?").run(JSON.stringify(saved), uid, input.id);
    } else {
      const id = input.id || randomUUID();
      saved = { ...input, id, createdAt: now, updatedAt: now };
      db.prepare("INSERT INTO boards (uid, id, data_json, created_at) VALUES (?, ?, ?, ?)").run(
        uid,
        id,
        JSON.stringify(saved),
        now,
      );
      db.prepare(
        `DELETE FROM boards WHERE uid = ? AND id NOT IN
           (SELECT id FROM boards WHERE uid = ? ORDER BY created_at DESC LIMIT ?)`,
      ).run(uid, uid, MAX_BOARDS);
    }
  })();
  return saved!;
}

export async function deleteBoard(uid: string, id: string): Promise<Board[]> {
  getDb().prepare("DELETE FROM boards WHERE uid = ? AND id = ?").run(uid, id);
  return readBoards(uid);
}
