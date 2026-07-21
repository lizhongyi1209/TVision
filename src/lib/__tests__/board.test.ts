import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD_STARTERS, MAX_BOARD_CARDS, sanitizeBoardDraft, sanitizeViewport } from "../board.ts";

function card(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "c1", asset: "abc-123.png", x: 10, y: 20, w: 340, h: 340, z: 1, natW: 1024, natH: 768, ...over };
}

test("sanitizeBoardDraft keeps a valid board and clamps fields", () => {
  const draft = sanitizeBoardDraft({
    name: `  ${"画".repeat(60)}  `,
    cards: [card(), card({ id: "c2", asset: "def.jpg", label: `  ${"x".repeat(90)}  ` })],
    refs: ["c2", "c1", "missing"],
    viewport: { x: 1, y: 2, scale: 99 },
    params: { prompt: "p", model: "Nano Banana 2", resolution: "2K", aspectRatio: "1:1", billing: "特价", count: 3 },
  });
  assert.ok(draft);
  assert.equal(draft.name.length, 40);
  assert.equal(draft.cards.length, 2);
  assert.equal(draft.cards[1].label?.length, 60);
  // refs 只保留真实存在的卡片，顺序不变
  assert.deepEqual(draft.refs, ["c2", "c1"]);
  assert.equal(draft.viewport.scale, 8); // MAX_BOARD_SCALE 收敛
  assert.equal(draft.params.count, 3);
  assert.equal(draft.params.prompt, "p");
});

test("sanitizeBoardDraft rejects nameless boards and bad cards", () => {
  assert.equal(sanitizeBoardDraft({ name: "  " }), null);
  const draft = sanitizeBoardDraft({
    name: "b",
    cards: [
      card({ asset: "../../etc/passwd" }), // 路径穿越形态的 asset 拒收
      card({ id: "c2", asset: "ok.png", x: "NaN?" }),
      card({ id: "c2", asset: "dup.png" }), // 重复 id 去重
      { id: "", asset: "x.png" },
    ],
  });
  assert.ok(draft);
  assert.equal(draft.cards.length, 1);
  assert.equal(draft.cards[0].id, "c2");
  assert.equal(draft.cards[0].x, 0); // 非数值回退默认
});

test("sanitizeBoardDraft caps cards and degrades unknown params", () => {
  const cards = Array.from({ length: MAX_BOARD_CARDS + 20 }, (_, i) => card({ id: `c${i}`, asset: `a${i}.png` }));
  const draft = sanitizeBoardDraft({
    name: "b",
    cards,
    params: { prompt: "keep", model: "nonexistent-model", resolution: "8K", billing: "wat" },
  });
  assert.ok(draft);
  assert.equal(draft.cards.length, MAX_BOARD_CARDS);
  assert.equal(draft.params.prompt, "keep");
  assert.equal(draft.params.billing, "特价"); // 字段级降级不整体拒绝
  assert.equal(draft.params.count, 1);
});

test("sanitizeViewport clamps scale into board bounds", () => {
  assert.equal(sanitizeViewport({ scale: 0 }).scale, 0.05);
  assert.equal(sanitizeViewport(null).scale, 1);
});

test("board starters carry usable params", () => {
  for (const s of BOARD_STARTERS) {
    assert.ok(s.id.startsWith("starter-"));
    assert.ok(s.params.model);
    assert.ok(s.params.count >= 1);
  }
});
