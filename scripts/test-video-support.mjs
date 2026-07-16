// Probe: which video-attachment shapes does the gateway actually accept?
// The ComfyUI o1key plugin (nodes/universal_llm.py) sends video through the
// OpenAI-compat layer as an `image_url` part with a data:video/mp4 URL and
// claims "Gemini OpenAI 兼容层支持此格式"; its native Gemini client
// (clients/gemini_flash_client.py) uses inline_data parts instead. Verify
// both against our gateway before wiring video into the Agent composer.
//
// Usage: node scripts/test-video-support.mjs <path-to-small-mp4>
import { readFileSync } from "fs";

const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const apiKey = settings.apiKey;
const BASE = "https://api.o1key.cn";

const videoPath = process.argv[2];
if (!videoPath) {
  console.error("用法: node scripts/test-video-support.mjs <小视频.mp4>");
  process.exit(1);
}
const video = readFileSync(videoPath);
const b64 = video.toString("base64");
console.log(`视频: ${videoPath} (${(video.length / 1024).toFixed(0)}KB)`);

const PROMPT =
  "请描述这个视频的画面内容（一两句话）。如果你没有收到任何视频/影像内容，只回答 NOVIDEO。";

async function probe(label, url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let answer = "";
    try {
      const j = JSON.parse(text);
      answer =
        j.choices?.[0]?.message?.content ??
        j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
        j.error?.message ??
        text.slice(0, 300);
    } catch {
      answer = text.slice(0, 300);
    }
    const noVideo = String(answer).includes("NOVIDEO");
    console.log(
      `\n[${label}] HTTP ${res.status} ${res.ok && !noVideo ? "✅ 模型看到了视频" : "❌"}\n  ${String(answer).slice(0, 400).replace(/\n/g, " ")}`,
    );
  } catch (e) {
    console.log(`\n[${label}] 网络失败: ${e.message}`);
  }
}

const GEMINI = "gemini-3.1-pro-preview";

// A. compat 层 · image_url 塞 video data URL（插件 universal_llm.py 的传法）
await probe(`${GEMINI} · compat image_url(video)`, `${BASE}/v1/chat/completions`, {
  model: GEMINI,
  stream: false,
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:video/mp4;base64,${b64}` } },
      ],
    },
  ],
});

// B. compat 层 · file part（PDF 走通的那个 shape，换成视频 MIME）
await probe(`${GEMINI} · compat file part`, `${BASE}/v1/chat/completions`, {
  model: GEMINI,
  stream: false,
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "file", file: { filename: "probe.mp4", file_data: `data:video/mp4;base64,${b64}` } },
      ],
    },
  ],
});

// C. native Gemini 端点 · inline_data（联网搜索路径用的端点family）
await probe(`${GEMINI} · native inline_data`, `${BASE}/v1beta/models/${GEMINI}:generateContent`, {
  contents: [
    {
      parts: [{ text: PROMPT }, { inline_data: { mime_type: "video/mp4", data: b64 } }],
    },
  ],
});
