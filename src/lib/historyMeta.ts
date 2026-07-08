// Server-side sidecar for generated images: data/history-meta.json maps
// upstream job id -> the generation params used, so the UI can restore
// prompt/params when a history image is picked back onto the canvas.

import { promises as fs } from "fs";
import path from "path";
import type { GenMeta } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const META_PATH = path.join(DATA_DIR, "history-meta.json");
const MAX_ENTRIES = 500;

export async function readMetaMap(): Promise<Record<string, GenMeta>> {
  try {
    return JSON.parse(await fs.readFile(META_PATH, "utf-8")) as Record<string, GenMeta>;
  } catch {
    return {};
  }
}

export async function appendMeta(ids: string[], meta: Omit<GenMeta, "createdAt">): Promise<void> {
  try {
    const map = await readMetaMap();
    const createdAt = Date.now();
    for (const id of ids) map[id] = { ...meta, createdAt };
    const entries = Object.entries(map)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, MAX_ENTRIES);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(META_PATH, JSON.stringify(Object.fromEntries(entries), null, 2), "utf-8");
  } catch {
    // best-effort sidecar; never block generation on it
  }
}

/** Output file name -> job id: strip extension, then a trailing _<index>. */
export function jobIdForFile(name: string): string {
  return name.replace(/\.(png|jpe?g|webp)$/i, "").replace(/_\d+$/, "");
}
