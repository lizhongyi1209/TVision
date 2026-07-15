// Probe round 2: does the gateway's `file` content part accept docx / audio?
// docx: minimal hand-built zip (STORE, no compression) with a secret code.
// audio: 1-second 440Hz WAV — if the model can state anything about the
// audio (rather than erroring), passthrough works.
import { readFileSync, writeFileSync } from "fs";

const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const apiKey = settings.apiKey;

// ── minimal STORE zip (same layout as src/lib/zip.ts) ───────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf-8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const SECRET = "9317";
const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>TVISION DOCX TEST CODE ${SECRET}</w:t></w:r></w:p></w:body></w:document>`;
const docx = buildZip([
  {
    name: "[Content_Types].xml",
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
  },
  {
    name: "_rels/.rels",
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
  },
  { name: "word/document.xml", data: Buffer.from(docXml) },
]);
writeFileSync("scripts/probe.docx", docx);
console.log(`probe.docx built: ${docx.length} bytes`);

// ── 1s 440Hz mono 8kHz WAV ───────────────────────────────────────────────────
const rate = 8000;
const samples = Buffer.alloc(rate * 2);
for (let i = 0; i < rate; i++) samples.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
const wavHeader = Buffer.alloc(44);
wavHeader.write("RIFF", 0);
wavHeader.writeUInt32LE(36 + samples.length, 4);
wavHeader.write("WAVEfmt ", 8);
wavHeader.writeUInt32LE(16, 16);
wavHeader.writeUInt16LE(1, 20);
wavHeader.writeUInt16LE(1, 22);
wavHeader.writeUInt32LE(rate, 24);
wavHeader.writeUInt32LE(rate * 2, 28);
wavHeader.writeUInt16LE(2, 32);
wavHeader.writeUInt16LE(16, 34);
wavHeader.write("data", 36);
wavHeader.writeUInt32LE(samples.length, 40);
const wav = Buffer.concat([wavHeader, samples]);
console.log(`probe.wav built: ${wav.length} bytes`);

async function tryShape(label, model, content, extraBody = {}) {
  const body = { model, messages: [{ role: "user", content }], stream: false, max_tokens: 2048, ...extraBody };
  try {
    const res = await fetch("https://api.o1key.cn/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let answer = "";
    try {
      const j = JSON.parse(text);
      answer = j.choices?.[0]?.message?.content ?? j.error?.message ?? text.slice(0, 300);
    } catch {
      answer = text.slice(0, 300);
    }
    console.log(`\n[${label}] HTTP ${res.status}\n  ${String(answer).slice(0, 300).replace(/\n/g, " ")}`);
  } catch (e) {
    console.log(`\n[${label}] 网络失败: ${e.message}`);
  }
}

const docxPart = {
  type: "file",
  file: {
    filename: "probe.docx",
    file_data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docx.toString("base64")}`,
  },
};
const wavPart = { type: "file", file: { filename: "probe.wav", file_data: `data:audio/wav;base64,${wav.toString("base64")}` } };
const inputAudioPart = { type: "input_audio", input_audio: { data: wav.toString("base64"), format: "wav" } };

const Q_DOC = "文档里写了什么测试代码？只回答那串数字。";
const Q_WAV = "这段音频大概多长？内容是什么？一句话回答。";

await tryShape("gemini · docx file part", "gemini-3.1-pro-preview", [{ type: "text", text: Q_DOC }, docxPart]);
await tryShape("fable · docx file part", "claude-fable-5", [{ type: "text", text: Q_DOC }, docxPart], {
  thinking: { type: "enabled", budget_tokens: 2048 },
  max_tokens: 12000,
});
await tryShape("gemini · wav file part", "gemini-3.1-pro-preview", [{ type: "text", text: Q_WAV }, wavPart]);
await tryShape("gemini · input_audio", "gemini-3.1-pro-preview", [{ type: "text", text: Q_WAV }, inputAudioPart]);
