import assert from "node:assert/strict";
import { test } from "node:test";
import { getAction } from "../actions.ts";

test("remove-object is a brush-required quick action", () => {
  const action = getAction("remove-object");

  assert.ok(action);
  assert.equal(action.label, "物品移除");
  assert.equal(action.needsRef, false);
  assert.equal(action.usesBrush, true);
  assert.equal(action.defaultAspect, "auto");
  assert.equal(action.defaultCount, 1);
});

test("remove-object prompt removes only the selected object and reconstructs the background", () => {
  const prompt = getAction("remove-object")?.buildPrompt().toLowerCase() ?? "";

  assert.match(prompt, /remove the unwanted object entirely/);
  assert.match(prompt, /reconstruct every area it occluded/);
  assert.match(prompt, /do not add a replacement object/);
  assert.match(prompt, /keep all remaining visible content unchanged/);
  assert.match(prompt, /no residue, blur, halos, seams/);
});
