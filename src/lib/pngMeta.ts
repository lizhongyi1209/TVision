// Image metadata embed/extract — how generated images carry their own
// generation params (PLAN-TEMPLATE). PNG gets an iTXt chunk (not tEXt: the
// payload is UTF-8 JSON with Chinese prompts, tEXt is latin-1 only per the
// spec); JPEG — what the o1key gateway actually returns most of the time —
// gets a COM (0xFFFE) segment right after SOI carrying the same
// "keyword \0 json" payload. Deliberately isomorphic (Uint8Array +
// TextEncoder only, no Buffer API): the server save path (api/jobs/[id])
// embeds at download time, and Stage/RefSlot extract in the browser when the
// image is dropped back in. Callers should use the format-sniffing
// embedImageText/extractImageText entry points at the bottom.

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Keyword of the iTXt chunk holding TVision generation params. */
export const PNG_META_KEYWORD = "TVision";

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_SIG.every((b, i) => bytes[i] === b);
}

// Manual big-endian read — `bytes` can be a pooled Node Buffer whose
// byteOffset into the shared ArrayBuffer is nonzero, so DataView on
// bytes.buffer would silently read the wrong region.
function readU32(bytes: Uint8Array, off: number): number {
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
}

function writeU32(bytes: Uint8Array, off: number, v: number): void {
  bytes[off] = (v >>> 24) & 0xff;
  bytes[off + 1] = (v >>> 16) & 0xff;
  bytes[off + 2] = (v >>> 8) & 0xff;
  bytes[off + 3] = v & 0xff;
}

/** Insert an uncompressed iTXt chunk right after IHDR (always the first
 *  chunk per spec). Non-PNG input is returned untouched — the caller treats
 *  embedding as best-effort. */
export function embedPngText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  if (!isPng(png)) return png;
  const enc = new TextEncoder();
  const kw = enc.encode(keyword);
  const txt = enc.encode(text);
  // iTXt layout: keyword \0 compressionFlag(0) compressionMethod(0)
  //              languageTag \0 translatedKeyword \0 text
  const data = new Uint8Array(kw.length + 5 + txt.length); // 5 = the \0s + flags above
  data.set(kw, 0);
  data.set(txt, kw.length + 5);
  const chunk = new Uint8Array(12 + data.length);
  writeU32(chunk, 0, data.length);
  chunk.set(enc.encode("iTXt"), 4);
  chunk.set(data, 8);
  writeU32(chunk, 8 + data.length, crc32(chunk, 4, 8 + data.length));

  const ihdrEnd = 8 + 12 + readU32(png, 8); // sig + (len+type+crc) + IHDR data length
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** Read back the text of the first iTXt/tEXt chunk with the given keyword,
 *  or null when absent / not a PNG / malformed. */
export function extractPngText(png: Uint8Array, keyword: string): string | null {
  if (!isPng(png)) return null;
  const dec = new TextDecoder();
  let off = 8;
  while (off + 12 <= png.length) {
    const len = readU32(png, off);
    const type = dec.decode(png.subarray(off + 4, off + 8));
    const dataStart = off + 8;
    if (dataStart + len > png.length) return null; // truncated file
    if (type === "iTXt" || type === "tEXt") {
      const data = png.subarray(dataStart, dataStart + len);
      const nul = data.indexOf(0);
      if (nul > 0 && dec.decode(data.subarray(0, nul)) === keyword) {
        if (type === "tEXt") return dec.decode(data.subarray(nul + 1));
        if (data[nul + 1] !== 0) return null; // compressed iTXt — we never write this
        const langEnd = data.indexOf(0, nul + 3);
        if (langEnd < 0) return null;
        const trEnd = data.indexOf(0, langEnd + 1);
        if (trEnd < 0) return null;
        return dec.decode(data.subarray(trEnd + 1));
      }
    }
    if (type === "IEND") break;
    off = dataStart + len + 4;
  }
  return null;
}

// ── JPEG COM segment ─────────────────────────────────────────────────────────
// The gateway returns most results as JPEG, so PNG-only embedding silently
// covers almost nothing in practice (2026-07-16 feedback: output/*.jpg dropped
// back in didn't restore params). A COM segment (marker 0xFFFE) is the JPEG
// analogue of a text chunk: pure comment bytes, ignored by decoders, 64KB max
// payload — plenty for params JSON. Payload is "keyword \0 json" so extraction
// can tell ours apart from encoder-injected comments.

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Insert a COM segment right after SOI (before APPn/quant tables — decoders
 *  don't care about ordering of non-marker segments). Non-JPEG input returns
 *  untouched; oversize payloads (>64KB, impossible for our params) too. */
export function embedJpegComment(jpg: Uint8Array, keyword: string, text: string): Uint8Array {
  if (!isJpeg(jpg)) return jpg;
  const enc = new TextEncoder();
  const payload = new Uint8Array([...enc.encode(keyword), 0, ...enc.encode(text)]);
  const segLen = payload.length + 2; // length field counts itself
  if (segLen > 0xffff) return jpg;
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xfe; // COM
  seg[2] = (segLen >>> 8) & 0xff;
  seg[3] = segLen & 0xff;
  seg.set(payload, 4);
  const out = new Uint8Array(jpg.length + seg.length);
  out.set(jpg.subarray(0, 2), 0); // SOI
  out.set(seg, 2);
  out.set(jpg.subarray(2), 2 + seg.length);
  return out;
}

/** Walk marker segments until SOS looking for our COM; null when absent. */
export function extractJpegComment(jpg: Uint8Array, keyword: string): string | null {
  if (!isJpeg(jpg)) return null;
  const dec = new TextDecoder();
  const kw = new TextEncoder().encode(keyword);
  let off = 2;
  while (off + 4 <= jpg.length) {
    if (jpg[off] !== 0xff) return null; // lost sync — bail
    const marker = jpg[off + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2; // standalone markers have no length field
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // SOS/EOI: no more metadata segments
    const len = (jpg[off + 2] << 8) | jpg[off + 3];
    if (len < 2 || off + 2 + len > jpg.length) return null;
    if (marker === 0xfe) {
      const data = jpg.subarray(off + 4, off + 2 + len);
      if (data.length > kw.length && data[kw.length] === 0 && kw.every((b, i) => data[i] === b)) {
        return dec.decode(data.subarray(kw.length + 1));
      }
    }
    off += 2 + len;
  }
  return null;
}

// ── Format-sniffing entry points ─────────────────────────────────────────────

export function embedImageText(bytes: Uint8Array, keyword: string, text: string): Uint8Array {
  if (isPng(bytes)) return embedPngText(bytes, keyword, text);
  if (isJpeg(bytes)) return embedJpegComment(bytes, keyword, text);
  return bytes; // webp etc. — best-effort, skip
}

export function extractImageText(bytes: Uint8Array, keyword: string): string | null {
  if (isPng(bytes)) return extractPngText(bytes, keyword);
  if (isJpeg(bytes)) return extractJpegComment(bytes, keyword);
  return null;
}
