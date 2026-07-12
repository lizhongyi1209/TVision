import assert from "node:assert/strict";
import { test } from "node:test";
import { packGrid } from "../utils.ts";

test("packGrid: single tile fills the box", () => {
  const p = packGrid(1, 800, 400);
  assert.equal(p.cols, 1);
  assert.equal(p.rows, 1);
  assert.equal(p.cellW, 800);
  assert.equal(p.cellH, 400);
});

test("packGrid: zero items returns a zero-size box without throwing", () => {
  const p = packGrid(0, 800, 400);
  assert.equal(p.cellW, 0);
  assert.equal(p.cellH, 0);
});

test("packGrid: square box with a perfect-square count picks matching rows/cols", () => {
  const p = packGrid(9, 900, 900, 0);
  assert.equal(p.cols, 3);
  assert.equal(p.rows, 3);
});

test("packGrid: wide box favors more columns than a tall box for the same count", () => {
  const wide = packGrid(12, 1600, 400, 0);
  const tall = packGrid(12, 400, 1600, 0);
  assert.ok(wide.cols > tall.cols);
});

test("packGrid: every tile fits within the box (rounded up to whole rows/cols)", () => {
  const gap = 8;
  const p = packGrid(50, 820, 420, gap);
  assert.ok(p.cellW * p.cols + gap * (p.cols - 1) <= 820 + 1e-6);
  assert.ok(p.cellH * p.rows + gap * (p.rows - 1) <= 420 + 1e-6);
  assert.ok(p.cols * p.rows >= 50);
});
