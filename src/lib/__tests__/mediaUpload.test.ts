import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPresignedUploadHeaders, parsePresignResult, validateMediaSignature } from "../mediaUpload.server.ts";

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
