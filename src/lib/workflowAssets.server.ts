import { createHash } from "crypto";
import path from "path";

const WORKFLOW_ASSET_MARKER = "tvwf-";
const SCOPED_ASSET_RE = /^tvwf-([a-f0-9]{32})-(.+)$/i;

export function workflowOwnerScope(ownerId: string): string {
  return createHash("sha256").update(String(ownerId)).digest("hex").slice(0, 32);
}

export function encodeWorkflowTaskId(taskId: string): string {
  const raw = String(taskId);
  if (/^[A-Za-z0-9-]{1,140}$/.test(raw)) return raw;
  const encoded = Buffer.from(raw, "utf-8").toString("base64url");
  if (encoded.length <= 180) return `b64_${encoded}`;
  return `sha_${createHash("sha256").update(raw).digest("hex")}`;
}

export function decodeWorkflowTaskId(encoded: string): string {
  if (!encoded.startsWith("b64_")) return encoded;
  try {
    return Buffer.from(encoded.slice(4), "base64url").toString("utf-8");
  } catch {
    return encoded;
  }
}

export function workflowAssetStem(ownerId: string, taskId: string): string {
  return `${WORKFLOW_ASSET_MARKER}${workflowOwnerScope(ownerId)}-${encodeWorkflowTaskId(taskId)}`;
}

export function workflowAssetScopeFromName(name: string): string | null {
  const safe = path.basename(name);
  if (!safe.startsWith(WORKFLOW_ASSET_MARKER)) return null;
  return SCOPED_ASSET_RE.exec(safe)?.[1]?.toLowerCase() ?? "";
}

export function workflowTaskIdFromAssetStem(stem: string): string | null {
  const match = SCOPED_ASSET_RE.exec(path.basename(stem));
  return match ? decodeWorkflowTaskId(match[2]) : null;
}

/** Unscoped legacy files retain their existing behavior. Any tvwf-prefixed
 * file, including a malformed one, is private and must match the account. */
export function canAccessWorkflowAsset(name: string, ownerId: string): boolean {
  const scope = workflowAssetScopeFromName(name);
  return scope === null || (!!scope && scope === workflowOwnerScope(ownerId));
}

export function isWorkflowScopedAsset(name: string): boolean {
  return workflowAssetScopeFromName(name) !== null;
}
