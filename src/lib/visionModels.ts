// Model roster for "视觉反推" (visual reverse-engineering), shared between
// server code (src/lib/vision.ts, which also imports fs/path and must never
// be imported from a client component) and client code (GenerateBar.tsx,
// which only needs the model name for its "开始解析" diagnostics log line).
// Kept in its own zero-dependency module so the client bundle never risks
// pulling in vision.ts's Node built-ins.
//
// Tried in order: primary first, any fallback(s) after. As of 2026-07-09,
// gemini-3.1-pro-preview was confirmed live on this account (present in
// /v1/models AND a real /v1/chat/completions call returned HTTP 200 with
// reasoning_effort:"high" honored — see HANDOFF.md), so no fallback entry
// was needed. Add a second entry here if that ever stops being true; vision.ts
// will automatically try it next.
export const VISION_MODELS = ["gemini-3.1-pro-preview"];
