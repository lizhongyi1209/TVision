// Token-as-identity tenancy. The o1key API token *is* the account: uid is a
// hash of the token, so re-pasting the same token on any device restores the
// same history/settings, and billing identity always matches data identity.
//
// The raw token is stored server-side (AES-256-GCM under APP_SECRET) because
// the workflow runner executes in the background with only an ownerId — no
// request, no cookie — and still needs the Bearer key. The cookie itself
// carries only `uid.hmac(uid)`, never the token.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getDb } from "./db.server.ts";

const TENANT_COOKIE = "tv_tenant";
const TENANT_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

function appSecret(): Buffer {
  const raw = process.env.APP_SECRET || "";
  if (!raw) {
    // Dev fallback: derive from a fixed string so local runs work without
    // config, but refuse to boot like this in production.
    if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET 未设置");
    return createHash("sha256").update("tvision-dev-secret").digest();
  }
  return createHash("sha256").update(raw).digest();
}

/** 与 workflowAssets.workflowOwnerScope 同算法：sha256 前 32 hex。 */
export function uidForToken(apiKey: string): string {
  return createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 32);
}

export function maskToken(apiKey: string): string {
  return apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}` : "";
}

// --- token encryption (AES-256-GCM, iv:tag:cipher hex) ---

function encryptToken(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appSecret(), iv);
  const enc = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

function decryptToken(blob: string): string | null {
  try {
    const [ivH, tagH, dataH] = blob.split(":");
    const decipher = createDecipheriv("aes-256-gcm", appSecret(), Buffer.from(ivH, "hex"));
    decipher.setAuthTag(Buffer.from(tagH, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataH, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null; // APP_SECRET 换过 → 视为租户不存在，用户重贴令牌即可
  }
}

// --- cookie signing ---

function sign(uid: string): string {
  return createHmac("sha256", appSecret()).update(uid).digest("hex");
}

function verifyCookie(raw: string): string | null {
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const uid = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expect = sign(uid);
  if (sig.length !== expect.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expect, "hex"))) return null;
  } catch {
    return null;
  }
  return uid;
}

// --- tenant CRUD ---

export interface TenantSession {
  uid: string;
  /** 掩码后的令牌，当用户名展示。 */
  label: string;
}

interface TenantRow {
  uid: string;
  token_enc: string;
  defaults_json: string;
}

/** 读 cookie → 验签 → 查库。任何一步失败都视为未进门。 */
export async function getTenant(): Promise<TenantSession | null> {
  const store = await cookies();
  const raw = store.get(TENANT_COOKIE)?.value;
  if (!raw) return null;
  const uid = verifyCookie(raw);
  if (!uid) return null;
  const row = getDb().prepare("SELECT uid, token_enc, defaults_json FROM tenants WHERE uid = ?").get(uid) as
    | TenantRow
    | undefined;
  if (!row) return null;
  const token = decryptToken(row.token_enc);
  if (!token) return null;
  return { uid, label: maskToken(token) };
}

/** 建/更新租户并种 cookie。调用方负责先验证令牌有效。 */
export async function createTenant(apiKey: string): Promise<TenantSession> {
  const key = apiKey.trim();
  const uid = uidForToken(key);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO tenants (uid, token_enc, created_at, last_seen) VALUES (?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET token_enc = excluded.token_enc, last_seen = excluded.last_seen`,
    )
    .run(uid, encryptToken(key), now, now);
  const store = await cookies();
  store.set(TENANT_COOKIE, `${uid}.${sign(uid)}`, { ...COOKIE_OPTS, maxAge: TENANT_MAX_AGE });
  return { uid, label: maskToken(key) };
}

export async function clearTenantCookie(): Promise<void> {
  const store = await cookies();
  store.delete(TENANT_COOKIE);
}

/** 后台执行上下文（workflow runner）按 ownerId 取回明文令牌。 */
export function getTenantApiKey(uid: string): string {
  const row = getDb().prepare("SELECT token_enc FROM tenants WHERE uid = ?").get(uid) as
    | { token_enc: string }
    | undefined;
  if (!row) return "";
  return decryptToken(row.token_enc) || "";
}

export function readTenantDefaults(uid: string): Record<string, unknown> {
  const row = getDb().prepare("SELECT defaults_json FROM tenants WHERE uid = ?").get(uid) as
    | { defaults_json: string }
    | undefined;
  try {
    return row ? (JSON.parse(row.defaults_json) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function writeTenantDefaults(uid: string, defaults: Record<string, unknown>): void {
  getDb()
    .prepare("UPDATE tenants SET defaults_json = ?, last_seen = ? WHERE uid = ?")
    .run(JSON.stringify(defaults), Date.now(), uid);
}
