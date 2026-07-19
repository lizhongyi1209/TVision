// Server-side persistence for templates (PLAN-TEMPLATE): rows in the
// templates table keyed (uid, id) — per-tenant since the multi-tenant
// refactor, and SQLite transactions replace the old lockless
// read-modify-write on data/templates.json.

import { randomUUID } from "crypto";
import { MAX_TEMPLATES, type Template } from "./templates";
import { getDb } from "./db.server.ts";

export async function readTemplates(uid: string): Promise<Template[]> {
  const rows = getDb()
    .prepare("SELECT data_json FROM templates WHERE uid = ? ORDER BY created_at DESC")
    .all(uid) as { data_json: string }[];
  const list: Template[] = [];
  for (const row of rows) {
    try {
      list.push(JSON.parse(row.data_json) as Template);
    } catch {
      // skip corrupt rows
    }
  }
  return list;
}

/** Insert (no id) or update (with id) one template. Newest first; capped at
 *  MAX_TEMPLATES by dropping the oldest. */
export async function upsertTemplate(
  uid: string,
  input: Omit<Template, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<Template[]> {
  const db = getDb();
  const now = Date.now();
  db.transaction(() => {
    const existingRow = input.id
      ? (db.prepare("SELECT data_json, created_at FROM templates WHERE uid = ? AND id = ?").get(uid, input.id) as
          | { data_json: string; created_at: number }
          | undefined)
      : undefined;
    if (existingRow && input.id) {
      const existing = JSON.parse(existingRow.data_json) as Template;
      const merged: Template = { ...existing, ...input, id: input.id, updatedAt: now };
      db.prepare("UPDATE templates SET data_json = ? WHERE uid = ? AND id = ?").run(
        JSON.stringify(merged),
        uid,
        input.id,
      );
    } else {
      const id = randomUUID();
      const tpl: Template = { ...input, id, createdAt: now, updatedAt: now };
      db.prepare("INSERT INTO templates (uid, id, data_json, created_at) VALUES (?, ?, ?, ?)").run(
        uid,
        id,
        JSON.stringify(tpl),
        now,
      );
      db.prepare(
        `DELETE FROM templates WHERE uid = ? AND id NOT IN
           (SELECT id FROM templates WHERE uid = ? ORDER BY created_at DESC LIMIT ?)`,
      ).run(uid, uid, MAX_TEMPLATES);
    }
  })();
  return readTemplates(uid);
}

export async function deleteTemplate(uid: string, id: string): Promise<Template[]> {
  getDb().prepare("DELETE FROM templates WHERE uid = ? AND id = ?").run(uid, id);
  return readTemplates(uid);
}
