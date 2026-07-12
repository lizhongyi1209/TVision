// Hand-rolled ZIP builder for the batch workshop's "打包下载" (PLAN-BATCH
// D10). STORE method only (no compression — the payload is PNG/JPEG files
// that are already compressed), which keeps this a dependency-free ~150
// lines: per-file local headers, a central directory, and the end-of-
// central-directory record, per the PKWARE APPNOTE layout. File names are
// written as UTF-8 with general-purpose flag bit 11 set, so Chinese names
// like "红色连衣裙-模特1.png" display correctly in Windows Explorer (which
// otherwise assumes the legacy OEM code page). Server-only by convention
// (Buffer), used by /api/batch/export.

export interface ZipEntry {
  /** File name inside the archive (may contain non-ASCII; must not contain
   *  path separators — the caller sanitizes). */
  name: string;
  data: Buffer;
}

// Standard CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320), table-driven.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** General-purpose bit 11: file name is UTF-8 encoded. */
const FLAG_UTF8 = 0x0800;
/** "version needed to extract" 2.0 — STORE with no fancy features. */
const VERSION = 20;
/** MS-DOS date/time fields pinned to a fixed valid value (1980-01-01 00:00,
 *  the format's epoch) — archive contents are what matter here, and a
 *  deterministic timestamp keeps output byte-stable for the unit tests. */
const DOS_TIME = 0;
const DOS_DATE = 0x21;

export function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf-8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size == raw size for STORE
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBytes, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(VERSION, 4); // version made by
    central.writeUInt16LE(VERSION, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10); // method: STORE
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra/comment lengths, disk number, internal/external attrs all zero
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // entries total
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
