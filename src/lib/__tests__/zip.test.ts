import assert from "node:assert/strict";
import { test } from "node:test";
import { buildZip, crc32 } from "../zip.ts";

test("zip: single-file archive has the local/central/EOCD signatures in order", () => {
  const data = Buffer.from("hello zip");
  const zip = buildZip([{ name: "a.txt", data }]);

  // Local file header at offset 0.
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  // CRC + sizes recorded for STORE.
  assert.equal(zip.readUInt32LE(14), crc32(data));
  assert.equal(zip.readUInt32LE(18), data.length);
  // Raw bytes stored verbatim right after header + name.
  const nameLen = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30 + nameLen, 30 + nameLen + data.length).toString(), "hello zip");
  // Central directory then EOCD close out the file.
  const eocdOffset = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocdOffset), 0x06054b50);
  const centralOffset = zip.readUInt32LE(eocdOffset + 16);
  assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50);
});

test("zip: multi-file archive counts every entry in the central directory", () => {
  const entries = [
    { name: "one.png", data: Buffer.from([1, 2, 3]) },
    { name: "two.png", data: Buffer.from([4, 5]) },
    { name: "three.png", data: Buffer.from([6]) },
  ];
  const zip = buildZip(entries);
  const eocdOffset = zip.length - 22;
  assert.equal(zip.readUInt16LE(eocdOffset + 8), 3); // entries on disk
  assert.equal(zip.readUInt16LE(eocdOffset + 10), 3); // entries total

  // Walk the central directory: each record points back at a valid local header.
  let p = zip.readUInt32LE(eocdOffset + 16);
  for (let i = 0; i < 3; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    const nameLen = zip.readUInt16LE(p + 28);
    const localOffset = zip.readUInt32LE(p + 42);
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
    p += 46 + nameLen;
  }
});

test("zip: Chinese file names are UTF-8 encoded with flag bit 11 set", () => {
  const name = "红色连衣裙-模特1.png";
  const zip = buildZip([{ name, data: Buffer.from([0x89, 0x50]) }]);

  // Local header: UTF-8 flag on, name bytes match a UTF-8 encode.
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
  const nameBytes = Buffer.from(name, "utf-8");
  assert.equal(zip.readUInt16LE(26), nameBytes.length);
  assert.deepEqual(zip.subarray(30, 30 + nameBytes.length), nameBytes);

  // Central directory record carries the same flag.
  const eocdOffset = zip.length - 22;
  const centralOffset = zip.readUInt32LE(eocdOffset + 16);
  assert.equal(zip.readUInt16LE(centralOffset + 8) & 0x0800, 0x0800);
});

test("zip: crc32 matches the well-known reference value", () => {
  // "123456789" -> 0xCBF43926 is the canonical CRC-32 check vector.
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});
