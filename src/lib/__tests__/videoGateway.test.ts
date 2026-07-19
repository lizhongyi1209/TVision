import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VIDEO_MODEL_IDS,
  allowedVideoResolutions,
  buildSeedanceGenerationBody,
  extractGeneratedVideoUrl,
  extractVideoTaskId,
} from "../videoGateway.ts";
import type { VideoJobParams } from "../videoTypes.ts";

function params(patch: Partial<VideoJobParams> = {}): VideoJobParams {
  return {
    model: "seedance-2.0",
    mode: "720p",
    duration: 5,
    prompt: "雨夜街头的电影感镜头",
    sound: false,
    aspectRatio: "智能",
    ...patch,
  };
}

test("Seedance UI values map to the working upstream model IDs", () => {
  assert.equal(VIDEO_MODEL_IDS["seedance-2.0"], "seedance-2.0");
  assert.equal(VIDEO_MODEL_IDS["seedance-2.0-fast"], "seedance-2.0-fast");
});

test("Seedance Fast only exposes 720p", () => {
  assert.deepEqual(allowedVideoResolutions("seedance-2.0-fast"), ["720p"]);
  assert.deepEqual(allowedVideoResolutions("seedance-2.0"), ["720p", "1080p", "4K"]);
});

test("Seedance body follows the Ark gateway format (images/videos/audios arrays)", () => {
  const body = buildSeedanceGenerationBody(params({
    mode: "4K",
    duration: 12,
    sound: true,
    aspectRatio: "9:16",
    webSearch: true,
    cameraFixed: true,
    seed: 42,
    refUrls: ["https://cdn.example.com/ref.png"],
    videoUrls: ["https://cdn.example.com/ref.mp4"],
    audioUrls: ["https://cdn.example.com/ref.wav"],
  }));

  assert.deepEqual(body, {
    model: "seedance-2.0",
    prompt: "雨夜街头的电影感镜头",
    resolution: "4k",
    ratio: "9:16",
    duration: 12,
    camera_fixed: true,
    generate_audio: true,
    web_search: true,
    seed: 42,
    images: [{ url: "https://cdn.example.com/ref.png", role: "reference_image" }],
    videos: ["https://cdn.example.com/ref.mp4"],
    audios: ["https://cdn.example.com/ref.wav"],
  });
});

test("Seedance omits seed when unset and rejects non-integer seed", () => {
  const body = buildSeedanceGenerationBody(params());
  assert.equal(body.seed, undefined);
  assert.equal(body.camera_fixed, false);
  assert.throws(() => buildSeedanceGenerationBody(params({ seed: 1.5 })), /整数/);
});

test("Seedance first and last frames become role-tagged images[] entries", () => {
  const body = buildSeedanceGenerationBody(params({
    imageUrl: "https://cdn.example.com/first.png",
    tailUrl: "https://cdn.example.com/last.png",
  }));
  assert.deepEqual(body.images, [
    { url: "https://cdn.example.com/first.png", role: "first_frame" },
    { url: "https://cdn.example.com/last.png", role: "last_frame" },
  ]);
  assert.equal(body.videos, undefined);
  assert.equal(body.audios, undefined);
});

test("Seedance omits ratio when aspect is 智能", () => {
  const body = buildSeedanceGenerationBody(params());
  assert.equal(body.ratio, undefined);
  assert.equal(body.resolution, "720p");
});

test("Seedance gateway accepts an explicitly declared last frame by itself", () => {
  const body = buildSeedanceGenerationBody(params({
    tailUrl: "https://cdn.example.com/last.png",
  }));
  assert.deepEqual(body.images, [
    { url: "https://cdn.example.com/last.png", role: "last_frame" },
  ]);
});

test("Seedance Fast rejects 1080p", () => {
  assert.throws(
    () => buildSeedanceGenerationBody(params({ model: "seedance-2.0-fast", mode: "1080p" })),
    /不支持 1080p/,
  );
});

test("Seedance rejects invalid duration and standalone audio", () => {
  assert.throws(() => buildSeedanceGenerationBody(params({ duration: 3 })), /4-15/);
  assert.throws(() => buildSeedanceGenerationBody(params({ duration: 16 })), /4-15/);
  assert.throws(
    () => buildSeedanceGenerationBody(params({ audioUrls: ["https://cdn.example.com/ref.mp3"] })),
    /音频不能单独提交/,
  );
});

test("Seedance rejects mixed frame/reference modes and unsafe URL protocols", () => {
  assert.throws(
    () => buildSeedanceGenerationBody(params({
      imageUrl: "https://cdn.example.com/first.png",
      refUrls: ["https://cdn.example.com/ref.png"],
    })),
    /不能与多模态参考素材混用/,
  );
  assert.throws(
    () => buildSeedanceGenerationBody(params({
      imageUrl: "https://cdn.example.com/first.png",
      videoUrls: ["https://cdn.example.com/ref.mp4"],
    })),
    /不能与多模态参考素材混用/,
  );
  assert.throws(
    () => buildSeedanceGenerationBody(params({ refUrls: ["file:///tmp/ref.png"] })),
    /HTTP 或 HTTPS/,
  );
});

test("video response parsing handles gateway id and data array URL", () => {
  assert.equal(extractVideoTaskId({ data: { task_id: "task-123" } }), "task-123");
  assert.equal(
    extractGeneratedVideoUrl({ status: "completed", data: [{ url: "https://cdn.example.com/result.mp4" }] }),
    "https://cdn.example.com/result.mp4",
  );
});
