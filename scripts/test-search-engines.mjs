// Probe: which search backend is reachable from this machine via Node's
// native fetch (no proxy — same as the production Next.js runtime) and
// yields parseable results?
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function probe(label, url, parser) {
  try {
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    const results = parser(html);
    console.log(`\n[${label}] HTTP ${res.status} ${Date.now() - t0}ms, html ${(html.length / 1024).toFixed(0)}KB, 解析出 ${results.length} 条`);
    results.slice(0, 3).forEach((r, i) => console.log(`  ${i + 1}. ${r.title.slice(0, 60)} | ${r.url.slice(0, 70)}`));
  } catch (e) {
    console.log(`\n[${label}] 失败: ${e.message}`);
  }
}

const Q = encodeURIComponent("量子计算 最新进展");

// Bing (国内可达版)
await probe("bing.com/search", `https://www.bing.com/search?q=${Q}&mkt=zh-CN`, (html) => {
  const out = [];
  const re = /<li class="b_algo[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) out.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, "") });
  return out;
});

await probe("cn.bing.com/search", `https://cn.bing.com/search?q=${Q}`, (html) => {
  const out = [];
  const re = /<li class="b_algo[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) out.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, "") });
  return out;
});

// DuckDuckGo html 版
await probe("html.duckduckgo.com", `https://html.duckduckgo.com/html/?q=${Q}`, (html) => {
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) out.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, "") });
  return out;
});

// 百度
await probe("baidu.com/s", `https://www.baidu.com/s?wd=${Q}`, (html) => {
  const out = [];
  const re = /<h3[^>]*class="[^"]*t[^"]*"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) out.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, "") });
  return out;
});
