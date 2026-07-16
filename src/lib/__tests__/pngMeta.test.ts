import assert from "node:assert/strict";
import { test } from "node:test";
import zlib from "node:zlib";
import {
  embedImageText,
  embedJpegComment,
  embedPngText,
  extractImageText,
  extractJpegComment,
  extractPngText,
  isPng,
  PNG_META_KEYWORD,
} from "../pngMeta.ts";

// A real minimal PNG (1×1 opaque pixel) built chunk-by-chunk, so the tests
// exercise the same structure production files have: sig + IHDR + IDAT + IEND.
function crc(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, crcBuf]);
}
function tinyPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const raw = Buffer.from([0, 255, 0, 0]); // filter byte + 1 RGB pixel
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("pngMeta: embed → extract round-trips UTF-8 JSON with Chinese text", () => {
  const meta = JSON.stringify({ tvision: 1, prompt: "把模特的上衣换成红色旗袍 ✅", model: "Nano Banana Pro" });
  const out = embedPngText(new Uint8Array(tinyPng()), PNG_META_KEYWORD, meta);
  assert.ok(isPng(out));
  assert.equal(extractPngText(out, PNG_META_KEYWORD), meta);
});

test("pngMeta: embedded file is still a structurally valid PNG (chunk walk reaches IEND)", () => {
  const out = embedPngText(new Uint8Array(tinyPng()), PNG_META_KEYWORD, "{}");
  let off = 8;
  const types: string[] = [];
  while (off + 12 <= out.length) {
    const len = ((out[off] << 24) | (out[off + 1] << 16) | (out[off + 2] << 8) | out[off + 3]) >>> 0;
    types.push(Buffer.from(out.subarray(off + 4, off + 8)).toString("ascii"));
    off += 12 + len;
  }
  assert.deepEqual(types, ["IHDR", "iTXt", "IDAT", "IEND"]);
  assert.equal(off, out.length);
});

test("pngMeta: extract returns null for missing keyword / non-PNG / truncated input", () => {
  assert.equal(extractPngText(new Uint8Array(tinyPng()), PNG_META_KEYWORD), null);
  assert.equal(extractPngText(new Uint8Array([1, 2, 3]), PNG_META_KEYWORD), null);
  const out = embedPngText(new Uint8Array(tinyPng()), PNG_META_KEYWORD, "{}");
  assert.equal(extractPngText(out.subarray(0, 40), PNG_META_KEYWORD), null);
});

test("pngMeta: pooled-Buffer offsets don't corrupt reads (nonzero byteOffset)", () => {
  const png = tinyPng();
  // Simulate Buffer pooling: place the PNG at a nonzero offset in a bigger buffer.
  const pool = Buffer.alloc(png.length + 7);
  png.copy(pool, 7);
  const view = new Uint8Array(pool.buffer, pool.byteOffset + 7, png.length);
  const out = embedPngText(view, PNG_META_KEYWORD, '{"a":1}');
  assert.equal(extractPngText(out, PNG_META_KEYWORD), '{"a":1}');
});

test("pngMeta: non-PNG bytes pass through embed untouched", () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal(embedPngText(jpg, PNG_META_KEYWORD, "{}"), jpg);
});

// A minimal structurally-plausible JPEG: SOI + APP0(JFIF) + SOS + EOI.
function tinyJpeg(): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00]; // len 7: "JFIF\0"
  return new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9]);
}

test("jpegMeta: embed → extract round-trips UTF-8 JSON with Chinese text", () => {
  const meta = JSON.stringify({ tvision: 1, prompt: "把背景换成雪山日出 🏔" });
  const out = embedJpegComment(tinyJpeg(), PNG_META_KEYWORD, meta);
  assert.equal(extractJpegComment(out, PNG_META_KEYWORD), meta);
  // COM lands right after SOI and the rest of the file is untouched.
  assert.deepEqual([out[0], out[1], out[2], out[3]], [0xff, 0xd8, 0xff, 0xfe]);
  assert.deepEqual([...out.subarray(out.length - 2)], [0xff, 0xd9]);
});

test("jpegMeta: foreign COM segments are skipped, ours found after them", () => {
  const foreign = new TextEncoder().encode("some encoder note");
  const withForeign = embedJpegComment(tinyJpeg(), "", ""); // keyword "" → "\0" payload only
  // simpler: hand-roll a foreign COM after SOI, then embed ours after it
  const base = tinyJpeg();
  const seg = new Uint8Array([0xff, 0xfe, (foreign.length + 2) >> 8, (foreign.length + 2) & 0xff, ...foreign]);
  const jpg = new Uint8Array([0xff, 0xd8, ...seg, ...base.subarray(2)]);
  const out = embedJpegComment(jpg, PNG_META_KEYWORD, '{"a":1}');
  assert.equal(extractJpegComment(out, PNG_META_KEYWORD), '{"a":1}');
  void withForeign;
});

test("jpegMeta: extract returns null when absent / not a JPEG", () => {
  assert.equal(extractJpegComment(tinyJpeg(), PNG_META_KEYWORD), null);
  assert.equal(extractJpegComment(new Uint8Array([1, 2, 3, 4]), PNG_META_KEYWORD), null);
});

test("imageText: sniffing entry points route PNG and JPEG correctly", () => {
  const pngOut = embedImageText(new Uint8Array(tinyPng()), PNG_META_KEYWORD, '{"p":1}');
  const jpgOut = embedImageText(tinyJpeg(), PNG_META_KEYWORD, '{"j":1}');
  assert.equal(extractImageText(pngOut, PNG_META_KEYWORD), '{"p":1}');
  assert.equal(extractImageText(jpgOut, PNG_META_KEYWORD), '{"j":1}');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(embedImageText(webp, PNG_META_KEYWORD, "{}"), webp);
  assert.equal(extractImageText(webp, PNG_META_KEYWORD), null);
});
