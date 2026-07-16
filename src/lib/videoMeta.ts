// Server-side sidecar for generated videos: data/video-meta.json maps
// taskId → VideoMeta, so HistoryPage can restore params when a video card
// is clicked. Mirrors the pattern in historyMeta.ts.

import { promises as fs } from "fs";
import path from "path";
import type { VideoMeta } from "./types";

const DATA_DIR  = path.join(process.cwd(), "data");
const META_PATH = path.join(DATA_DIR, "video-meta.json");
const MAX_ENTRIES = 200;

export async function readVideoMetaMap(): Promise<Record<string, VideoMeta>> {
  try {
    return JSON.parse(await fs.readFile(META_PATH, "utf-8")) as Record<string, VideoMeta>;
  } catch {
    return {};
  }
}

export async function appendVideoMeta(meta: VideoMeta): Promise<void> {
  try {
    const map = await readVideoMetaMap();
    map[meta.taskId] = meta;
    const entries = Object.entries(map)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, MAX_ENTRIES);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(META_PATH, JSON.stringify(Object.fromEntries(entries), null, 2), "utf-8");
  } catch {
    // best-effort; never block on it
  }
}

/** video-<taskId>.mp4 → taskId */
export function taskIdForVideoFile(name: string): string {
  return name.replace(/^video-/, "").replace(/\.mp4$/i, "");
}
