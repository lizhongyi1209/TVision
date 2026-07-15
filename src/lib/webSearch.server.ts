// Server-side web search for the Agent chat's "联网搜索" toggle. Scrapes
// Bing's HTML results (probed live from this machine: fast, direct-reachable,
// stable `b_algo` markup, real target URLs — DuckDuckGo unreachable, Baidu
// only returns opaque redirect links; see scripts/test-search-engines.mjs).
// No native search shape passes through the upstream gateway (see
// scripts/test-web-search.mjs), so search-then-answer on our side is the only
// working path — and it works uniformly for every model.

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SEARCH_TIMEOUT_MS = 12_000;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Top organic Bing results for `query`. Throws on network failure or when
 *  the page yields nothing parseable (markup change / block page). */
export async function webSearch(query: string, count = 6): Promise<WebSearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-CN`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`搜索请求失败 (HTTP ${res.status})`);
  const html = await res.text();

  const out: WebSearchResult[] = [];
  // One <li class="b_algo"> block per organic hit; title/link in its h2>a,
  // snippet in the first following <p>.
  const blocks = html.split(/<li class="b_algo[^"]*"/).slice(1);
  for (const block of blocks) {
    const link = /<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const href = stripTags(link[1]);
    if (!/^https?:\/\//.test(href)) continue;
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    out.push({
      title: stripTags(link[2]).slice(0, 120),
      url: href,
      snippet: snippet ? stripTags(snippet[1]).slice(0, 320) : "",
    });
    if (out.length >= count) break;
  }
  if (!out.length) throw new Error("搜索结果解析失败");
  return out;
}

/** Rewrites the user's question into concise search keywords via a quick
 *  low-effort model call — raw questions match poorly ("现在比特币价格…"
 *  keyword-matches Beijing-time sites on "现在"). Returns "" on any failure
 *  or implausible output; the caller falls back to the raw question. */
export async function rewriteSearchQuery(baseUrl: string, apiKey: string, question: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      reasoning_effort: "low",
      stream: false,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content:
            "你是搜索查询生成器。把用户的问题改写成一条适合搜索引擎的简洁查询词：保留关键实体和意图，去掉口语、疑问词和时间副词。只输出查询词本身，不要引号，不要解释。",
        },
        { role: "user", content: question },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return "";
  const j = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const q = j?.choices?.[0]?.message?.content?.trim().replace(/^["'「『]|["'」』]$/g, "") ?? "";
  return q && q.length <= 80 && !q.includes("\n") ? q : "";
}

/** Context block injected as a system message ahead of the user's question. */
export function buildSearchContext(query: string, results: WebSearchResult[]): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const items = results
    .map((r, i) => `[${i + 1}] ${r.title}\n来源: ${r.url}${r.snippet ? `\n摘要: ${r.snippet}` : ""}`)
    .join("\n\n");
  return `以下是刚刚（${stamp}）针对用户最新问题的联网搜索结果：\n\n${items}\n\n请优先基于以上搜索结果回答用户的最新问题，引用某条结果时标注其编号（如 [1]）。若搜索结果与问题无关或不足以回答，请说明这一点，再依据自身知识谨慎补充。`;
}
