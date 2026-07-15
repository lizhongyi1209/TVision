// One-off diagnostic: replay the exact upstream request the Agent chat route
// makes (/v1/chat/completions, stream:true) and report whether the full
// answer arrives — used to decide if truncation is upstream or in the page.
import { readFileSync } from "fs";

const IMAGE = String.raw`C:\Users\Jony.li\Downloads\ComfyUI_00005_ (1).png`;
const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const apiKey = settings.apiKey;
if (!apiKey) {
  console.error("no apiKey in data/settings.json");
  process.exit(1);
}

const b64 = readFileSync(IMAGE).toString("base64");
const dataUrl = `data:image/png;base64,${b64}`;
console.log(`image loaded: ${(b64.length / 1024).toFixed(0)} KB base64`);

const body = {
  model: "gemini-3.1-pro-preview",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "用100字描述该图片" },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ],
  stream: true,
  max_tokens: 8192,
  reasoning_effort: "high",
};

const t0 = Date.now();
const res = await fetch("https://api.o1key.cn/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body),
});
console.log(`HTTP ${res.status} (${Date.now() - t0}ms to headers)`);
if (!res.ok) {
  console.log(await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
let content = "";
let reasoning = "";
let finishReason = null;
let usage = null;
let chunkCount = 0;
const rawTail = [];

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    rawTail.push(payload.length > 300 ? payload.slice(0, 300) + "…" : payload);
    if (rawTail.length > 6) rawTail.shift();
    if (payload === "[DONE]") continue;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      console.log("!! malformed chunk:", payload.slice(0, 200));
      continue;
    }
    chunkCount++;
    const d = json.choices?.[0]?.delta;
    if (typeof d?.reasoning_content === "string") reasoning += d.reasoning_content;
    if (typeof d?.content === "string") content += d.content;
    if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
    if (json.usage) usage = json.usage;
  }
}

console.log(`\n=== done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${chunkCount} chunks ===`);
console.log(`finish_reason: ${finishReason}`);
console.log(`usage: ${JSON.stringify(usage)}`);
console.log(`reasoning length: ${reasoning.length} chars`);
console.log(`content length: ${content.length} chars`);
console.log(`\n--- content ---\n${content}`);
console.log(`\n--- last SSE frames ---`);
for (const f of rawTail) console.log(f);
