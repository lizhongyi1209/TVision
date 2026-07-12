import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModelId, buildGptImageSubmitBody, extractResultImages, resolveGptImageSize } from "../o1key.ts";
import { comboError } from "../models.ts";

// ── buildModelId ─────────────────────────────────────────────────────────────

test("buildModelId: GPT Image 2 特价 -> gpt-image-2-c", () => {
  assert.equal(buildModelId("GPT Image 2", "2K", "特价"), "gpt-image-2-c");
});

test("buildModelId: GPT Image 2 官方 -> gpt-image-2", () => {
  assert.equal(buildModelId("GPT Image 2", "2K", "官方"), "gpt-image-2");
});

test("buildModelId: GPT Image 2 id is independent of resolution", () => {
  assert.equal(buildModelId("GPT Image 2", "1K", "特价"), "gpt-image-2-c");
  assert.equal(buildModelId("GPT Image 2", "4K", "特价"), "gpt-image-2-c");
});

test("buildModelId: Nano Banana family untouched by the new branch", () => {
  assert.equal(buildModelId("Nano Banana Pro", "1K", "特价"), "nano-banana-pro");
  assert.equal(buildModelId("Nano Banana 2", "4K", "特价"), "nano-banana-2-4k");
});

// ── resolveGptImageSize ──────────────────────────────────────────────────────

test("resolveGptImageSize: auto ratio sends the bare tier", () => {
  assert.equal(resolveGptImageSize("2K", "auto"), "2K");
  assert.equal(resolveGptImageSize("1K", undefined), "1K");
});

test("resolveGptImageSize: known ratio resolves to exact pixel size", () => {
  assert.equal(resolveGptImageSize("1K", "3:2"), "1536x1024");
  assert.equal(resolveGptImageSize("2K", "16:9"), "3648x2048");
  assert.equal(resolveGptImageSize("4K", "9:16"), "2160x3840");
});

test("resolveGptImageSize: ratio outside the preset table falls back to the tier", () => {
  assert.equal(resolveGptImageSize("2K", "21:9"), "2K");
});

test("resolveGptImageSize: unknown resolution falls back to 2K tier", () => {
  assert.equal(resolveGptImageSize("512", "auto"), "2K");
});

// ── comboError ───────────────────────────────────────────────────────────────

test("comboError: GPT Image 2 rejects 512", () => {
  assert.ok(comboError("GPT Image 2", "512", "特价"));
});

test("comboError: GPT Image 2 rejects unsupported ratio", () => {
  assert.ok(comboError("GPT Image 2", "2K", "特价", "21:9"));
});

test("comboError: GPT Image 2 accepts supported resolution + ratio", () => {
  assert.equal(comboError("GPT Image 2", "2K", "特价", "16:9"), null);
  assert.equal(comboError("GPT Image 2", "2K", "官方", "auto"), null);
});

// ── buildGptImageSubmitBody ──────────────────────────────────────────────────

test("buildGptImageSubmitBody: no aspect_ratio field, size carries the shape", () => {
  const body = buildGptImageSubmitBody({
    modelId: "gpt-image-2-c",
    prompt: "test prompt",
    resolution: "2K",
    aspectRatio: "3:2",
  });
  assert.equal(body.size, "3072x2048");
  assert.equal(body.quality, "auto");
  assert.equal(body.n, 1);
  assert.equal(body.output_format, "png");
  assert.equal("aspect_ratio" in body, false);
});

test("buildGptImageSubmitBody: images omitted when empty", () => {
  const body = buildGptImageSubmitBody({
    modelId: "gpt-image-2-c",
    prompt: "test",
    resolution: "1K",
  });
  assert.equal(body.images, undefined);
});

test("buildGptImageSubmitBody: images included when provided", () => {
  const body = buildGptImageSubmitBody({
    modelId: "gpt-image-2",
    prompt: "test",
    resolution: "1K",
    images: ["data:image/png;base64,AAAA"],
  });
  assert.deepEqual(body.images, ["data:image/png;base64,AAAA"]);
});

test("buildGptImageSubmitBody: explicit quality is passed through untouched", () => {
  const body = buildGptImageSubmitBody({
    modelId: "gpt-image-2-c",
    prompt: "test",
    resolution: "2K",
    quality: "high",
  });
  assert.equal(body.quality, "high");
});

test("buildGptImageSubmitBody: omitted quality defaults to auto", () => {
  const body = buildGptImageSubmitBody({
    modelId: "gpt-image-2-c",
    prompt: "test",
    resolution: "2K",
  });
  assert.equal(body.quality, "auto");
});

// ── extractResultImages (gpt-image-2 can return an inline data: URL in `url`) ─

test("extractResultImages: http url still routed as url kind", () => {
  const images = extractResultImages({ data: { images: [{ url: "https://cdn.example.com/a.png" }] } });
  assert.deepEqual(images, [{ kind: "url", value: "https://cdn.example.com/a.png" }]);
});

test("extractResultImages: data: URL in a url-like field is routed as b64 kind", () => {
  const images = extractResultImages({ data: { images: [{ url: "data:image/png;base64,AAAA" }] } });
  assert.deepEqual(images, [{ kind: "b64", value: "AAAA" }]);
});

test("extractResultImages: mixed http + inline results in one call", () => {
  const images = extractResultImages({
    data: {
      images: [{ url: "https://cdn.example.com/a.png" }, { url: "data:image/jpeg;base64,BBBB" }],
    },
  });
  assert.deepEqual(images, [
    { kind: "url", value: "https://cdn.example.com/a.png" },
    { kind: "b64", value: "BBBB" },
  ]);
});
