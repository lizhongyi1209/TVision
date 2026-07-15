// Regression tests for the office-file text extraction behind the Agent
// chat's /api/agent/extract. The STORE-zip cases are built with zip.ts (the
// repo's writer — cross-validates both sides); the DEFLATE case is
// hand-crafted because real Word/Excel files compress their XML parts, so
// the inflateRawSync path is the one production actually hits.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { buildZip, crc32 } from "../zip.ts";
import { docxToText, readZip, xlsxToText } from "../officeText.server.ts";

function docxZip(documentXml: string): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "word/document.xml", data: Buffer.from(documentXml) },
  ]);
}

/** Single-entry zip whose data is DEFLATE-compressed (method 8). */
function deflatedZip(name: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(name, "utf-8");
  const comp = deflateRawSync(content);
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // DEFLATE
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(content.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdFull = Buffer.concat([cd, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdFull.length, 12);
  eocd.writeUInt32LE(30 + nameBuf.length + comp.length, 16);
  return Buffer.concat([local, nameBuf, comp, cdFull, eocd]);
}

test("readZip roundtrips zip.ts STORE output", () => {
  const files = readZip(
    buildZip([
      { name: "a.txt", data: Buffer.from("hello") },
      { name: "中文名.txt", data: Buffer.from("你好") },
    ]),
  );
  assert.equal(files.get("a.txt")?.toString(), "hello");
  assert.equal(files.get("中文名.txt")?.toString(), "你好");
});

test("readZip inflates DEFLATE entries", () => {
  const content = Buffer.from("compressed body 压缩正文".repeat(50));
  const files = readZip(deflatedZip("word/document.xml", content));
  assert.deepEqual(files.get("word/document.xml"), content);
});

test("docxToText: paragraphs, tabs, entities", () => {
  const xml =
    `<w:document><w:body>` +
    `<w:p><w:r><w:t>第一段 &amp; &#x4F60;好</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/><w:t>B</w:t></w:r></w:p>` +
    `</w:body></w:document>`;
  assert.equal(docxToText(docxZip(xml)), "第一段 & 你好\nA\tB");
});

test("docxToText throws without word/document.xml", () => {
  const zip = buildZip([{ name: "other.xml", data: Buffer.from("<a/>") }]);
  assert.throws(() => docxToText(zip));
});

test("xlsxToText: shared strings, inline strings and numbers as TSV", () => {
  const shared =
    `<sst><si><t>名称</t></si><si><r><t>拼</t></r><r><t>接</t></r></si></sst>`;
  const sheet =
    `<worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    `<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="inlineStr"><is><t>直写</t></is></c></row>` +
    `</sheetData></worksheet>`;
  const zip = buildZip([
    { name: "xl/sharedStrings.xml", data: Buffer.from(shared) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
  ]);
  assert.equal(xlsxToText(zip), "[sheet1]\n名称\t拼接\n42\t直写");
});
