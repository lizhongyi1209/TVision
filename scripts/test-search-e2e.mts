// End-to-end check of the Bing fallback search flow (run with
// `node --experimental-strip-types scripts/test-search-e2e.mts`):
// query rewrite → real Bing search → inject context → model answers.
import { readFileSync } from "fs";
import { buildSearchContext, rewriteSearchQuery, webSearch } from "../src/lib/webSearch.server.ts";

const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const question = "现在比特币的价格大概是多少美元？";

let t0 = Date.now();
const rewritten = (await rewriteSearchQuery("https://api.o1key.cn", settings.apiKey, question).catch(() => "")) || question;
console.log(`查询改写 ${Date.now() - t0}ms: "${question}" → "${rewritten}"`);

t0 = Date.now();
const results = await webSearch(rewritten.slice(0, 100));
console.log(`搜索完成 ${Date.now() - t0}ms，${results.length} 条：`);
results.forEach((r, i) => console.log(`  [${i + 1}] ${r.title.slice(0, 50)} | ${r.url.slice(0, 60)}`));

const res = await fetch("https://api.o1key.cn/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
  body: JSON.stringify({
    model: "gemini-3.1-pro-preview",
    messages: [
      { role: "system", content: buildSearchContext(rewritten, results) },
      { role: "user", content: question },
    ],
    stream: false,
    max_tokens: 4096,
  }),
});
const j = await res.json();
console.log(`\nHTTP ${res.status}，回答：\n${j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 300)}`);
