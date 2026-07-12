"use client";

// Deep-import the dependency-free leaf SVGs instead of the `@lobehub/icons`
// barrel: the barrel builds compound components (`.Avatar` / `.Combine`) that
// import @lobehub/ui and antd — neither is installed here, and we won't add
// them for two glyphs. The leaves depend on react only. These internal paths
// are why package.json pins the exact version (5.11.0).
import NanoBananaColor from "@lobehub/icons/es/NanoBanana/components/Color";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono";
import type { ModelName } from "@/lib/types";

/** Brand glyph for a generation model (model dropdowns, param rows).
 *  OpenAI renders in currentColor; NanoBanana ships its own colors.
 *  Unknown names render nothing so callers never crash on new models. */
export function ModelIcon({ model, size = 16 }: { model: ModelName | (string & {}); size?: number }) {
  if (model === "GPT Image 2") return <OpenAIMono size={size} />;
  if (model.startsWith("Nano Banana")) return <NanoBananaColor size={size} />;
  return null;
}
