// 画布（PLAN-BOARD，自由无限画板）：一块可平移/缩放的画板，参考图与生成结果
// 都以卡片形式摆放；生成参数走底部对话框（BoardGenDialog）。与单图创作的
// "canvas"（Stage 的单图编辑面）无关，代码内部统一叫 board 避免撞名；与模板页
// 的「模板」（参数配方）也无关——画布预设只是新建画布时的起点参数。
// 本模块是 client/server 共享的纯类型 + 校验层，零副作用依赖（同 templates.ts
// 的定位），服务端 boardStore.server.ts 与客户端 boardStore.ts 都从这里取形状。

import type { GenParams } from "./types.ts";
import { sanitizeParams, sanitizeCount } from "./templates.ts";

/** 画板上的一张图片卡片。src 不落库——只存 /api/media/<asset> 的 asset 文件名
 *  （预签名直链 10 分钟就过期，落盘必须用可重建的持久标识）。 */
export interface BoardCard {
  id: string;
  /** /api/media 资产文件名（basename），卡片图片的唯一持久标识。 */
  asset: string;
  /** 世界坐标（不随缩放变化）。w/h 是卡片显示尺寸，保持 natW/natH 纵横比。 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 叠放顺序，点击置顶时递增。 */
  z: number;
  /** 图片自然尺寸，加载时量出，用于比例与提交前的裁剪换算。 */
  natW: number;
  natH: number;
  /** 可选卡片备注（上传文件名等），展示用。 */
  label?: string;
}

export interface BoardViewport {
  x: number;
  y: number;
  scale: number;
}

export interface Board {
  id: string;
  name: string;
  cards: BoardCard[];
  /** 标记为参考图的卡片 id，有序：第 1 张是主图（baseImage），其余按序作
   *  refImages（提示词里可用「第 2 张图」指代，同 PLAN-MULTI-REF 措辞）。 */
  refs: string[];
  viewport: BoardViewport;
  /** 本画布生成对话框的参数（含提示词），每块画布各记各的。 */
  params: GenParams;
  createdAt: number;
  updatedAt: number;
}

export const MAX_BOARDS = 50;
export const MAX_BOARD_CARDS = 200;
/** 单块画布 JSON 上限（不含图片字节——卡片只存 asset 文件名）。 */
export const MAX_BOARD_BYTES = 512 * 1024;

export const MIN_BOARD_SCALE = 0.05;
export const MAX_BOARD_SCALE = 8;

const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** asset 只允许 basename 形态的文件名（同 media 路由的 path.basename 约束）。 */
const ASSET_RE = /^[\w.-]+$/;

function sanitizeCard(raw: unknown): BoardCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.asset !== "string" || !ASSET_RE.test(r.asset)) return null;
  const natW = clamp(num(r.natW, 1024), 1, 20000);
  const natH = clamp(num(r.natH, 1024), 1, 20000);
  return {
    id: r.id.slice(0, 64),
    asset: r.asset.slice(0, 128),
    x: clamp(num(r.x, 0), -1e6, 1e6),
    y: clamp(num(r.y, 0), -1e6, 1e6),
    w: clamp(num(r.w, 320), 16, 8000),
    h: clamp(num(r.h, 320), 16, 8000),
    z: clamp(Math.round(num(r.z, 1)), 0, 1e9),
    natW,
    natH,
    label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 60) : undefined,
  };
}

export function sanitizeViewport(raw: unknown): BoardViewport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    x: clamp(num(r.x, 0), -1e7, 1e7),
    y: clamp(num(r.y, 0), -1e7, 1e7),
    scale: clamp(num(r.scale, 1), MIN_BOARD_SCALE, MAX_BOARD_SCALE),
  };
}

/** 校验/收敛一块外部提交的画布（POST /api/boards 入口）。返回 null 表示没有
 *  可用内容。params 复用模板的 sanitizeParams（字段级降级，不整体拒绝）。 */
export function sanitizeBoardDraft(raw: Record<string, unknown>): Omit<Board, "id" | "createdAt" | "updatedAt"> | null {
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : "";
  if (!name) return null;
  const cardsRaw = Array.isArray(raw.cards) ? raw.cards : [];
  const cards: BoardCard[] = [];
  const seen = new Set<string>();
  for (const c of cardsRaw.slice(0, MAX_BOARD_CARDS)) {
    const card = sanitizeCard(c);
    if (card && !seen.has(card.id)) {
      seen.add(card.id);
      cards.push(card);
    }
  }
  const cardIds = new Set(cards.map((c) => c.id));
  const refs = (Array.isArray(raw.refs) ? raw.refs : [])
    .filter((id): id is string => typeof id === "string" && cardIds.has(id))
    .slice(0, 9);
  const params = sanitizeParams((raw.params && typeof raw.params === "object" ? raw.params : {}) as Record<string, unknown>);
  return {
    name,
    cards,
    refs: [...new Set(refs)],
    viewport: sanitizeViewport(raw.viewport),
    params: {
      ...(params ?? {
        prompt: "",
        model: "Nano Banana 2" as const,
        resolution: "2K" as const,
        aspectRatio: "auto",
        billing: "特价" as const,
        quality: "auto" as const,
      }),
      count: sanitizeCount((raw.params as Record<string, unknown> | undefined)?.count) ?? 1,
    },
  };
}

// ── 预设画布（起点） ─────────────────────────────────────────────────────────
// 新建画布时可选的起点：只预填名字 + 对话框参数（提示词配方），不带卡片
// （预设不捆绑图片资产）。选中后即复制成一块普通的用户画布，之后随便改。
// 措辞上叫「预设画布」，避免与模板页的「模板」混淆（见文件头）。

export interface BoardStarter {
  id: string;
  name: string;
  icon: string;
  notes: string;
  params: GenParams;
}

const starterParams = (prompt: string, count = 1): GenParams => ({
  prompt,
  model: "Nano Banana Pro",
  resolution: "2K",
  aspectRatio: "auto",
  billing: "特价",
  count,
  quality: "auto",
});

export const BOARD_STARTERS: BoardStarter[] = [
  {
    id: "starter-blank",
    name: "空白画布",
    icon: "FrameCorners",
    notes: "从零开始：拖图上板，选参考，写提示词。",
    params: starterParams(""),
  },
  {
    id: "starter-product",
    name: "商品图工作台",
    icon: "Cube",
    notes: "白底商品主图起点：主图放商品，直接生成规范白底图。",
    params: starterParams(
      "Isolate the main product from the first image on a pure white seamless background (#FFFFFF). Keep the product's shape, colors, materials, textures, printing and proportions exactly identical. Center the product with generous even margins, add a soft natural ground shadow, professional e-commerce product photography, clean studio lighting.",
    ),
  },
  {
    id: "starter-outfit",
    name: "模特换装台",
    icon: "TShirt",
    notes: "主图放模特，第 2 张参考放要换上的衣服，一板多方案对比。",
    params: starterParams(
      "Using the person in the first image as the base, replace their upper garment with the garment shown in the second image. Faithfully reproduce the second garment's design, color, fabric texture, pattern and fit, draping it naturally over the person's body and matching their exact pose. Keep everything else identical: face, hairstyle, skin tone, pose, lower garment, shoes, background, lighting and framing. Photorealistic fashion e-commerce photography.",
    ),
  },
];
