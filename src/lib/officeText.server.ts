// Server-side plain-text extraction from OOXML office files (docx / xlsx /
// xlsm) so the Agent chat can feed their contents to any model as text —
// probed live: no model behind the gateway accepts these formats directly
// (see agentFiles.ts). Zero-dependency by design, mirroring zip.ts (which is
// the write-side counterpart): a minimal zip READER (EOCD → central
// directory → local entries, STORE + DEFLATE via node:zlib) plus regex-level
// XML stripping. Server-only (node:zlib).

import { inflateRawSync } from "zlib";

/** Reads all entries of a zip file into name → content. Throws on anything
 *  that isn't a plausible zip (bad EOCD / signatures). Zip64 unsupported —
 *  office files that large are rejected upstream by size caps anyway. */
export function readZip(buf: Buffer): Map<string, Buffer> {
  // EOCD is within the last 65557 bytes (22-byte record + max comment).
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip 容器");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("zip 中央目录损坏");
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");

    // Data sits after the local header, whose name/extra lengths can differ
    // from the central directory's copy — always re-read them.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** word/document.xml → plain text: paragraphs → newlines, tabs/breaks kept. */
export function docxToText(buf: Buffer): string {
  const doc = readZip(buf).get("word/document.xml");
  if (!doc) throw new Error("docx 中没有 word/document.xml");
  const text = doc
    .toString("utf-8")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

/** Concatenated <t> runs of one shared-string / inline-string item. */
function siText(xml: string): string {
  const runs = xml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
  return decodeEntities(runs.map((r) => r.replace(/<[^>]+>/g, "")).join(""));
}

/** xlsx/xlsm → tab-separated text, one block per sheet. Column gaps are not
 *  reconstructed (cells join in document order) — good enough for analysis. */
export function xlsxToText(buf: Buffer): string {
  const files = readZip(buf);

  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf-8");
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(siText(si));

  const sheetNames = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  if (!sheetNames.length) throw new Error("xlsx 中没有工作表");

  const blocks: string[] = [];
  for (const name of sheetNames) {
    const xml = files.get(name)!.toString("utf-8");
    const lines: string[] = [];
    for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
      const cells: string[] = [];
      for (const c of row.match(/<c[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const type = /(?:^|\s)t="([^"]+)"/.exec(c)?.[1];
        let v: string;
        if (type === "inlineStr") {
          v = siText(c);
        } else {
          v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1] ?? "";
          v = type === "s" ? (shared[Number(v)] ?? "") : decodeEntities(v);
        }
        cells.push(v);
      }
      if (cells.some((x) => x !== "")) lines.push(cells.join("\t"));
    }
    blocks.push(`[${name.slice("xl/worksheets/".length, -".xml".length)}]\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n").trim();
}
