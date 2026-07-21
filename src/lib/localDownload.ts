"use client";

// 资产页「本地下载」支持:基于 File System Access API(Chrome/Edge)。
// 浏览器安全模型不允许网页直接写任意本地路径,能做到的最优体验是:
// 用户选一次下载文件夹并授权(showDirectoryPicker),句柄存进 IndexedDB,
// 之后每次点下载都静默写入该文件夹,不再弹「另存为」。Chrome 122+ 勾选
// 「每次访问时允许」后跨会话也免确认。不支持该 API 的浏览器(Firefox/
// Safari)回退到 <a download> 普通下载(存到浏览器默认下载目录)。

import { downloadUrl } from "./utils";

// File System Access API 尚未进 TS 标准 lib,补最小声明。
type PermissionState2 = "granted" | "denied" | "prompt";
interface DirHandle {
  readonly name: string;
  queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState2>;
  requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState2>;
  getFileHandle(name: string, opts: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}
declare global {
  interface Window {
    showDirectoryPicker?(opts?: { mode?: "readwrite"; id?: string }): Promise<DirHandle>;
  }
}

const DB_NAME = "tvision-local-download";
const STORE = "handles";
const KEY = "downloadDir";

export function supportsDirPicker(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<DirHandle | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as DirHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(handle: DirHandle | null): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (handle) tx.objectStore(STORE).put(handle, KEY);
      else tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 让用户选下载文件夹并持久化句柄;取消选择返回 null。 */
export async function pickDownloadDir(): Promise<string | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "tvision-download" });
    await idbSet(handle);
    return handle.name;
  } catch {
    return null; // 用户取消
  }
}

export async function clearDownloadDir(): Promise<void> {
  await idbSet(null);
}

/** 已设置的下载文件夹名(仅名字,完整路径浏览器不暴露);未设置返回 null。 */
export async function getDownloadDirName(): Promise<string | null> {
  if (!supportsDirPicker()) return null;
  try {
    return (await idbGet())?.name ?? null;
  } catch {
    return null;
  }
}

export type SaveResult =
  | { ok: true; via: "dir"; dirName: string }
  | { ok: true; via: "browser" }
  | { ok: false; error: string };

/** 下载 url 到已授权的本地文件夹;未设置/不支持时回退浏览器普通下载。
 *  必须在用户手势(点击)里调用,requestPermission 才不会被拦。 */
export async function saveToLocal(url: string, filename: string): Promise<SaveResult> {
  const handle = supportsDirPicker() ? await idbGet().catch(() => null) : null;
  if (!handle) {
    downloadUrl(url, filename);
    return { ok: true, via: "browser" };
  }
  try {
    let perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "prompt") perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return { ok: false, error: "文件夹写入授权被拒绝,请重新设置下载位置" };

    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `获取文件失败(${res.status})` };
    const blob = await res.blob();
    const file = await handle.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return { ok: true, via: "dir", dirName: handle.name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "写入本地文件夹失败" };
  }
}
