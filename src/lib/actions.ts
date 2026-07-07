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
    refHint: "裤子 / 下装图片",
    defaultAspect: "auto",
    defaultCount: 1,
    buildPrompt: () =>
      "Using the person in the first image as the base, replace their lower garment (pants, trousers, skirt, shorts) with the garment shown in the second image. Faithfully reproduce the second garment's cut, color, fabric, texture, length and fit, draping it naturally on the person's legs and matching their exact pose. Keep everything else identical: the same face, hairstyle, body, pose, hands, upper garment, shoes, background, lighting, shadows, color grade and camera framing. Photorealistic fashion e-commerce photography. Only the lower garment changes.",
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
    defaultAspect: "1:1",
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
];

export function getAction(id: string | null | undefined): StudioAction | undefined {
  if (!id) return undefined;
  return ACTIONS.find((a) => a.id === id);
}
