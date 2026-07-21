// Single SQLite handle for all per-tenant metadata. WAL mode so concurrent
// route handlers never block each other on reads; better-sqlite3 is sync,
// which sidesteps every "promise-chain as poor man's mutex" pattern the old
// JSON stores needed (historyMeta's appendQueue etc.).
//
// DATA_DIR: same root the workflow file stores use — one volume to mount in
// deployment. Schema is created idempotently on first open; ALTERs are not
// needed yet (pre-release, no live DBs to migrate).

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

const DB_PATH = path.join(DATA_DIR, "tvision.db");

// Next.js dev re-evaluates modules on edit; stash the handle on globalThis so
// hot reload doesn't leak file descriptors (same trick as prisma's docs).
const g = globalThis as unknown as { __tvisionDb?: Database.Database };

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      uid           TEXT PRIMARY KEY,
      token_enc     TEXT NOT NULL,
      defaults_json TEXT NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gen_meta (
      uid        TEXT NOT NULL,
      task_id    TEXT NOT NULL,
      meta_json  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (uid, task_id)
    );
    CREATE TABLE IF NOT EXISTS video_meta (
      uid        TEXT NOT NULL,
      task_id    TEXT NOT NULL,
      meta_json  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (uid, task_id)
    );
    CREATE TABLE IF NOT EXISTS agent_chats (
      uid           TEXT NOT NULL,
      id            TEXT NOT NULL,
      title         TEXT NOT NULL,
      model         TEXT NOT NULL,
      updated_at    INTEGER NOT NULL,
      messages_json TEXT NOT NULL,
      PRIMARY KEY (uid, id)
    );
    CREATE TABLE IF NOT EXISTS templates (
      uid        TEXT NOT NULL,
      id         TEXT NOT NULL,
      data_json  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (uid, id)
    );
    CREATE TABLE IF NOT EXISTS boards (
      uid        TEXT NOT NULL,
      id         TEXT NOT NULL,
      data_json  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (uid, id)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      uid        TEXT NOT NULL,
      task_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,      -- 'image' | 'video'
      done       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (uid, task_id)
    );
    CREATE INDEX IF NOT EXISTS jobs_by_task ON jobs (task_id);
    CREATE TABLE IF NOT EXISTS assets (
      uid        TEXT NOT NULL,
      name       TEXT NOT NULL,      -- basename, unique per tenant
      kind       TEXT NOT NULL,      -- 'image' | 'video'
      bytes      INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (uid, name)
    );
  `);
  return db;
}

export function getDb(): Database.Database {
  if (!g.__tvisionDb) g.__tvisionDb = open();
  return g.__tvisionDb;
}
