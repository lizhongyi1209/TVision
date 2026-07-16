// 一次性回填：把 output/ 里已有的生成图补上内嵌参数（PNG iTXt / JPEG COM）。
// 参数来自 data/history-meta.json 侧写（按 job id 对应）。幂等：已带 TVision
// 元数据的文件跳过。用法：node --experimental-strip-types scripts/retro-embed-meta.mjs
import { promises as fs } from "fs";
import path from "path";
import { embedImageText, extractImageText, PNG_META_KEYWORD } from "../src/lib/pngMeta.ts";
import { buildEmbeddedMeta } from "../src/lib/templates.ts";

const ROOT = path.join(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "output");

const metaMap = JSON.parse(await fs.readFile(path.join(ROOT, "data", "history-meta.json"), "utf-8"));
const jobIdForFile = (name) => name.replace(/\.(png|jpe?g|webp)$/i, "").replace(/_\d+$/, "");

let done = 0, skipped = 0, noMeta = 0;
for (const f of await fs.readdir(OUTPUT)) {
  if (!/\.(png|jpe?g)$/i.test(f)) continue;
  const meta = metaMap[jobIdForFile(f)];
  if (!meta) { noMeta++; continue; }
  const file = path.join(OUTPUT, f);
  const bytes = new Uint8Array(await fs.readFile(file));
  if (extractImageText(bytes, PNG_META_KEYWORD)) { skipped++; continue; }
  const out = embedImageText(bytes, PNG_META_KEYWORD, JSON.stringify(buildEmbeddedMeta(meta)));
  if (out === bytes) { skipped++; continue; }
  await fs.writeFile(file, out);
  console.log(`✅ ${f}`);
  done++;
}
console.log(`回填 ${done} 张，已有跳过 ${skipped} 张，无侧写参数 ${noMeta} 张`);
