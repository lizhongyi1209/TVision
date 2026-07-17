import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAllowedWorkflowImageSource,
  isPrivateOrReservedIp,
  isSupportedImageDataUrl,
  resolveImageToDataUrl,
} from "../vision.ts";

test("workflow image inputs accept supported upload data URLs only", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(isSupportedImageDataUrl(png), true);
  assert.equal(isAllowedWorkflowImageSource(png), true);
  assert.equal(isAllowedWorkflowImageSource("/api/media/job-1.png"), false);
  assert.equal(isAllowedWorkflowImageSource("/api/media/job-1.webp?cache=1"), false);
  assert.equal(isAllowedWorkflowImageSource("https://example.com/image.png"), false);
  assert.equal(isAllowedWorkflowImageSource("/api/media/../secret.png"), false);
  assert.equal(isAllowedWorkflowImageSource("data:text/html;base64,PGgxPmJhZDwvaDE+"), false);
  assert.equal(isAllowedWorkflowImageSource("data:image/svg+xml;base64,PHN2Zy8+"), false);
});

test("remote image guard blocks private, link-local and documentation networks", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.2",
    "203.0.113.2",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ]) assert.equal(isPrivateOrReservedIp(address), true, address);

  assert.equal(isPrivateOrReservedIp("1.1.1.1"), false);
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedIp("2606:4700:4700::1111"), false);
});

test("remote resolution rejects private targets before making an HTTP request", async () => {
  await assert.rejects(
    () => resolveImageToDataUrl("http://127.0.0.1:9/private.png"),
    /私有或保留网络/,
  );
  await assert.rejects(
    () => resolveImageToDataUrl("data:image/svg+xml;base64,PHN2Zy8+"),
    /无效的图片 data URL/,
  );
});
