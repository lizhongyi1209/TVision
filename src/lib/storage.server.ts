// Generated-media storage: S3-compatible object store (R2/OSS/MinIO), keyed
// outputs/<uid>/<filename> so tenant isolation is structural, plus the assets
// table as the listing/ACL source of truth (we never LIST the bucket).
//
// Local-dev fallback: with no S3_* env configured, objects go to
// <OUTPUT_DIR>/<uid>/<filename> on disk — same interface, so routes don't
// care. Production should always configure S3 (disk on a single VPS fills up
// and doesn't survive container replacement).

import { promises as fs } from "fs";
import path from "path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDb } from "./db.server.ts";

const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.join(process.cwd(), "output");

const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_REGION = process.env.S3_REGION || "auto";
// Optional CDN/public base for the bucket; when set, media GETs redirect
// straight to it instead of presigning.
export const S3_PUBLIC_BASE = (process.env.S3_PUBLIC_BASE || "").replace(/\/$/, "");

export const s3Enabled = !!(S3_ENDPOINT && S3_BUCKET);

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || "",
        secretAccessKey: process.env.S3_SECRET_KEY || "",
      },
      forcePathStyle: true, // MinIO/OSS 兼容
    });
  }
  return client;
}

function objectKey(uid: string, name: string): string {
  return `outputs/${uid}/${path.basename(name)}`;
}

function localPath(uid: string, name: string): string {
  return path.join(OUTPUT_DIR, uid, path.basename(name));
}

export function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
    }[ext] || "application/octet-stream"
  );
}

export async function putObject(uid: string, name: string, bytes: Buffer): Promise<void> {
  if (s3Enabled) {
    await s3().send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: objectKey(uid, name),
        Body: bytes,
        ContentType: contentTypeFor(name),
      }),
    );
  } else {
    const p = localPath(uid, name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, bytes);
  }
}

export async function getObject(uid: string, name: string): Promise<Buffer | null> {
  if (s3Enabled) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: objectKey(uid, name) }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch {
      return null;
    }
  }
  try {
    return await fs.readFile(localPath(uid, name));
  } catch {
    return null;
  }
}

export async function deleteObject(uid: string, name: string): Promise<void> {
  if (s3Enabled) {
    await s3()
      .send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: objectKey(uid, name) }))
      .catch(() => undefined);
  } else {
    await fs.unlink(localPath(uid, name)).catch(() => undefined);
  }
}

/** 短时有效的读取直链（S3 模式）；本地模式返回 null（走应用流式返回）。 */
export async function presignGet(uid: string, name: string): Promise<string | null> {
  if (!s3Enabled) return null;
  if (S3_PUBLIC_BASE) return `${S3_PUBLIC_BASE}/${objectKey(uid, name)}`;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: S3_BUCKET, Key: objectKey(uid, name) }), {
    expiresIn: 600,
  });
}

// --- assets registry: listing + ACL live here, never in bucket LISTs ---

export interface AssetRow {
  name: string;
  kind: "image" | "video";
  bytes: number;
  createdAt: number;
}

export function registerAsset(uid: string, name: string, kind: "image" | "video", bytes: number): void {
  getDb()
    .prepare(
      `INSERT INTO assets (uid, name, kind, bytes, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid, name) DO UPDATE SET bytes = excluded.bytes`,
    )
    .run(uid, path.basename(name), kind, bytes, Date.now());
}

export function ownsAsset(uid: string, name: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM assets WHERE uid = ? AND name = ?").get(uid, path.basename(name));
}

export function listAssets(uid: string): AssetRow[] {
  const rows = getDb()
    .prepare("SELECT name, kind, bytes, created_at FROM assets WHERE uid = ? ORDER BY created_at DESC")
    .all(uid) as { name: string; kind: "image" | "video"; bytes: number; created_at: number }[];
  return rows.map((r) => ({ name: r.name, kind: r.kind, bytes: r.bytes, createdAt: r.created_at }));
}

export async function removeAsset(uid: string, name: string): Promise<boolean> {
  const safe = path.basename(name);
  const res = getDb().prepare("DELETE FROM assets WHERE uid = ? AND name = ?").run(uid, safe);
  if (res.changes === 0) return false;
  await deleteObject(uid, safe);
  return true;
}

// --- per-tenant quota ---

const QUOTA_BYTES = Number(process.env.TENANT_QUOTA_BYTES) || 2 * 1024 * 1024 * 1024; // 默认 2GB

export function tenantUsageBytes(uid: string): number {
  const row = getDb().prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM assets WHERE uid = ?").get(uid) as {
    n: number;
  };
  return row.n;
}

export function quotaExceeded(uid: string): boolean {
  return tenantUsageBytes(uid) >= QUOTA_BYTES;
}
