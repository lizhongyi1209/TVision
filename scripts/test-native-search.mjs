// Probe round 3: native-format endpoints with each vendor's OFFICIAL search
// tool — the OpenAI-compat layer dropped these (round 1), but new-api also
// proxies native Gemini (/v1beta/...:generateContent) and native Claude
// (/v1/messages), whose `tools` pass through verbatim per the docs.
import { readFileSync } from "fs";

const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const apiKey = settings.apiKey;
const Q = "最近48小时有什么重大科技新闻？给出1条并注明来源网站。今天是2026年7月15日。";

// ── Gemini native + google_search grounding ─────────────────────────────────
try {
  const res = await fetch("https://api.o1key.cn/v1beta/models/gemini-3.1-pro-preview:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: Q }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    console.log(`[gemini native] HTTP ${res.status} 非JSON: ${text.slice(0, 200)}`);
    j = null;
  }
  if (j) {
    const cand = j.candidates?.[0];
    const answer = cand?.content?.parts?.map((p) => p.text || "").join("") ?? j.error?.message ?? "";
    const gm = cand?.groundingMetadata;
    console.log(`[gemini native] HTTP ${res.status}`);
    console.log(`  groundingMetadata: ${gm ? `有 (${gm.groundingChunks?.length ?? 0} chunks, queries: ${JSON.stringify(gm.webSearchQueries ?? [])})` : "无"}`);
    console.log(`  回答: ${String(answer).slice(0, 300).replace(/\n/g, " ")}`);
    if (gm?.groundingChunks?.length) {
      gm.groundingChunks.slice(0, 3).forEach((c, i) => console.log(`  来源${i + 1}: ${c.web?.title ?? ""} | ${(c.web?.uri ?? "").slice(0, 80)}`));
    }
  }
} catch (e) {
  console.log(`[gemini native] 失败: ${e.message}`);
}

// ── Claude native /v1/messages + web_search server tool ─────────────────────
try {
  const res = await fetch("https://api.o1key.cn/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-fable-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: Q }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    console.log(`\n[claude native] HTTP ${res.status} 非JSON: ${text.slice(0, 200)}`);
    j = null;
  }
  if (j) {
    console.log(`\n[claude native] HTTP ${res.status} stop_reason: ${j.stop_reason ?? "?"}`);
    const types = (j.content ?? []).map((b) => b.type);
    console.log(`  content blocks: ${JSON.stringify(types)}`);
    const answer = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
    console.log(`  回答: ${String(answer || j.error?.message || "").slice(0, 300).replace(/\n/g, " ")}`);
  }
} catch (e) {
  console.log(`\n[claude native] 失败: ${e.message}`);
}
