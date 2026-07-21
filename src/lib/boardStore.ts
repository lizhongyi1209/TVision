"use client";

// 画布（PLAN-BOARD）的独立 store —— 与 batchStore/videoStore 同理由，不并入
// useStudio：卡片拖动、多路生成进度都是高频写，独立 store 让其他工作区不因
// 画布状态变化而重渲染。
//
// 下半部分的提交/轮询引擎沿用 batchStore 的形态：模块级 async 函数，全部
// 通过 getState()/setState() 驱动，不挂在组件 effect 上 —— 切走标签页、
// 组件卸载都不中断生成；epoch 计数器负责在账号切换（reset）后丢弃一切
// 迟到的异步写入。

import { create } from "zustand";
import {
  BOARD_STARTERS,
  MAX_BOARD_CARDS,
  MAX_BOARD_SCALE,
  MIN_BOARD_SCALE,
  type Board,
  type BoardCard,
  type BoardStarter,
  type BoardViewport,
} from "./board";
import { diag } from "./logStore";
import { comboError } from "./models";
import { useStudio } from "./store";
import type { GenParams, InpaintJob, InpaintMask } from "./types";
import { compositeInpaintResult, cropImageToDataURL, downscaleImageSrc, loadImage } from "./utils";

export const DEFAULT_CARD_W = 340;
const POLL_INTERVAL_MS = 1500;
const SAVE_DEBOUNCE_MS = 800;
/** 生成结果落卡与参考区的间距（世界坐标）。 */
const PLACE_GAP = 32;

export function boardMediaUrl(asset: string): string {
  return `/api/media/${encodeURIComponent(asset)}`;
}

/** 画布上需要读像素的场合（提交前下采样、裁剪、局部重绘合成）必须走同源
 *  字节流，避开 S3 模式的 302 跨域跳转污染 canvas（见 media 路由注释）。 */
export function boardMediaBytesUrl(asset: string): string {
  return `${boardMediaUrl(asset)}?bytes=1`;
}

/** 卡片显示地址：本地预览优先（秒显 + 免网络往返），否则走持久资产。 */
export function cardDisplaySrc(card: BoardCard): string {
  const local = useBoardStore.getState().localSrcs[card.id];
  return local ?? boardMediaUrl(card.asset);
}

/** 卡片像素读取地址：本地预览（blob: 同源，canvas 安全）优先，否则同源字节流。 */
export function cardPixelSrc(card: BoardCard): string {
  const local = useBoardStore.getState().localSrcs[card.id];
  return local ?? boardMediaBytesUrl(card.asset);
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_PARAMS: GenParams = {
  prompt: "",
  model: "Nano Banana 2",
  resolution: "2K",
  aspectRatio: "auto",
  billing: "特价",
  count: 1,
  quality: "auto",
};

/** 一次生成请求的完整快照：重试直接重放，不再回读画布状态（参考卡片可能
 *  已被移动/删除）。 */
interface BoardSubmitPayload {
  prompt: string;
  model: GenParams["model"];
  resolution: GenParams["resolution"];
  aspectRatio: string;
  billing: GenParams["billing"];
  quality?: GenParams["quality"];
  count: number;
  baseImage?: string;
  refImages?: string[];
  textOnly?: boolean;
  note?: string;
}

export interface BoardGen {
  id: string;
  boardId: string;
  status: "submitting" | "running" | "failed";
  jobIds: string[];
  /** 真实完成度 0-1（轮询聚合）；UI 用时间曲线混合展示。 */
  progress: number;
  startedAt: number;
  error?: string;
  count: number;
  /** 幽灵卡片的落位（世界坐标），结果卡片也落在这里。 */
  anchor: { x: number; y: number; w: number; h: number };
  /** 局部重绘：目标卡片 + 提交时的遮罩快照（合成必须用提交那一刻的）。 */
  inpaintCardId?: string;
  inpaintJob?: InpaintJob;
  payload: BoardSubmitPayload;
}

interface BoardState {
  ownerKey: string | null;
  loaded: boolean;
  loading: boolean;
  boards: Board[];
  activeId: string | null;
  selectedId: string | null;
  /** 待生成的局部重绘选区，至多一份（同单图创作一次一个选区的心智）。 */
  cardMasks: Record<string, InpaintMask>;
  /** 秒上板（速度优化）：卡片 id → 本地 blob 预览地址。上传不再阻塞落卡 ——
   *  卡片先用本地图即时显示，原图后台上传，完成后把 asset 写回卡片。
   *  地址在会话内一直保留：显示与像素操作（生成预处理/快捷编辑）都优先走
   *  它，省掉整个 R2 往返，也避免上传完成后缩略图闪一次重新加载。 */
  localSrcs: Record<string, string>;
  /** 还在后台上传的卡片 id。期间卡片 asset 为空串 —— 自动保存时服务端
   *  sanitize 会自然跳过这些卡片，上传完成的下一次保存补上。 */
  uploadingIds: Record<string, true>;
  gens: BoardGen[];
  /** 有未保存改动的画布 id（beforeunload 提醒 + 切画布时立刻冲刷）。 */
  dirtyIds: string[];
  assetPickerOpen: boolean;

  reset: (ownerKey: string | null) => void;
  loadBoards: () => Promise<void>;
  createBoard: (starter?: BoardStarter) => void;
  renameBoard: (id: string, name: string) => void;
  removeBoard: (id: string) => Promise<void>;
  setActive: (id: string) => void;

  addCard: (card: Omit<BoardCard, "id" | "z">, opts?: { select?: boolean; boardId?: string }) => BoardCard | null;
  /** 秒上板：立即用本地预览地址落卡（asset 先留空），返回卡片；后台上传完
   *  调 finishCardUpload 写回 asset，失败调 failCardUpload 撤卡。 */
  addLocalCard: (
    card: Omit<BoardCard, "id" | "z" | "asset">,
    localSrc: string,
    opts?: { select?: boolean; boardId?: string },
  ) => BoardCard | null;
  finishCardUpload: (cardId: string, asset: string) => void;
  failCardUpload: (cardId: string, msg?: string) => void;
  moveCard: (id: string, x: number, y: number) => void;
  /** 拖动结束后调用：位置改动落一次防抖保存（拖动过程中不排存）。 */
  commitCard: () => void;
  removeCard: (id: string) => void;
  bringToFront: (id: string) => void;
  toggleRef: (id: string) => void;
  selectCard: (id: string | null) => void;
  setMask: (cardId: string, mask: InpaintMask) => void;
  clearMask: () => void;
  setViewport: (vp: BoardViewport) => void;
  updateBoardParams: (p: Partial<GenParams>, boardId?: string) => void;
  openAssetPicker: () => void;
  closeAssetPicker: () => void;

  startGeneration: () => Promise<void>;
  retryGen: (genId: string) => void;
  dismissGen: (genId: string) => void;
}

function toast(kind: "info" | "error" | "success", msg: string) {
  useStudio.getState().showToast(kind, msg);
}

/** 账号切换的世代计数：所有异步闭包捕获提交时的 epoch，落地前比对。 */
let epoch = 0;

/** 本会话删除过的画布 id：防抖保存的 POST 可能在删除后才落地，若不拦截，
 *  服务端 upsert 会把删掉的画布重新 INSERT 回去（幽灵复活）。 */
const deletedBoardIds = new Set<string>();

/** 画板容器元素（BoardCanvas 挂载时注册）：placeRow / 资产选择器需要把
 *  「视口中心」换算成世界坐标，用真实容器矩形比用 window 尺寸准得多
 *  （画板左侧有全局导航 + 画布列表两条栏）。 */
let canvasEl: HTMLElement | null = null;
export function registerBoardCanvasEl(el: HTMLElement | null) {
  canvasEl = el;
}

/** 当前视口中心对应的世界坐标。 */
export function boardWorldCenter(vp: BoardViewport): { x: number; y: number } {
  const rect = canvasEl?.getBoundingClientRect();
  const w = rect?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const h = rect?.height ?? (typeof window !== "undefined" ? window.innerHeight : 800);
  return { x: (w / 2 - vp.x) / vp.scale, y: (h / 2 - vp.y) / vp.scale };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 脱离画布的兜底轮询：gen 被移除（隐藏/删画布）后，服务端不会自己拉取
 *  结果 —— GET /api/jobs/[id] 是唯一把上游图片落到本站存储的路径。额度已经
 *  花了，图还是要收回来进资产页（同 batchStore.stopRun 的取舍）。 */
function detachPolling(jobIds: string[]) {
  const myEpoch = epoch;
  for (const jobId of jobIds) {
    void (async () => {
      // 上限 ~10 分钟，防泄漏
      for (let i = 0; i < 400; i++) {
        if (epoch !== myEpoch) return;
        try {
          const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`).then((x) => x.json());
          if (r.status === "success" || r.status === "failed") return;
        } catch {
          // 网络抖动，下轮再试
        }
        await sleep(POLL_INTERVAL_MS);
      }
    })();
  }
}

export const useBoardStore = create<BoardState>((set, get) => ({
  ownerKey: null,
  loaded: false,
  loading: false,
  boards: [],
  activeId: null,
  selectedId: null,
  cardMasks: {},
  localSrcs: {},
  uploadingIds: {},
  gens: [],
  dirtyIds: [],
  assetPickerOpen: false,

  reset: (ownerKey) => {
    epoch += 1;
    for (const t of saveTimers.values()) clearTimeout(t);
    saveTimers.clear();
    deletedBoardIds.clear();
    for (const src of Object.values(get().localSrcs)) {
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
    }
    set({
      ownerKey,
      loaded: false,
      loading: false,
      boards: [],
      activeId: null,
      selectedId: null,
      cardMasks: {},
      localSrcs: {},
      uploadingIds: {},
      gens: [],
      dirtyIds: [],
      assetPickerOpen: false,
    });
  },

  loadBoards: async () => {
    const s = get();
    if (s.loaded || s.loading) return;
    const myEpoch = epoch;
    set({ loading: true });
    try {
      const r = await fetch("/api/boards").then((x) => x.json());
      if (epoch !== myEpoch) return;
      const items: Board[] = Array.isArray(r.items) ? r.items : [];
      if (items.length === 0) {
        // 首次进入：本地建一块空白画布（有改动才会落库）。
        const blank = makeBoard(BOARD_STARTERS[0], 1);
        set({ boards: [blank], activeId: blank.id, loaded: true, loading: false });
      } else {
        set({ boards: items, activeId: items[0].id, loaded: true, loading: false });
      }
    } catch {
      if (epoch !== myEpoch) return;
      set({ loading: false });
      toast("error", "读取画布列表失败");
    }
  },

  createBoard: (starter) => {
    const s = get();
    const b = makeBoard(starter ?? BOARD_STARTERS[0], s.boards.length + 1);
    set({ boards: [b, ...s.boards], activeId: b.id, selectedId: null, cardMasks: {} });
    markDirty(b.id);
    if (starter && starter.id !== "starter-blank") toast("success", `已按「${starter.name}」新建画布，参数已预填`);
  },

  renameBoard: (id, name) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    patchBoard(id, (b) => ({ ...b, name: trimmed }));
  },

  removeBoard: async (id) => {
    const s = get();
    const remaining = s.boards.filter((b) => b.id !== id);
    // 该画布还在跑的生成：卡片没地方落了，但结果仍要收进资产（见 detachPolling）。
    const orphanJobs = s.gens.filter((g) => g.boardId === id && g.status === "running").flatMap((g) => g.jobIds);
    if (orphanJobs.length) {
      detachPolling(orphanJobs);
      toast("info", "画布已删除，进行中的生成会继续，完成后可在资产页找到");
    }
    deletedBoardIds.add(id);
    set({
      boards: remaining,
      activeId: s.activeId === id ? (remaining[0]?.id ?? null) : s.activeId,
      selectedId: null,
      cardMasks: {},
      gens: s.gens.filter((g) => g.boardId !== id),
      dirtyIds: s.dirtyIds.filter((d) => d !== id),
    });
    const t = saveTimers.get(id);
    if (t) {
      clearTimeout(t);
      saveTimers.delete(id);
    }
    try {
      await fetch("/api/boards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // 本地已删；下次列表拉取兜底
    }
  },

  setActive: (id) => {
    const s = get();
    if (s.activeId === id || !s.boards.some((b) => b.id === id)) return;
    // 切走前立刻冲刷旧画布的待保存改动，防抖窗口不跨画布。
    if (s.activeId && s.dirtyIds.includes(s.activeId)) void flushSave(s.activeId);
    set({ activeId: id, selectedId: null, cardMasks: {} });
  },

  addCard: (card, opts) => {
    const s = get();
    // 上传是异步的：落卡目标以发起时捕获的 boardId 为准（opts.boardId），
    // 用户中途切画布也不会把卡片落错板。
    const targetId = opts?.boardId ?? s.activeId;
    const board = s.boards.find((b) => b.id === targetId);
    if (!board) return null;
    if (board.cards.length >= MAX_BOARD_CARDS) {
      toast("error", `一块画布最多 ${MAX_BOARD_CARDS} 张卡片`);
      return null;
    }
    const z = board.cards.reduce((m, c) => Math.max(m, c.z), 0) + 1;
    const full: BoardCard = { ...card, id: newId(), z };
    patchBoard(board.id, (b) => ({ ...b, cards: [...b.cards, full] }));
    if (opts?.select && get().activeId === board.id) set({ selectedId: full.id });
    return full;
  },

  addLocalCard: (card, localSrc, opts) => {
    const added = get().addCard({ ...card, asset: "" }, opts);
    if (!added) return null;
    set((s) => ({
      localSrcs: { ...s.localSrcs, [added.id]: localSrc },
      uploadingIds: { ...s.uploadingIds, [added.id]: true },
    }));
    return added;
  },

  finishCardUpload: (cardId, asset) => {
    const s = get();
    // 卡片可能在上传期间被删（removeCard 会清 localSrcs），此时直接丢弃。
    const board = s.boards.find((b) => b.cards.some((c) => c.id === cardId));
    const uploading = { ...s.uploadingIds };
    delete uploading[cardId];
    set({ uploadingIds: uploading });
    if (!board) return;
    // localSrcs 故意保留：本地图继续用于显示与像素操作，直到会话结束。
    patchBoard(board.id, (b) => ({
      ...b,
      cards: b.cards.map((c) => (c.id === cardId ? { ...c, asset } : c)),
    }));
  },

  failCardUpload: (cardId, msg) => {
    const s = get();
    const board = s.boards.find((b) => b.cards.some((c) => c.id === cardId));
    const uploading = { ...s.uploadingIds };
    delete uploading[cardId];
    const localSrcs = { ...s.localSrcs };
    if (localSrcs[cardId]?.startsWith("blob:")) URL.revokeObjectURL(localSrcs[cardId]);
    delete localSrcs[cardId];
    set({ uploadingIds: uploading, localSrcs, selectedId: s.selectedId === cardId ? null : s.selectedId });
    if (board) {
      patchBoard(board.id, (b) => ({
        ...b,
        cards: b.cards.filter((c) => c.id !== cardId),
        refs: b.refs.filter((r) => r !== cardId),
      }));
    }
    toast("error", msg || "图片上传失败，已从画板移除");
  },

  moveCard: (id, x, y) => {
    const s = get();
    if (!s.activeId) return;
    // 拖动中的高频写：只改内存，不排保存（commitCard 收口）。
    set({
      boards: s.boards.map((b) =>
        b.id === s.activeId ? { ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, x, y } : c)) } : b,
      ),
    });
  },

  commitCard: () => {
    const id = get().activeId;
    if (id) markDirty(id);
  },

  removeCard: (id) => {
    const s = get();
    if (!s.activeId) return;
    patchBoard(s.activeId, (b) => ({
      ...b,
      cards: b.cards.filter((c) => c.id !== id),
      refs: b.refs.filter((r) => r !== id),
    }));
    const masks = { ...s.cardMasks };
    delete masks[id];
    const localSrcs = { ...s.localSrcs };
    if (localSrcs[id]?.startsWith("blob:")) URL.revokeObjectURL(localSrcs[id]);
    delete localSrcs[id];
    const uploading = { ...s.uploadingIds };
    delete uploading[id];
    set({ selectedId: s.selectedId === id ? null : s.selectedId, cardMasks: masks, localSrcs, uploadingIds: uploading });
  },

  bringToFront: (id) => {
    const s = get();
    const board = s.boards.find((b) => b.id === s.activeId);
    if (!board) return;
    const top = board.cards.reduce((m, c) => Math.max(m, c.z), 0);
    const card = board.cards.find((c) => c.id === id);
    if (!card || card.z === top) return;
    patchBoard(board.id, (b) => ({ ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, z: top + 1 } : c)) }));
  },

  toggleRef: (id) => {
    const s = get();
    const board = s.boards.find((b) => b.id === s.activeId);
    if (!board) return;
    const has = board.refs.includes(id);
    if (!has && board.refs.length >= 9) {
      toast("error", "参考图最多 9 张（1 张主图 + 8 张参考）");
      return;
    }
    patchBoard(board.id, (b) => ({
      ...b,
      refs: has ? b.refs.filter((r) => r !== id) : [...b.refs, id],
    }));
  },

  selectCard: (id) => set({ selectedId: id }),

  setMask: (cardId, mask) => {
    // 一次只保留一份选区（覆盖旧的），同单图创作。
    set({ cardMasks: { [cardId]: mask } });
    toast("success", "已标记重绘区域，写好提示词后点生成");
  },
  clearMask: () => set({ cardMasks: {} }),

  setViewport: (vp) => {
    const s = get();
    if (!s.activeId) return;
    const clamped: BoardViewport = {
      x: vp.x,
      y: vp.y,
      scale: Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, vp.scale)),
    };
    patchBoard(s.activeId, (b) => ({ ...b, viewport: clamped }));
  },

  updateBoardParams: (p, boardId) => {
    const s = get();
    const targetId = boardId ?? s.activeId;
    if (!targetId) return;
    patchBoard(targetId, (b) => ({ ...b, params: { ...b.params, ...p } }));
  },

  openAssetPicker: () => set({ assetPickerOpen: true }),
  closeAssetPicker: () => set({ assetPickerOpen: false }),

  startGeneration: async () => {
    const s = get();
    const board = s.boards.find((b) => b.id === s.activeId);
    if (!board) return;
    const params = board.params;
    if (!params.prompt.trim()) {
      toast("error", "请先写提示词");
      return;
    }
    if (!useStudio.getState().settings?.hasApiKey) {
      toast("error", "请先在设置里填入 o1key 令牌");
      useStudio.getState().openSettings();
      return;
    }
    const cErr = comboError(params.model, params.resolution, params.billing, params.aspectRatio);
    if (cErr) {
      toast("error", cErr);
      return;
    }

    const myEpoch = epoch;
    const maskEntry = Object.entries(s.cardMasks)[0];
    const inpaintCard = maskEntry ? board.cards.find((c) => c.id === maskEntry[0]) : undefined;
    // 参考图还在后台上传且没有本地预览可用时（理论上不会：秒上板都有本地图），
    // 兜底提示而不是提交空 asset。
    const pixelBlocked = (c: BoardCard) => !c.asset && !s.localSrcs[c.id];

    try {
      let payload: BoardSubmitPayload;
      let anchor: BoardGen["anchor"];
      let inpaintJob: InpaintJob | undefined;

      if (inpaintCard && maskEntry) {
        if (pixelBlocked(inpaintCard)) {
          toast("info", "这张图还在上传，请稍候再试");
          return;
        }
        // 局部重绘：只提交遮罩 bbox 的裁块，比例强制 auto（同 generate.ts）。
        const mask = maskEntry[1];
        const fullSrc = cardPixelSrc(inpaintCard);
        const cropped = await cropImageToDataURL(fullSrc, {
          x: mask.bboxPx.x,
          y: mask.bboxPx.y,
          width: mask.bboxPx.w,
          height: mask.bboxPx.h,
        }, 0.92);
        const submitImage =
          Math.max(cropped.width, cropped.height) > 2048
            ? (await downscaleImageSrc(cropped.dataUrl, 2048, 0.92)).dataUrl
            : cropped.dataUrl;
        inpaintJob = { origSrc: fullSrc, bboxPx: mask.bboxPx, maskUrl: mask.maskUrl };
        payload = {
          prompt: params.prompt,
          model: params.model,
          resolution: params.resolution,
          aspectRatio: "auto",
          billing: params.billing,
          quality: params.model === "GPT Image 2" ? params.quality : undefined,
          count: params.count,
          baseImage: submitImage,
          note: `画布 · ${board.name} · 局部重绘`,
        };
        anchor = placeRow(board, params.count, inpaintCard);
      } else {
        const refCards = board.refs
          .map((id) => board.cards.find((c) => c.id === id))
          .filter((c): c is BoardCard => !!c);
        if (refCards.some(pixelBlocked)) {
          toast("info", "参考图还在上传，请稍候再试");
          return;
        }
        const [main, ...rest] = refCards;
        const baseImage = main
          ? (await downscaleImageSrc(cardPixelSrc(main), 1800, 0.94)).dataUrl
          : undefined;
        const refImages = rest.length
          ? await Promise.all(rest.map((c) => downscaleImageSrc(cardPixelSrc(c), 1400, 0.92).then((r) => r.dataUrl)))
          : undefined;
        payload = {
          prompt: params.prompt,
          model: params.model,
          resolution: params.resolution,
          aspectRatio: params.aspectRatio,
          billing: params.billing,
          quality: params.model === "GPT Image 2" ? params.quality : undefined,
          count: params.count,
          baseImage,
          refImages,
          textOnly: main ? undefined : true,
          note: `画布 · ${board.name}`,
        };
        anchor = placeRow(board, params.count, main);
      }

      if (epoch !== myEpoch) return;
      // 并发生成防叠卡：同板已有 N 个在跑的生成，就往下再错 N 行 ——
      // placeRow 只看已落地的卡片，看不见还在跑的幽灵位。
      const liveGens = get().gens.filter((g) => g.boardId === board.id && g.status !== "failed").length;
      if (liveGens > 0) anchor = { ...anchor, y: anchor.y + liveGens * (anchor.h + PLACE_GAP) };
      const gen: BoardGen = {
        id: newId(),
        boardId: board.id,
        status: "submitting",
        jobIds: [],
        progress: 0,
        startedAt: Date.now(),
        count: params.count,
        anchor,
        inpaintCardId: inpaintCard?.id,
        inpaintJob,
        payload,
      };
      set((st) => ({ gens: [...st.gens, gen], cardMasks: inpaintCard ? {} : st.cardMasks }));
      void submitGen(gen.id, myEpoch);
    } catch (e) {
      toast("error", "读取参考图失败，请重试");
      diag("error", "画布", "生成预处理失败", (e as Error)?.message || String(e));
    }
  },

  retryGen: (genId) => {
    const s = get();
    const old = s.gens.find((g) => g.id === genId);
    if (!old || old.status !== "failed") return;
    const fresh: BoardGen = {
      ...old,
      id: newId(),
      status: "submitting",
      jobIds: [],
      progress: 0,
      startedAt: Date.now(),
      error: undefined,
    };
    set({ gens: [...s.gens.filter((g) => g.id !== genId), fresh] });
    void submitGen(fresh.id, epoch);
  },

  dismissGen: (genId) => {
    const s = get();
    const gen = s.gens.find((g) => g.id === genId);
    set({ gens: s.gens.filter((g) => g.id !== genId) });
    if (gen && gen.status === "running") {
      // 常规轮询随 gen 一起消失，交给兜底轮询把结果收进资产（额度已花）。
      detachPolling(gen.jobIds);
      toast("info", "已隐藏该生成，任务仍会继续，完成后可在资产页找到");
    }
  },
}));

function makeBoard(starter: BoardStarter, seq: number): Board {
  const now = Date.now();
  return {
    id: newId(),
    name: starter.id === "starter-blank" ? `画布 ${seq}` : starter.name,
    cards: [],
    refs: [],
    viewport: { x: 0, y: 0, scale: 1 },
    params: { ...DEFAULT_PARAMS, ...starter.params },
    createdAt: now,
    updatedAt: now,
  };
}

/** 结果卡片的落位：一行 n 张，放在锚点卡片（主图/重绘目标）右侧；没有锚点
 *  （纯文生图）时放在当前视口中心附近。 */
function placeRow(board: Board, count: number, anchorCard?: BoardCard): BoardGen["anchor"] {
  const w = DEFAULT_CARD_W;
  const h = DEFAULT_CARD_W;
  if (anchorCard) {
    // 同一锚点的多次生成往下错开，别叠在上一轮结果上。
    const belowCount = board.cards.filter(
      (c) => c.x > anchorCard.x + anchorCard.w && Math.abs(c.y - anchorCard.y) < (h + PLACE_GAP) * 3,
    ).length;
    return {
      x: anchorCard.x + anchorCard.w + PLACE_GAP,
      y: anchorCard.y + Math.ceil(belowCount / Math.max(1, count)) * (h + PLACE_GAP) * 0.4,
      w,
      h,
    };
  }
  const center = boardWorldCenter(board.viewport);
  const cascade = (board.cards.length % 8) * 28;
  return { x: center.x - ((w + PLACE_GAP) * count) / 2 + cascade, y: center.y - h / 2 + cascade, w, h };
}

// ── 保存（防抖自动落库） ────────────────────────────────────────────────────

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function markDirty(boardId: string) {
  const s = useBoardStore.getState();
  if (!s.dirtyIds.includes(boardId)) useBoardStore.setState({ dirtyIds: [...s.dirtyIds, boardId] });
  const prev = saveTimers.get(boardId);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    boardId,
    setTimeout(() => {
      saveTimers.delete(boardId);
      void flushSave(boardId);
    }, SAVE_DEBOUNCE_MS),
  );
}

function patchBoard(boardId: string, fn: (b: Board) => Board) {
  useBoardStore.setState((s) => ({
    boards: s.boards.map((b) => (b.id === boardId ? { ...fn(b), updatedAt: Date.now() } : b)),
  }));
  markDirty(boardId);
}

async function flushSave(boardId: string) {
  const myEpoch = epoch;
  if (deletedBoardIds.has(boardId)) return;
  const before = useBoardStore.getState().boards.find((b) => b.id === boardId);
  if (!before) return;
  try {
    const r = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(before),
    }).then((x) => x.json());
    if (epoch !== myEpoch) return;
    if (r.error) throw new Error(r.error);
    // POST 飞行期间被删的画布：马上补一刀 DELETE，抵消 upsert 的复活。
    if (deletedBoardIds.has(boardId)) {
      void fetch("/api/boards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: boardId }),
      }).catch(() => undefined);
      return;
    }
    // 保存期间没有新改动才清 dirty（对象引用未变 = 没被 patch 过）。
    const now = useBoardStore.getState();
    if (now.boards.find((b) => b.id === boardId) === before) {
      useBoardStore.setState({ dirtyIds: now.dirtyIds.filter((d) => d !== boardId) });
    }
  } catch (e) {
    if (epoch !== myEpoch) return;
    diag("warn", "画布", "画布保存失败，稍后自动重试", (e as Error)?.message || String(e));
    // 失败必须自己续命重试：下一次 markDirty 可能永远不来（用户改完就不动了）。
    if (!saveTimers.has(boardId) && !deletedBoardIds.has(boardId)) {
      saveTimers.set(
        boardId,
        setTimeout(() => {
          saveTimers.delete(boardId);
          void flushSave(boardId);
        }, 5000),
      );
    }
  }
}

// ── 提交/轮询引擎（模块级，组件卸载不中断） ────────────────────────────────

function updateGen(genId: string, patch: Partial<BoardGen>) {
  useBoardStore.setState((s) => ({ gens: s.gens.map((g) => (g.id === genId ? { ...g, ...patch } : g)) }));
}

function genAlive(genId: string, myEpoch: number): BoardGen | null {
  if (epoch !== myEpoch) return null;
  return useBoardStore.getState().gens.find((g) => g.id === genId) ?? null;
}

async function submitGen(genId: string, myEpoch: number) {
  const gen = genAlive(genId, myEpoch);
  if (!gen) return;
  diag(
    "info",
    "画布",
    "提交生成请求",
    JSON.stringify(
      {
        model: gen.payload.model,
        resolution: gen.payload.resolution,
        aspectRatio: gen.payload.aspectRatio,
        count: gen.payload.count,
        refs: gen.payload.refImages?.length ?? 0,
        textOnly: !!gen.payload.textOnly,
        inpaint: !!gen.inpaintJob,
      },
      null,
      2,
    ),
  );
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gen.payload),
    }).then((r) => r.json());
    if (!genAlive(genId, myEpoch)) return;
    if (res.error) {
      updateGen(genId, { status: "failed", error: res.error });
      toast("error", res.error);
      diag("error", "画布", "提交失败", res.error);
      return;
    }
    const ids = ((res.jobs as { id: string }[]) || []).map((j) => j.id);
    if (!ids.length) {
      updateGen(genId, { status: "failed", error: "提交响应异常" });
      return;
    }
    updateGen(genId, { status: "running", jobIds: ids, startedAt: Date.now() });
    void pollGen(genId, ids, myEpoch);
  } catch (e) {
    if (!genAlive(genId, myEpoch)) return;
    updateGen(genId, { status: "failed", error: "提交失败，请检查网络" });
    diag("error", "画布", "提交失败，请检查网络", (e as Error)?.message || String(e));
  }
}

async function pollGen(genId: string, jobIds: string[], myEpoch: number) {
  const imgs: (string[] | null)[] = jobIds.map(() => null);
  const errs: (string | null)[] = jobIds.map(() => null);
  const prog: number[] = jobIds.map(() => 0);
  let done = 0;

  await Promise.all(
    jobIds.map(async (jobId, i) => {
      while (true) {
        if (!genAlive(genId, myEpoch)) return;
        try {
          const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`).then((x) => x.json());
          if (!genAlive(genId, myEpoch)) return;
          if (r.status === "success") {
            imgs[i] = r.images || [];
            prog[i] = 1;
            done++;
            break;
          }
          if (r.status === "failed") {
            errs[i] = r.error || "生成失败";
            prog[i] = 1;
            done++;
            break;
          }
          prog[i] = typeof r.progress === "number" ? r.progress : prog[i];
          updateGen(genId, { progress: prog.reduce((a, b) => a + b, 0) / jobIds.length });
        } catch {
          // 网络抖动：静默重试（batchStore 同款策略）
        }
        await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      }
      updateGen(genId, { progress: prog.reduce((a, b) => a + b, 0) / jobIds.length });
    }),
  );

  const gen = genAlive(genId, myEpoch);
  if (!gen || done < jobIds.length) return;
  const urls = imgs.filter(Boolean).flat() as string[];
  if (!urls.length) {
    const e = errs.find(Boolean) || "生成失败";
    updateGen(genId, { status: "failed", error: e });
    toast("error", e);
    return;
  }
  await finalizeGen(gen, urls, myEpoch);
  const failed = errs.filter(Boolean).length;
  if (failed) toast("info", `部分完成：${urls.length} 张成功 · ${failed} 个任务未成功`);
}

/** 结果落卡。局部重绘先在前端把结果块羽化合成回原图，再把完整合成图 PUT 回
 *  服务端覆盖该 job 的资产（历史里看到的才是整图，同 Studio.tsx finish()）。 */
async function finalizeGen(gen: BoardGen, urls: string[], myEpoch: number) {
  const results: { asset: string; natW: number; natH: number }[] = [];
  for (const url of urls) {
    // /api/jobs/[id] 在本地落盘失败时会回退成上游直链 —— 那不是我们的资产，
    // 没有持久文件名，无法落卡（历史里也不会有），跳过并留诊断。
    if (!url.startsWith("/api/media/")) {
      diag("warn", "画布", "结果未保存到本站存储，无法落卡", url);
      continue;
    }
    const name = decodeURIComponent(url.split("/").pop() || "");
    if (!name) continue;
    try {
      if (gen.inpaintJob) {
        const { blob } = await compositeInpaintResult(gen.inpaintJob, boardMediaBytesUrl(name));
        const base = name.replace(/\.[a-z0-9]+$/i, "");
        const put = await fetch(`/api/media/${encodeURIComponent(base)}.png`, {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: blob,
        });
        if (!put.ok) throw new Error(`HTTP ${put.status}`);
        const img = await loadImage(URL.createObjectURL(blob));
        results.push({ asset: `${base}.png`, natW: img.naturalWidth, natH: img.naturalHeight });
        continue;
      }
      const img = await loadImage(url);
      results.push({ asset: name, natW: img.naturalWidth, natH: img.naturalHeight });
    } catch (e) {
      // 合成/测量失败：退回原始结果，卡片仍要落板
      diag("warn", "画布", "结果处理失败，已回退原始生成图", `${name}: ${(e as Error)?.message || String(e)}`);
      results.push({ asset: name, natW: 1024, natH: 1024 });
    }
  }

  if (!genAlive(gen.id, myEpoch)) return;
  const s = useBoardStore.getState();
  if (!results.length) {
    useBoardStore.setState({ gens: s.gens.filter((g) => g.id !== gen.id) });
    toast("info", "生成完成，但结果未能保存到本站存储，请到诊断台查看");
    return;
  }
  const board = s.boards.find((b) => b.id === gen.boardId);
  if (!board) {
    // 画布已被删：结果仍在资产页
    useBoardStore.setState({ gens: s.gens.filter((g) => g.id !== gen.id) });
    toast("info", "生成完成，但画布已删除 —— 结果可在资产页找到");
    return;
  }

  let z = board.cards.reduce((m, c) => Math.max(m, c.z), 0);
  const cards: BoardCard[] = results.map((r, i) => {
    const w = DEFAULT_CARD_W;
    const h = Math.round((w * r.natH) / r.natW) || w;
    return {
      id: newId(),
      asset: r.asset,
      x: gen.anchor.x + i * (w + PLACE_GAP),
      y: gen.anchor.y,
      w,
      h,
      z: ++z,
      natW: r.natW,
      natH: r.natH,
    };
  });
  // 满板保护：截掉的必须明说 —— 静默丢结果比报错更伤（图在资产页仍找得到）。
  const room = Math.max(0, MAX_BOARD_CARDS - board.cards.length);
  const placed = cards.slice(0, room);
  if (placed.length) patchBoard(board.id, (b) => ({ ...b, cards: [...b.cards, ...placed].slice(0, MAX_BOARD_CARDS) }));
  useBoardStore.setState((st) => ({ gens: st.gens.filter((g) => g.id !== gen.id) }));
  if (placed.length < cards.length) {
    toast("info", `画布已达 ${MAX_BOARD_CARDS} 张上限，${cards.length - placed.length} 张结果未落板（可在资产页找到）`);
  } else {
    toast("success", "生成完成");
  }
  const secs = ((Date.now() - gen.startedAt) / 1000).toFixed(1);
  diag("info", "画布", `生成完成 ${placed.length} 张，耗时 ${secs}s`);
  // 资产页共享的历史列表也刷一下
  fetch("/api/history")
    .then((r) => r.json())
    .then((h) => useStudio.getState().setHistory(h.items || []))
    .catch(() => undefined);
}

// ── 上传/落卡辅助（BoardWorkshop 调用） ─────────────────────────────────────

const RAW_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** 把一个图片文件变成画布卡片素材：png/jpeg/webp 原样上传（保真），其他格式
 *  先转码成 JPEG。返回 asset 文件名 + 自然尺寸。 */
export async function uploadBoardImage(file: File | Blob): Promise<{ asset: string; natW: number; natH: number }> {
  let blob: Blob = file;
  if (!RAW_UPLOAD_TYPES.has(file.type)) {
    const { fileToDownscaledDataURL } = await import("./utils");
    const { dataUrl } = await fileToDownscaledDataURL(file, 4096, 0.95);
    blob = await (await fetch(dataUrl)).blob();
  }
  const bitmap = await createImageBitmap(blob);
  const natW = bitmap.width;
  const natH = bitmap.height;
  bitmap.close?.();
  const fd = new FormData();
  fd.append("file", blob, (file as File).name || "image");
  const r = await fetch("/api/boards/upload", { method: "POST", body: fd }).then((x) => x.json());
  if (r.error || !r.name) throw new Error(r.error || "上传失败");
  return { asset: r.name as string, natW, natH };
}

/** dataURL（裁剪/贴图合成的结果）→ 持久资产。 */
export async function uploadBoardDataUrl(dataUrl: string): Promise<{ asset: string; natW: number; natH: number }> {
  const blob = await (await fetch(dataUrl)).blob();
  return uploadBoardImage(blob);
}

/** 秒上板一条龙：本地量尺寸 → 即时落卡（blob 预览）→ 后台上传 → 写回 asset。
 *  上传失败自动撤卡并 toast。返回落下的卡片（满板等落卡失败时返回 null）。
 *  单图创作「瞬间见图」的体感来自全程无网络等待 —— 这里把网络挪到了后台。 */
export async function placeBoardImage(
  file: File | Blob,
  at: { x: number; y: number },
  opts?: { boardId?: string; select?: boolean; label?: string; anchorTopLeft?: boolean; w?: number },
): Promise<BoardCard | null> {
  // 尺寸在本地读（毫秒级）；失败说明不是可解码图片，直接报错不落卡。
  let natW: number;
  let natH: number;
  try {
    const bitmap = await createImageBitmap(file);
    natW = bitmap.width;
    natH = bitmap.height;
    bitmap.close?.();
  } catch {
    toast("error", "无法读取该图片");
    return null;
  }
  const w = opts?.w ?? DEFAULT_CARD_W;
  const h = Math.round((w * natH) / natW) || w;
  const localSrc = URL.createObjectURL(file);
  const card = useBoardStore.getState().addLocalCard(
    {
      x: opts?.anchorTopLeft ? at.x : at.x - w / 2,
      y: opts?.anchorTopLeft ? at.y : at.y - h / 2,
      w,
      h,
      natW,
      natH,
      label: opts?.label,
    },
    localSrc,
    { select: opts?.select, boardId: opts?.boardId },
  );
  if (!card) {
    URL.revokeObjectURL(localSrc);
    return null;
  }
  void (async () => {
    const myEpoch = epoch;
    try {
      const up = await uploadBoardImage(file);
      if (epoch !== myEpoch) return;
      useBoardStore.getState().finishCardUpload(card.id, up.asset);
    } catch (e) {
      if (epoch !== myEpoch) return;
      useBoardStore.getState().failCardUpload(card.id, (e as Error)?.message || "上传失败");
    }
  })();
  return card;
}
