// Probe: which file-attachment shapes does the upstream /v1/chat/completions
// gateway actually accept? Sends a hand-crafted one-page PDF containing a
// secret code and checks whether the model can read it back.
import { readFileSync, writeFileSync } from "fs";

const settings = JSON.parse(readFileSync("data/settings.json", "utf-8"));
const apiKey = settings.apiKey;

// ── Build a minimal valid PDF with the secret code ──────────────────────────
function buildPdf(text) {
  const objs = [];
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`;
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`;
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objs[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let out = `%PDF-1.4\n`;
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const SECRET = "7742";
const pdf = buildPdf(`TVISION PDF TEST CODE ${SECRET}`);
writeFileSync("scripts/probe.pdf", pdf);
const pdfB64 = pdf.toString("base64");
console.log(`probe.pdf built: ${pdf.length} bytes`);

const PROMPT = "这个PDF文件里写了什么测试代码？只回答那串数字。";

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
      answer = j.choices?.[0]?.message?.content ?? j.error?.message ?? text.slice(0, 200);
    } catch {
      answer = text.slice(0, 200);
    }
    const hit = String(answer).includes(SECRET);
    console.log(`\n[${label}] HTTP ${res.status} ${hit ? "✅ 读到暗号" : "❌"}\n  ${String(answer).slice(0, 300).replace(/\n/g, " ")}`);
    return hit;
  } catch (e) {
    console.log(`\n[${label}] 网络失败: ${e.message}`);
    return false;
  }
}

// Shape A: OpenAI-style `file` content part (inline base64 data URL)
const shapeFile = [
  { type: "text", text: PROMPT },
  { type: "file", file: { filename: "probe.pdf", file_data: `data:application/pdf;base64,${pdfB64}` } },
];
// Shape B: PDF stuffed into image_url (some gateways route this to Gemini/Claude document input)
const shapeImageUrl = [
  { type: "text", text: PROMPT },
  { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfB64}` } },
];

for (const model of ["gemini-3.1-pro-preview", "gpt-5.6-sol"]) {
  await tryShape(`${model} · file part`, model, shapeFile);
  await tryShape(`${model} · image_url`, model, shapeImageUrl);
}
// claude-fable-5 needs the thinking body instead of reasoning_effort
await tryShape("claude-fable-5 · file part", "claude-fable-5", shapeFile, {
  thinking: { type: "enabled", budget_tokens: 2048 },
  max_tokens: 12000,
});
await tryShape("claude-fable-5 · image_url", "claude-fable-5", shapeImageUrl, {
  thinking: { type: "enabled", budget_tokens: 2048 },
  max_tokens: 12000,
});
