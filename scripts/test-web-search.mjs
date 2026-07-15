// Probe: which native web-search shapes does the gateway pass through?
// The question needs live data — a model without search must either refuse
// or hallucinate a disclaimer; one with search returns concrete recent facts
// (and usually citation/grounding metadata we can inspect).
import { readFileSync } from "fs";

const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const apiKey = settings.apiKey;

const Q = "请联网搜索：今天是2026年7月15日，最近48小时内有什么重大科技新闻？给出1条并注明来源网站。";

async function probe(label, body) {
  try {
    const res = await fetch("https://api.o1key.cn/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      console.log(`\n[${label}] HTTP ${res.status} 非JSON: ${text.slice(0, 200)}`);
      return;
    }
    const msg = j.choices?.[0]?.message;
    const answer = msg?.content ?? j.error?.message ?? JSON.stringify(j).slice(0, 200);
    const extras = [];
    if (msg?.annotations?.length) extras.push(`annotations:${msg.annotations.length}`);
    if (msg?.tool_calls?.length) extras.push(`tool_calls:${msg.tool_calls.length}`);
    if (j.citations) extras.push(`citations:${JSON.stringify(j.citations).slice(0, 100)}`);
    console.log(`\n[${label}] HTTP ${res.status} ${extras.join(" ")}\n  ${String(answer).slice(0, 260).replace(/\n/g, " ")}`);
  } catch (e) {
    console.log(`\n[${label}] 网络失败: ${e.message}`);
  }
}

const base = (model) => ({ model, messages: [{ role: "user", content: Q }], stream: false, max_tokens: 4096 });

// 1. OpenAI: web_search_options
await probe("gpt · web_search_options", { ...base("gpt-5.6-sol"), web_search_options: {} });
// 2. OpenAI responses-style tool passthrough
await probe("gpt · tools web_search", { ...base("gpt-5.6-sol"), tools: [{ type: "web_search" }] });
// 3. Gemini: googleSearch tool (native shape passthrough)
await probe("gemini · googleSearch tool", { ...base("gemini-3.1-pro-preview"), tools: [{ googleSearch: {} }] });
// 4. Gemini: web_search_options
await probe("gemini · web_search_options", { ...base("gemini-3.1-pro-preview"), web_search_options: {} });
// 5. Claude: anthropic server tool
await probe("fable · web_search server tool", {
  ...base("claude-fable-5"),
  max_tokens: 12000,
  thinking: { type: "enabled", budget_tokens: 2048 },
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
});
// 6. control group: no search at all — baseline for comparison
await probe("gemini · 无搜索对照组", base("gemini-3.1-pro-preview"));
