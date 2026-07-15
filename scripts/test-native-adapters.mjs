// Live test of the three native-search stream adapters — exercises the exact
// code the route runs (transpiled copy in .tmp-adapters/).
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { adaptNativeStream, buildNativeSearchRequest } = require("../.tmp-adapters/agentNativeSearch.server.js");

const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const Q = "OpenAI 最近一周有什么新发布？一句话概括即可。";
const messages = [{ role: "user", content: Q }];

const CASES = [
  { provider: "gemini", model: "gemini-3.1-pro-preview" },
  { provider: "claude", model: "claude-fable-5" },
  { provider: "openai", model: "gpt-5.6-sol" },
];

for (const { provider, model } of CASES) {
  const t0 = Date.now();
  const req = buildNativeSearchRequest(provider, "https://api.o1key.cn", settings.apiKey, model, messages, "low");
  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok || !res.body) {
      console.log(`\n[${provider}] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    let content = "";
    let reasoning = 0;
    let search = null;
    let frames = 0;
    await adaptNativeStream(provider, res.body, (frame) => {
      frames++;
      const d = frame.choices?.[0]?.delta;
      if (d?.content) content += d.content;
      if (d?.reasoning_content) reasoning += d.reasoning_content.length;
      if (frame.tv_search) search = frame.tv_search;
    });
    console.log(`\n[${provider}] ${((Date.now() - t0) / 1000).toFixed(1)}s, ${frames} frames, reasoning ${reasoning} chars`);
    console.log(`  搜索: ${search ? `"${String(search.query).slice(0, 80)}" · ${search.results.length} 来源` : "无 tv_search"}`);
    console.log(`  回答: ${content.slice(0, 220).replace(/\n/g, " ")}`);
  } catch (e) {
    console.log(`\n[${provider}] 失败: ${e.message}`);
  }
}
