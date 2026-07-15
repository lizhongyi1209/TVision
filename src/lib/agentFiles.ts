// File-attachment rules for the Agent chat, shared between the composer
// (classification + caps) and the server extract route (text cap). What each
// kind maps to upstream was probed live against /v1/chat/completions (see
// scripts/test-file-support*.mjs):
//   - pdf   → OpenAI `file` content part; Gemini + Claude read it natively,
//             GPT-5.6 silently drops it (gated in the composer).
//   - text  → file read as plain text, injected as an extra text part —
//             works with every model. docx/xlsx/xlsm are converted to this
//             kind by POST /api/agent/extract (server-side unzip + XML strip);
//             .rtf is sent raw (models read RTF markup fine).
//   - audio → OpenAI `input_audio` part (wav/mp3) — Gemini only; the `file`
//             part shape 200s but the model never receives the audio.
//   - video / legacy Office (doc/xls/ppt) → rejected with a hint; the gateway
//     has no working path for them today.

export type AgentFileKind =
  | "image"
  | "pdf"
  | "text"
  | "office" // docx / xlsx / xlsm — needs server-side extraction first
  | "audio"
  | "video"
  | "legacy-office" // doc / xls / ppt / pptx — no upstream path, reject with hint
  | "unsupported";

/** Max attachments (images + files combined) on one message. */
export const MAX_AGENT_FILES = 10;
/** Per-file byte cap for binary passthrough (pdf). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Audio goes inline in the JSON body — keep it tighter than pdf. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/** Cap on extracted/read text per file, in characters. */
export const MAX_TEXT_CHARS = 200_000;

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "rtf", "html", "htm", "xml", "css", "csv", "tsv",
  "json", "jsonl", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "log",
  "sql", "py", "c", "cc", "cpp", "h", "hpp", "java", "php", "js", "jsx", "mjs",
  "ts", "tsx", "go", "rs", "rb", "swift", "kt", "kts", "cs", "sh", "bash",
  "zsh", "bat", "cmd", "ps1", "vue", "svelte", "r", "scala", "lua", "pl",
  "dart", "graphql", "proto", "tex", "diff", "patch",
]);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "bmp", "avif"]);
const AUDIO_EXTS = new Set(["wav", "mp3"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "avi", "mkv", "flv", "mpeg", "mpg", "m4a", "flac", "ogg", "aac"]);
const OFFICE_EXTS = new Set(["docx", "xlsx", "xlsm"]);
const LEGACY_OFFICE_EXTS = new Set(["doc", "xls", "ppt", "pptx"]);

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function classifyFile(name: string, mime: string): AgentFileKind {
  if (mime.startsWith("image/")) return "image";
  const ext = fileExt(name);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (OFFICE_EXTS.has(ext)) return "office";
  if (LEGACY_OFFICE_EXTS.has(ext)) return "legacy-office";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext) || mime.startsWith("video/") || mime.startsWith("audio/")) return "video";
  if (TEXT_EXTS.has(ext) || mime.startsWith("text/")) return "text";
  return "unsupported";
}

/** `accept` attr for the composer's file input — images plus everything we
 *  can actually analyze. */
export const AGENT_FILE_ACCEPT = [
  "image/*",
  ".pdf",
  ...[...OFFICE_EXTS].map((e) => `.${e}`),
  ...[...AUDIO_EXTS].map((e) => `.${e}`),
  ...[...TEXT_EXTS].map((e) => `.${e}`),
].join(",");

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}
