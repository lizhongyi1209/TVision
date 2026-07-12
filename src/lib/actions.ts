// The quick-action registry. Each action is data: an icon, whether it needs a
// reference image, and a prompt template. Adding a new action = adding an entry.
//
// Prompt style follows the o1key skill's high-leverage img2img rule: name the ONE
// change, then lock down everything that must stay identical. Multi-image edits
// refer to "the first image" (the subject/base) and "the second image" (the
// uploaded reference), matching the order the server sends images[].

export interface StudioAction {
  id: string;
  label: string;
  hint: string;
  icon: string; // Phosphor icon name, resolved in components/icons.tsx
  needsRef: boolean;
  refLabel: string;
  refHint: string;
  defaultAspect: string;
  defaultCount: number;
  defaultResolution?: string; // Resolution value (e.g. "2K"); applied in store.chooseAction when set, same as defaultAspect/defaultCount
  defaultModel?: string; // ModelName value (e.g. "Nano Banana 2"); applied in store.chooseAction when set, same as defaultResolution
  /** When true, generation triggered by this action sends no canvas image at
   *  all — pure text-to-image. Used by "视觉反推", whose entire point is a
   *  prompt meant to stand on its own. See GenerateBar.generate()'s submit
   *  body and /api/jobs's `textOnly` flag. */
  textToImage?: boolean;
  /** When true, selecting this action (RadialMenu.tsx) kicks off an async
   *  vision-model call: the canvas image is sent to /api/reverse-prompt and
   *  the JSON result is written into params.prompt once it lands. Actions
   *  with this flag should return "" from buildPrompt() so the prompt box
   *  starts empty while the analysis is running. */
  visionAnalysis?: boolean;
  buildPrompt: () => string;
}

export const ACTIONS: StudioAction[] = [
  {
    id: "swap-top",
    label: "换上衣",
    hint: "替换上装为参考图中的服装",
    icon: "TShirt",
    needsRef: true,
    refLabel: "上传你想换上的上衣",
    refHint: "服装平铺图或模特图都可以",
    defaultAspect: "auto",
    defaultCount: 1,
    buildPrompt: () =>
      "Using the person in the first image as the base, replace their upper garment (top, shirt, jacket, dress top) with the garment shown in the second image. Faithfully reproduce the second garment's design, color, fabric texture, pattern, print, collar, sleeves and fit, draping it naturally over the person's body and matching their exact pose. Keep everything else in the first image identical: the same face, hairstyle, expression, skin tone, body shape, pose, hands, lower garment, shoes, background, lighting, shadows, color grade and camera framing. Photorealistic fashion e-commerce photography. Only the upper garment changes.",
  },
  {
    id: "swap-pants",
    label: "换裤子",
    hint: "替换下装为参考图中的裤装",
    icon: "Pants",
    needsRef: true,
    refLabel: "上传你想换上的裤子",
    refHint: "裤子平铺图或模特图都可以",
    defaultAspect: "auto",
    defaultCount: 1,
    buildPrompt: () =>
      "Using the person in the first image as the base, replace their lower garment (pants, trousers, skirt, shorts) with the garment shown in the second image. Faithfully reproduce the second garment's cut, color, fabric, texture, length and fit, draping it naturally on the person's legs and matching their exact pose. Keep everything else identical: the same face, hairstyle, body, pose, hands, upper garment, shoes, background, lighting, shadows, color grade and camera framing. Photorealistic fashion e-commerce photography. Only the lower garment changes.",
  },
  {
    id: "flat-top",
    label: "平铺上衣",
    hint: "提取上衣生成白底平铺图，褶皱图 / 模特图皆可",
    icon: "CoatHanger",
    needsRef: false,
    refLabel: "",
    refHint: "",
    defaultAspect: "1:1",
    defaultCount: 1,
    defaultResolution: "2K",
    buildPrompt: () =>
      "Identify the upper garment (top, shirt, t-shirt, jacket, hoodie, sweater or dress) in the image and render it as a professional e-commerce flat-lay product photo. If a person is wearing the garment, remove the person entirely and reconstruct the complete garment, including any parts hidden by arms, pose or tucking. If the garment appears on its own — wrinkled, crumpled, folded or on a hanger — use that exact same garment. Lay it perfectly flat on a clean, pure white (#FFFFFF) seamless background, photographed directly from above: fully smoothed and steamed with no wrinkles, symmetrically arranged with sleeves neatly positioned, collar and hem in their natural shape. Faithfully preserve the garment's exact design, color, fabric texture, pattern, prints, logos, label text, buttons, zippers and stitching. The source photo may have a color cast from warm indoor lighting or colored reflections — correct for this: infer the garment's true color as it would appear under neutral, daylight-balanced studio lighting and reproduce that exact hue, saturation and tone. Do not lighten, bleach, darken, oversaturate or shift the color toward a typical catalog wash; the garment in the output must read as unmistakably the same color as the garment in the source photo. Soft, even studio lighting with a subtle natural contact shadow. Sharp, high-detail commercial product photography. Output only the flat-lay garment — no person, no mannequin, no props.",
  },
  {
    id: "flat-pants",
    label: "平铺裤子",
    hint: "提取裤子生成白底平铺图，褶皱图 / 模特图皆可",
    icon: "Belt",
    needsRef: false,
    refLabel: "",
    refHint: "",
    defaultAspect: "1:1",
    defaultCount: 1,
    defaultResolution: "2K",
    buildPrompt: () =>
      "Identify the lower garment (pants, trousers, jeans, shorts or skirt) in the image and render it as a professional e-commerce flat-lay product photo. If a person is wearing the garment, remove the person entirely and reconstruct the complete garment, including any parts hidden by the pose or by the upper garment. If the garment appears on its own — wrinkled, crumpled, folded or on a hanger — use that exact same garment. Lay it perfectly flat on a clean, pure white (#FFFFFF) seamless background, photographed directly from above: fully smoothed with no wrinkles, legs neatly aligned in a natural catalog style, waistband at the top in its natural shape. Faithfully preserve the garment's exact cut, color, fabric texture, wash, pattern, prints, logos, label text, buttons, zippers, pockets and stitching. The source photo may have a color cast from warm indoor lighting or colored reflections — correct for this: infer the garment's true color as it would appear under neutral, daylight-balanced studio lighting and reproduce that exact hue, saturation and tone. Do not lighten, bleach, darken, oversaturate or shift the color toward a typical catalog wash; the garment in the output must read as unmistakably the same color as the garment in the source photo. Soft, even studio lighting with a subtle natural contact shadow. Sharp, high-detail commercial product photography. Output only the flat-lay garment — no person, no mannequin, no props.",
  },
  {
    id: "swap-bg",
    label: "换背景",
    hint: "把主体合成到参考背景中",
    icon: "Mountains",
    needsRef: true,
    refLabel: "上传新的背景图",
    refHint: "场景 / 环境图片",
    defaultAspect: "auto",
    defaultCount: 1,
    buildPrompt: () =>
      "Keep the main subject from the first image completely identical: same shape, pose, proportions, colors, materials, textures and crisp edges. Replace only the background with the scene shown in the second image. Composite the subject naturally into the new environment with matching perspective, lighting direction, color temperature and a believable soft contact shadow so it reads as one real photograph. Photorealistic, clean subject edges, professional composite. Only the background changes.",
  },
  {
    id: "white-bg",
    label: "白底图",
    hint: "生成纯白电商主图（无需参考图）",
    icon: "Square",
    needsRef: false,
    refLabel: "",
    refHint: "",
    defaultAspect: "auto",
    defaultCount: 1,
    buildPrompt: () =>
      "Replace the background with a clean, pure white (#FFFFFF) seamless studio backdrop for an e-commerce hero image. Keep the main subject completely identical: same shape, color, materials, logo/label text, proportions and orientation. Center the subject with soft, even studio lighting and a subtle natural contact shadow beneath it. Crisp commercial product photography, sharp focus, high detail, professional e-commerce main image.",
  },
  {
    id: "action-variation",
    label: "动作裂变",
    hint: "同一主体，生成多个自然新姿势",
    icon: "Sparkle",
    needsRef: false,
    refLabel: "",
    refHint: "",
    defaultAspect: "auto",
    defaultCount: 4,
    buildPrompt: () =>
      "Generate a new photograph of the same subject wearing the exact same outfit and styling as in the image, but in a different, natural pose and body gesture. Keep identity, face, hairstyle, clothing, colors, materials, overall style, background type and lighting consistent with the original. Vary only the pose and camera angle in a natural, flattering way. Photorealistic fashion e-commerce photography.",
  },
  {
    id: "reverse-prompt",
    label: "视觉反推",
    hint: "AI 解析图片，生成结构化提示词，可编辑后用纯文字重新生成",
    icon: "Eye",
    needsRef: false,
    refLabel: "",
    refHint: "",
    defaultAspect: "3:4",
    defaultCount: 1,
    defaultModel: "Nano Banana 2",
    textToImage: true,
    visionAnalysis: true,
    // No static template: the real prompt is filled in asynchronously by a
    // vision-model call once this action is selected (see RadialMenu.tsx).
    buildPrompt: () => "",
  },
];

export function getAction(id: string | null | undefined): StudioAction | undefined {
  if (!id) return undefined;
  return ACTIONS.find((a) => a.id === id);
}
