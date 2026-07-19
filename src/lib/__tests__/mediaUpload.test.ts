import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPresignedUploadHeaders, detectContentType, parsePresignResult, validateMediaSignature } from "../mediaUpload.server.ts";

test("parsePresignResult supports nested result and camelCase fields", () => {
  assert.deepEqual(parsePresignResult({
    result: {
      uploadUrl: "https://upload.example.com/object",
      publicUrl: "https://cdn.example.com/object",
      method: "post",
      provider: "oss",
      headers: { "x-upload-token": "token" },
    },
  }), {
    uploadUrl: "https://upload.example.com/object",
    publicUrl: "https://cdn.example.com/object",
    method: "POST",
    provider: "oss",
    headers: { "x-upload-token": "token" },
  });
});

test("local uploads receive Bearer auth and preserve presign headers", () => {
  const presign = parsePresignResult({
    data: {
      upload_url: "https://api.example.com/upload",
      public_url: "https://cdn.example.com/file.mp4",
      provider: "local",
      headers: { "x-custom": "yes" },
    },
  });
  assert.deepEqual(buildPresignedUploadHeaders(presign, "video/mp4", "secret"), {
    "x-custom": "yes",
    "Content-Type": "video/mp4",
    Authorization: "Bearer secret",
  });
});

test("R2 uploads never receive an Authorization header", () => {
  const presign = parsePresignResult({
    upload_url: "https://r2.example.com/upload?signature=x",
    public_url: "https://cdn.example.com/file.wav",
    headers: { "Content-Type": "audio/wav", Authorization: "must-be-removed" },
  });
  assert.deepEqual(buildPresignedUploadHeaders(presign, "audio/wav", "secret"), {
    "Content-Type": "audio/wav",
  });
});

test("media signature validation rejects a renamed arbitrary file", () => {
  assert.throws(() => validateMediaSignature(Buffer.from("not an mp4"), "video/mp4"), /内容与声明格式不一致/);
  assert.doesNotThrow(() => validateMediaSignature(
    Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    "video/mp4",
  ));
});

test("detectContentType sniffs the real format of mislabeled files", () => {
  // 实测场景：生成图下载件命名为 .png，内容实为 JPEG（ffd8ffe0...4a464946）
  assert.equal(detectContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])), "image/jpeg");
  assert.equal(detectContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  // mediabunny 裁剪产物：ftyp + isom brand
  assert.equal(detectContentType(Buffer.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])), "video/mp4");
  // HEIC 同为 ftyp，但 brand 是 heic
  assert.equal(detectContentType(Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), "image/heic");
  assert.equal(detectContentType(Buffer.from("random garbage")), null);
});
