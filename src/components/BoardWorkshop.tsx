"use client";

// 画布工作区（PLAN-BOARD）：左侧画布列表 + 右侧无限画板 + 底部生成对话框。
// 交互模型：滚轮以光标为中心缩放，拖空白处平移，拖卡片移动；选中卡片出
// 浮动工具条（参考图标记 / 裁剪 / 局部重绘 / 贴图 / 下载 / 删除）。生成
// 由 boardStore 的模块级引擎驱动，切走标签页不中断；结果以卡片落回画板。

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_STARTERS,
  MAX_BOARD_SCALE,
  MIN_BOARD_SCALE,
  type Board,
  type BoardCard,
} from "@/lib/board";
import {
  DEFAULT_CARD_W,
  boardMediaUrl,
  boardWorldCenter,
  cardDisplaySrc,
  cardPixelSrc,
  placeBoardImage,
  registerBoardCanvasEl,
  useBoardStore,
  type BoardGen,
} from "@/lib/boardStore";
import { ASPECT_RATIOS, BILLINGS, comboError, GPT_IMAGE_2_RATIOS, MODELS, QUALITY_OPTIONS, resolutionsFor } from "@/lib/models";
import { extractImageText, PNG_META_KEYWORD } from "@/lib/pngMeta";
import { useStudio } from "@/lib/store";
import { parseEmbeddedMeta } from "@/lib/templates";
import type { Billing, HistoryItem, ModelName, Quality, Resolution } from "@/lib/types";
import { cn, downloadUrl, fakeProgressCurve, progressStageLabel } from "@/lib/utils";
import { BrushPanel } from "./BrushPanel";
import { CropPanel } from "./CropPanel";
import { Icon } from "./icons";
import { ModelIcon } from "./modelIcons";
import { StickerPanel } from "./StickerPanel";
import { Button, Segmented, Select } from "./ui";

const CARD_DRAG_THRESHOLD = 4; // px：低于它算点击（只选中），高于算拖动

type EditPanel = { kind: "crop" | "brush" | "sticker"; cardId: string } | null;

/** 拖动 scratch 状态放 ref：pointermove 不应触发额外渲染（同 StickerPanel）。 */
interface DragState {
  mode: "pan" | "card";
  pointerId: number;
  startX: number;
  startY: number;
  vpX: number;
  vpY: number;
  cardId?: string;
  cardX?: number;
  cardY?: number;
  moved: boolean;
}

export function BoardWorkshop() {
  const boards = useBoardStore((s) => s.boards);
  const activeId = useBoardStore((s) => s.activeId);
  const loaded = useBoardStore((s) => s.loaded);
  const loadBoards = useBoardStore((s) => s.loadBoards);
  const board = useMemo(() => boards.find((b) => b.id === activeId) ?? null, [boards, activeId]);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <BoardRail boards={boards} activeId={activeId} />
      {!loaded ? (
        <div className="flex flex-1 items-center justify-center text-sm text-fg-mute">
          <Icon name="CircleNotch" size={18} className="mr-2 animate-spin" />
          正在读取画布…
        </div>
      ) : board ? (
        <BoardCanvas key={board.id} board={board} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-fg-mute">左侧新建一块画布开始</div>
      )}
    </div>
  );
}

// ── 左侧画布列表 ────────────────────────────────────────────────────────────

function BoardRail({ boards, activeId }: { boards: Board[]; activeId: string | null }) {
  const setActive = useBoardStore((s) => s.setActive);
  const createBoard = useBoardStore((s) => s.createBoard);
  const renameBoard = useBoardStore((s) => s.renameBoard);
  const removeBoard = useBoardStore((s) => s.removeBoard);
  const gens = useBoardStore((s) => s.gens);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 两步删除的解除：3 秒不点第二下自动收回
  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDeleteId]);

  function commitRename() {
    if (renamingId && renameText.trim()) renameBoard(renamingId, renameText);
    setRenamingId(null);
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-ink-2/40">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <Icon name="FrameCorners" size={16} className="text-accent" />
          <span className="text-sm font-medium text-fg">画布</span>
          <span className="text-xs text-fg-mute">{boards.length}</span>
        </div>
        <button
          type="button"
          onClick={() => createBoard()}
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-white/5 hover:text-fg"
          title="新建空白画布"
          aria-label="新建空白画布"
        >
          <Icon name="Plus" size={15} weight="bold" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {boards.map((b) => {
          const running = gens.some((g) => g.boardId === b.id && g.status !== "failed");
          return (
            <div
              key={b.id}
              className={cn(
                "group mb-1 flex cursor-pointer items-center gap-2 rounded-control border px-2.5 py-2 transition-colors",
                b.id === activeId
                  ? "border-accent/40 bg-accent/[0.08]"
                  : "border-transparent hover:border-line hover:bg-white/[0.03]",
              )}
              onClick={() => setActive(b.id)}
              onDoubleClick={() => {
                setRenamingId(b.id);
                setRenameText(b.name);
              }}
            >
              <div className="min-w-0 flex-1">
                {renamingId === b.id ? (
                  <input
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded border border-accent bg-panel-2 px-1.5 py-0.5 text-sm text-fg focus:outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className={cn("truncate text-sm", b.id === activeId ? "text-fg" : "text-fg-dim")}>{b.name}</span>
                    {running ? <span className="breathe h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                  </div>
                )}
                <div className="mt-0.5 text-[11px] text-fg-mute">{b.cards.length} 张卡片</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmDeleteId === b.id) {
                    setConfirmDeleteId(null);
                    void removeBoard(b.id);
                  } else {
                    setConfirmDeleteId(b.id);
                  }
                }}
                className={cn(
                  "flex h-6 shrink-0 items-center justify-center rounded-full transition-all",
                  confirmDeleteId === b.id
                    ? "w-auto bg-red-400/15 px-2 text-[11px] text-red-300"
                    : "w-6 text-fg-mute opacity-0 hover:bg-white/10 hover:text-red-300 group-hover:opacity-100",
                )}
                title="删除画布（不会删除已生成到资产的图片）"
              >
                {confirmDeleteId === b.id ? "确认删除?" : <Icon name="Trash" size={13} />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-2.5 py-3">
        <div className="px-1.5 pb-1.5 text-[11px] font-medium tracking-wide text-fg-mute">从预设新建</div>
        {BOARD_STARTERS.filter((s) => s.id !== "starter-blank").map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => createBoard(s)}
            title={s.notes}
            className="mb-1 flex w-full items-center gap-2.5 rounded-control border border-transparent px-2.5 py-2 text-left transition-colors hover:border-line hover:bg-white/[0.03]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.05] text-accent">
              <Icon name={s.icon} size={15} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-fg-dim">{s.name}</span>
              <span className="block truncate text-[11px] leading-tight text-fg-mute">{s.notes}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ── 画板本体 ────────────────────────────────────────────────────────────────

function BoardCanvas({ board }: { board: Board }) {
  const selectedId = useBoardStore((s) => s.selectedId);
  const selectCard = useBoardStore((s) => s.selectCard);
  const moveCard = useBoardStore((s) => s.moveCard);
  const commitCard = useBoardStore((s) => s.commitCard);
  const removeCard = useBoardStore((s) => s.removeCard);
  const bringToFront = useBoardStore((s) => s.bringToFront);
  const toggleRef = useBoardStore((s) => s.toggleRef);
  const setViewport = useBoardStore((s) => s.setViewport);
  const setMask = useBoardStore((s) => s.setMask);
  const cardMasks = useBoardStore((s) => s.cardMasks);
  const localSrcs = useBoardStore((s) => s.localSrcs);
  const uploadingIds = useBoardStore((s) => s.uploadingIds);
  const gens = useBoardStore((s) => s.gens);
  const updateBoardParams = useBoardStore((s) => s.updateBoardParams);
  const assetPickerOpen = useBoardStore((s) => s.assetPickerOpen);
  const openAssetPicker = useBoardStore((s) => s.openAssetPicker);
  const showToast = useStudio((s) => s.showToast);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  // dragRef 是 ref（pointermove 不为它触发渲染），但工具条隐藏/光标样式需要
  // 响应式 —— 拖动的「开始/结束」用这个 state 广播（低频，只在起落各写一次）。
  const [dragging, setDragging] = useState<"pan" | "card" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editPanel, setEditPanel] = useState<EditPanel>(null);

  const vp = board.viewport;
  const boardGens = useMemo(() => gens.filter((g) => g.boardId === board.id), [gens, board.id]);
  const selectedCard = board.cards.find((c) => c.id === selectedId) ?? null;

  // 视口中心换算需要真实容器矩形（placeRow / 资产选择器用），挂载即注册。
  useEffect(() => {
    registerBoardCanvasEl(containerRef.current);
    return () => registerBoardCanvasEl(null);
  }, []);

  // ── 视口换算 ──
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left - vp.x) / vp.scale, y: (clientY - rect.top - vp.y) / vp.scale };
    },
    [vp],
  );

  // 滚轮缩放需要非被动监听（React onWheel 默认 passive，preventDefault 无效
  // —— 同 StickerPanel 的写法），以光标为不动点。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useBoardStore.getState();
      const b = s.boards.find((x) => x.id === board.id);
      if (!b) return;
      const cur = b.viewport;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const scale = Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, cur.scale * factor));
      // 光标下的世界点在缩放前后保持屏幕位置不变
      const wx = (px - cur.x) / cur.scale;
      const wy = (py - cur.y) / cur.scale;
      s.setViewport({ x: px - wx * scale, y: py - wy * scale, scale });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [board.id]);

  // ── 平移 / 卡片拖动 ──
  function onCanvasPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "pan", pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, vpX: vp.x, vpY: vp.y, moved: false };
  }
  function onCardPointerDown(e: React.PointerEvent, card: BoardCard) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    selectCard(card.id);
    bringToFront(card.id);
    dragRef.current = {
      mode: "card",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      vpX: vp.x,
      vpY: vp.y,
      cardId: card.id,
      cardX: card.x,
      cardY: card.y,
      moved: false,
    };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < CARD_DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(d.mode);
    }
    if (d.mode === "pan") {
      setViewport({ x: d.vpX + dx, y: d.vpY + dy, scale: vp.scale });
    } else if (d.cardId != null) {
      moveCard(d.cardId, d.cardX! + dx / vp.scale, d.cardY! + dy / vp.scale);
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    if (d.mode === "card" && d.moved) commitCard();
    if (d.mode === "pan" && !d.moved) selectCard(null); // 点空白 = 取消选中
  }

  // ── 文件进板（拖放 / 粘贴 / 选择）：秒上板，上传全在后台 ──
  const ingestFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      const images = files.filter((f) => !f.type || f.type.startsWith("image/"));
      if (images.length < files.length) showToast("error", "请选择图片文件");
      if (!images.length) return;
      // 落卡/还原参数都锁定发起时的画布（上传是后台异步，用户可能切走）。
      const boardId = board.id;
      const base = at ?? boardWorldCenter(vp);
      let placed = 0;
      for (const file of images) {
        // TVision 生成图自带配方（PNG iTXt）：顺手还原到本画布的参数。
        // 读的是本地文件字节，不等网络。
        try {
          const meta = extractImageText(new Uint8Array(await file.arrayBuffer()), PNG_META_KEYWORD);
          const params = meta ? parseEmbeddedMeta(meta) : null;
          if (params) {
            updateBoardParams(params, boardId);
            showToast("success", "检测到 TVision 生成信息，已还原提示词与参数");
          }
        } catch {
          // 元数据是锦上添花，失败不影响上板
        }
        const card = await placeBoardImage(
          file,
          { x: base.x + placed * 32, y: base.y + placed * 32 },
          {
            boardId,
            select: images.length === 1,
            label: (file.name || "").replace(/\.[a-z0-9]+$/i, "") || undefined,
          },
        );
        if (card) placed++;
      }
    },
    [board.id, showToast, updateBoardParams, vp],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const files: File[] = [];
      for (const it of Array.from(e.clipboardData?.items || [])) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        void ingestFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [ingestFiles]);

  // Delete 删卡 / Escape 取消选中（输入框里不劫持）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (editPanel || assetPickerOpen) return;
      const sel = useBoardStore.getState().selectedId;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        removeCard(sel);
      }
      if (e.key === "Escape") selectCard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editPanel, assetPickerOpen, removeCard, selectCard]);

  // ── 缩放控件 ──
  function zoomBy(factor: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    const px = (rect?.width ?? 800) / 2;
    const py = (rect?.height ?? 600) / 2;
    const scale = Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, vp.scale * factor));
    const wx = (px - vp.x) / vp.scale;
    const wy = (py - vp.y) / vp.scale;
    setViewport({ x: px - wx * scale, y: py - wy * scale, scale });
  }
  function fitView() {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!board.cards.length) {
      setViewport({ x: 0, y: 0, scale: 1 });
      return;
    }
    const minX = Math.min(...board.cards.map((c) => c.x));
    const minY = Math.min(...board.cards.map((c) => c.y));
    const maxX = Math.max(...board.cards.map((c) => c.x + c.w));
    const maxY = Math.max(...board.cards.map((c) => c.y + c.h));
    const pad = 80;
    const scale = Math.min(
      MAX_BOARD_SCALE,
      Math.max(MIN_BOARD_SCALE, Math.min(rect.width / (maxX - minX + pad * 2), rect.height / (maxY - minY + pad * 2))),
    );
    setViewport({
      x: rect.width / 2 - ((minX + maxX) / 2) * scale,
      y: rect.height / 2 - ((minY + maxY) / 2) * scale,
      scale,
    });
  }

  // ── 快捷编辑落卡（裁剪/贴图结果作为新卡片放在原卡旁边，不覆盖原图） ──
  // 秒上板：合成结果立即显示，持久化在后台。
  async function placeEditedNextTo(card: BoardCard, res: { dataUrl: string; width: number; height: number }, label: string) {
    try {
      const blob = await (await fetch(res.dataUrl)).blob();
      await placeBoardImage(
        blob,
        { x: card.x + card.w + 32, y: card.y },
        { boardId: board.id, select: true, label, anchorTopLeft: true, w: card.w },
      );
      showToast("success", `${label}完成 · ${res.width}×${res.height}`);
    } catch (e) {
      showToast("error", (e as Error)?.message || `${label}保存失败`);
    }
  }

  const editingCard = editPanel ? board.cards.find((c) => c.id === editPanel.cardId) ?? null : null;
  const editingImage = editingCard
    ? { src: cardPixelSrc(editingCard), width: editingCard.natW, height: editingCard.natH }
    : null;

  // 工具条的屏幕位置（世界 → 屏幕），跟随选中卡片
  const toolbarPos = selectedCard
    ? { left: (selectedCard.x + selectedCard.w / 2) * vp.scale + vp.x, top: selectedCard.y * vp.scale + vp.y - 14 }
    : null;
  const refIndex = selectedCard ? board.refs.indexOf(selectedCard.id) : -1;

  const isEmpty = board.cards.length === 0 && boardGens.length === 0;

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        className={cn("absolute inset-0 touch-none", dragOver && "bg-accent/[0.04]")}
        style={{
          cursor: dragging === "pan" ? "grabbing" : "default",
          backgroundImage: "radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: `${24 * vp.scale}px ${24 * vp.scale}px`,
          backgroundPosition: `${vp.x}px ${vp.y}px`,
        }}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer?.files || []);
          if (files.length) void ingestFiles(files, toWorld(e.clientX, e.clientY));
        }}
      >
        {/* 世界层：卡片按世界坐标绝对定位 */}
        <div className="absolute left-0 top-0" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`, transformOrigin: "0 0" }}>
          {board.cards.map((card) => (
            <CardView
              key={card.id}
              card={card}
              src={localSrcs[card.id] ?? boardMediaUrl(card.asset)}
              uploading={!!uploadingIds[card.id]}
              selected={card.id === selectedId}
              refIndex={board.refs.indexOf(card.id)}
              hasMask={!!cardMasks[card.id]}
              onPointerDown={(e) => onCardPointerDown(e, card)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          ))}
          {boardGens.map((gen) => (
            <GenGhosts key={gen.id} gen={gen} />
          ))}
        </div>

        {/* 空板引导 */}
        {isEmpty ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-40">
            {/* stopPropagation 必不可少：pointerdown 冒泡到容器会被 setPointerCapture
                劫持成一次平移，后续 click 就再也到不了这两个按钮。 */}
            <div
              className="pointer-events-auto flex flex-col items-center gap-4 rounded-[24px] border border-dashed border-line-2 px-12 py-10 text-center"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-white/[0.03] text-fg-dim">
                <Icon name="FrameCorners" size={26} />
              </span>
              <div>
                <div className="text-base font-medium text-fg">拖入 / 粘贴图片，摆上画板</div>
                <div className="mt-1 text-sm text-fg-mute">选中图片标记参考，用下方对话框生成 —— 结果自动落回画板</div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => fileInputRef.current?.click()}>
                  <Icon name="UploadSimple" size={14} />
                  上传图片
                </Button>
                <Button variant="ghost" onClick={openAssetPicker}>
                  <Icon name="Stack" size={14} />
                  从资产选择
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 选中卡片工具条 */}
        {selectedCard && toolbarPos && !dragging ? (
          <div
            className="absolute z-30 -translate-x-1/2 -translate-y-full"
            style={{ left: toolbarPos.left, top: toolbarPos.top }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="glass flex h-10 items-center gap-0.5 rounded-full px-1.5">
              <ToolbarButton
                icon="ImageSquare"
                label={refIndex >= 0 ? (refIndex === 0 ? "取消主图" : `取消参考（图 ${refIndex + 1}）`) : "设为参考图"}
                active={refIndex >= 0}
                onClick={() => toggleRef(selectedCard.id)}
              />
              <span className="mx-0.5 h-4 w-px bg-line" />
              <ToolbarButton icon="Crop" label="裁剪（结果生成新卡片）" onClick={() => setEditPanel({ kind: "crop", cardId: selectedCard.id })} />
              <ToolbarButton icon="PaintBrush" label="局部重绘（涂抹后在对话框生成）" onClick={() => setEditPanel({ kind: "brush", cardId: selectedCard.id })} />
              <ToolbarButton icon="Sticker" label="贴图（结果生成新卡片）" onClick={() => setEditPanel({ kind: "sticker", cardId: selectedCard.id })} />
              <span className="mx-0.5 h-4 w-px bg-line" />
              <ToolbarButton
                icon="DownloadSimple"
                label={selectedCard.asset ? "下载原图" : "上传完成后可下载"}
                onClick={() => {
                  if (selectedCard.asset) downloadUrl(boardMediaUrl(selectedCard.asset), selectedCard.asset);
                  else showToast("info", "图片还在上传，稍候再下载");
                }}
              />
              <ToolbarButton icon="Trash" label="从画板移除（资产仍保留）" danger onClick={() => removeCard(selectedCard.id)} />
            </div>
          </div>
        ) : null}

        {/* 右下角缩放控件 */}
        <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <div className="glass flex h-9 items-center gap-0.5 rounded-full px-1">
            <ToolbarButton icon="ArrowsOutSimple" label="适应全部卡片" onClick={fitView} />
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.25)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-fg-dim hover:bg-white/10 hover:text-fg"
              aria-label="缩小"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setViewport({ ...vp, scale: 1 })}
              className="min-w-11 rounded-full px-1 text-center text-[11px] text-fg-mute hover:text-fg"
              title="恢复 100%"
            >
              {Math.round(vp.scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1.25)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-fg-dim hover:bg-white/10 hover:text-fg"
              aria-label="放大"
            >
              ＋
            </button>
          </div>
        </div>

        {/* 左上角：上传 / 从资产添加 */}
        <div className="absolute left-4 top-4 z-20 flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="glass flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-fg-dim transition-colors hover:text-fg"
          >
            <Icon name="UploadSimple" size={13} />
            上传
          </button>
          <button
            type="button"
            onClick={openAssetPicker}
            className="glass flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-fg-dim transition-colors hover:text-fg"
          >
            <Icon name="Stack" size={13} />
            从资产
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) void ingestFiles(files);
          e.target.value = "";
        }}
      />

      <BoardGenDialog board={board} />

      <AnimatePresence>
        {editPanel?.kind === "crop" && editingImage && editingCard ? (
          <CropPanel
            key="board-crop"
            override={{
              image: editingImage,
              onApply: (res) => placeEditedNextTo(editingCard, res, "裁剪"),
              onClose: () => setEditPanel(null),
            }}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {editPanel?.kind === "brush" && editingImage && editingCard ? (
          <BrushPanel
            key="board-brush"
            override={{
              image: editingImage,
              onApply: (mask) => setMask(editingCard.id, mask),
              onClose: () => setEditPanel(null),
            }}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {editPanel?.kind === "sticker" && editingImage && editingCard ? (
          <StickerPanel
            key="board-sticker"
            override={{
              image: editingImage,
              onApply: (res) => placeEditedNextTo(editingCard, res, "贴图"),
              onClose: () => setEditPanel(null),
            }}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>{assetPickerOpen ? <AssetPicker /> : null}</AnimatePresence>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
        active ? "bg-accent/20 text-accent" : "text-fg-dim hover:bg-white/10",
        danger ? "hover:text-red-300" : "hover:text-fg",
      )}
    >
      <Icon name={icon} size={14} weight={active ? "bold" : "regular"} />
    </button>
  );
}

// ── 卡片 ────────────────────────────────────────────────────────────────────

function CardView({
  card,
  src,
  uploading,
  selected,
  refIndex,
  hasMask,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  card: BoardCard;
  /** 本地预览优先的显示地址（秒上板期间是 blob:，之后是 /api/media/…）。 */
  src: string;
  uploading: boolean;
  selected: boolean;
  refIndex: number;
  hasMask: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className={cn(
        "absolute touch-none select-none overflow-hidden rounded-[10px] border transition-shadow",
        selected
          ? "border-accent shadow-[0_0_0_1px_var(--color-accent),0_18px_50px_-12px_rgba(0,0,0,0.7)]"
          : "border-line hover:border-line-2",
      )}
      style={{ left: card.x, top: card.y, width: card.w, height: card.h, zIndex: card.z, cursor: "move" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={card.label || card.asset}
        draggable={false}
        loading="lazy"
        className="pointer-events-none h-full w-full select-none object-cover"
      />
      {refIndex >= 0 ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 flex h-5 items-center rounded-md border border-accent/40 bg-black/65 px-1.5 text-[10px] font-medium text-accent backdrop-blur-sm">
          {refIndex === 0 ? "主图" : `图 ${refIndex + 1}`}
        </span>
      ) : null}
      {uploading ? (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex h-5 items-center gap-1 rounded-md bg-black/65 px-1.5 text-[10px] text-fg-dim backdrop-blur-sm">
          <Icon name="CircleNotch" size={10} className="animate-spin" />
          保存中
        </span>
      ) : null}
      {hasMask ? (
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-5 items-center gap-1 rounded-md border border-accent/40 bg-black/65 px-1.5 text-[10px] text-accent backdrop-blur-sm">
          <Icon name="PaintBrush" size={10} />
          待重绘
        </span>
      ) : null}
      {card.label ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-3 text-[10px] text-fg-dim">
          {card.label}
        </span>
      ) : null}
    </div>
  );
}

// ── 生成中的幽灵卡片 ────────────────────────────────────────────────────────

function GenGhosts({ gen }: { gen: BoardGen }) {
  const retryGen = useBoardStore((s) => s.retryGen);
  const dismissGen = useBoardStore((s) => s.dismissGen);
  // 300ms 假进度节拍（fakeProgressCurve 与真实完成度取大者，同单图创作）
  const [, setTick] = useState(0);
  useEffect(() => {
    if (gen.status === "failed") return;
    const id = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(id);
  }, [gen.status]);

  const elapsed = (Date.now() - gen.startedAt) / 1000;
  const pct = gen.status === "failed" ? 0 : Math.min(96, Math.max(fakeProgressCurve(elapsed), gen.progress * 100 * 0.9));

  return (
    <>
      {Array.from({ length: gen.count }, (_, i) => (
        <div
          key={`${gen.id}_${i}`}
          className={cn(
            "absolute overflow-hidden rounded-[10px] border",
            gen.status === "failed" ? "border-red-400/40 bg-red-400/[0.04]" : "border-line bg-white/[0.02]",
          )}
          style={{ left: gen.anchor.x + i * (gen.anchor.w + 32), top: gen.anchor.y, width: gen.anchor.w, height: gen.anchor.h, zIndex: 1 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {gen.status === "failed" ? (
            i === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2.5 p-4 text-center">
                <Icon name="Warning" size={20} className="text-red-300" />
                <div className="line-clamp-3 text-xs leading-relaxed text-fg-dim">{gen.error || "生成失败"}</div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => retryGen(gen.id)}
                    className="flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[11px] text-fg-dim hover:border-line-2 hover:text-fg"
                  >
                    <Icon name="ArrowClockwise" size={11} />
                    重试
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissGen(gen.id)}
                    className="flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[11px] text-fg-mute hover:text-fg"
                  >
                    <Icon name="X" size={11} />
                    移除
                  </button>
                </div>
              </div>
            ) : null
          ) : (
            <div className="shimmer absolute inset-0">
              <div className="absolute inset-x-4 bottom-4">
                <div className="mb-1.5 flex items-center justify-between text-[10px] text-fg-mute">
                  <span>{progressStageLabel(pct)}</span>
                  <span>{Math.round(pct)}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ── 底部生成对话框 ──────────────────────────────────────────────────────────

function BoardGenDialog({ board }: { board: Board }) {
  const updateBoardParams = useBoardStore((s) => s.updateBoardParams);
  const toggleRef = useBoardStore((s) => s.toggleRef);
  const cardMasks = useBoardStore((s) => s.cardMasks);
  const clearMask = useBoardStore((s) => s.clearMask);
  const startGeneration = useBoardStore((s) => s.startGeneration);
  const gens = useBoardStore((s) => s.gens);
  const showToast = useStudio((s) => s.showToast);
  const [collapsed, setCollapsed] = useState(false);

  const params = board.params;
  const resOptions = resolutionsFor(params.model);
  const maskCardId = Object.keys(cardMasks)[0];
  const maskCard = maskCardId ? board.cards.find((c) => c.id === maskCardId) : undefined;
  const refCards = board.refs
    .map((id) => board.cards.find((c) => c.id === id))
    .filter((c): c is BoardCard => !!c);
  const cErr = comboError(params.model, params.resolution, params.billing, params.aspectRatio);
  const runningCount = gens.filter((g) => g.boardId === board.id && g.status !== "failed").length;
  const canGenerate = !!params.prompt.trim() && !cErr;

  function onModel(v: string) {
    const model = v as ModelName;
    const rs = resolutionsFor(model);
    const resolution = rs.includes(params.resolution) ? params.resolution : rs[0];
    let aspectRatio = params.aspectRatio;
    if (model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(aspectRatio)) {
      aspectRatio = "auto";
      showToast("info", "已调整为 GPT Image 2 支持的比例");
    }
    updateBoardParams({ model, resolution, aspectRatio });
  }

  if (collapsed) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-4">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="glass pointer-events-auto flex h-11 items-center gap-2 rounded-full px-5 text-sm font-medium text-fg transition-colors hover:border-line-2"
        >
          <Icon name="Lightning" size={15} weight="fill" className="text-accent" />
          生成对话框
          {runningCount > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-fg-mute">
              <span className="breathe h-1.5 w-1.5 rounded-full bg-accent" />
              {runningCount} 个生成中
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="glass pointer-events-auto w-[min(880px,94%)] rounded-panel p-3.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 状态行：局部重绘 / 参考图 */}
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          {maskCard ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-2 pr-1 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-accent">
                <Icon name="PaintBrush" size={13} weight="bold" />
              </span>
              <span className="font-medium text-fg">局部重绘</span>
              <span className="text-xs text-fg-mute">{maskCard.label || "选中卡片"} · 其余参考图此次不参与</span>
              <button
                onClick={clearMask}
                className="flex h-6 w-6 items-center justify-center rounded-full text-fg-mute hover:bg-white/10 hover:text-fg"
                aria-label="取消局部重绘"
              >
                <Icon name="X" size={13} />
              </button>
            </span>
          ) : refCards.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {refCards.map((c, i) => (
                <span key={c.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cardDisplaySrc(c)} alt="" className="h-9 w-9 rounded-md border border-line object-cover" />
                  <span className="pointer-events-none absolute -left-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded bg-accent px-0.5 text-[9px] font-medium text-ink">
                    {i === 0 ? "主" : i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleRef(c.id)}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-black/80 text-fg-dim hover:text-fg group-hover:flex"
                    aria-label="取消参考"
                  >
                    <Icon name="X" size={9} />
                  </button>
                </span>
              ))}
              <span className="ml-1 text-xs text-fg-mute">第 1 张为主图，提示词可用「第 2 张图」指代其余参考</span>
            </div>
          ) : (
            <span className="text-sm text-fg-mute">未选参考 · 将按提示词直接文生图；选中画板图片可「设为参考图」</span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-fg-mute hover:bg-white/10 hover:text-fg"
            aria-label="收起对话框"
            title="收起"
          >
            <Icon name="CaretDown" size={13} />
          </button>
        </div>

        <textarea
          value={params.prompt}
          onChange={(e) => updateBoardParams({ prompt: e.target.value })}
          placeholder={maskCard ? "描述涂抹区域要改成什么…" : "描述你想生成的画面…"}
          rows={2}
          className="w-full resize-none rounded-control border border-line bg-panel-2/60 p-3 text-sm leading-relaxed text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Select
            value={params.model}
            onChange={onModel}
            options={MODELS.map((m) => ({ value: m.name, label: m.name, hint: m.blurb, icon: <ModelIcon model={m.name} size={16} /> }))}
            className="w-[184px]"
          />
          <Select
            value={params.resolution}
            onChange={(v) => updateBoardParams({ resolution: v as Resolution })}
            options={resOptions.map((r) => ({ value: r, label: r }))}
            className="w-[92px]"
          />
          <Select
            value={maskCard ? "auto" : params.aspectRatio}
            onChange={(v) => updateBoardParams({ aspectRatio: v })}
            options={
              maskCard
                ? [{ value: "auto", label: "按涂抹区域" }]
                : ASPECT_RATIOS.map((a) => ({
                    value: a,
                    label: a === "auto" ? "自动比例" : a,
                    disabled: params.model === "GPT Image 2" && !GPT_IMAGE_2_RATIOS.includes(a),
                  }))
            }
            disabled={!!maskCard}
            className="w-[116px]"
          />
          <Select
            value={params.billing}
            onChange={(v) => updateBoardParams({ billing: v as Billing })}
            options={BILLINGS.map((b) => ({ value: b, label: b }))}
            className="w-[88px]"
          />
          {params.model === "GPT Image 2" ? (
            <Select
              value={params.quality}
              onChange={(v) => updateBoardParams({ quality: v as Quality })}
              options={QUALITY_OPTIONS}
              className="w-[88px]"
            />
          ) : null}
          <Segmented
            value={params.count}
            onChange={(v) => updateBoardParams({ count: v })}
            options={[1, 2, 3, 4].map((n) => ({ value: n, label: `×${n}` }))}
          />

          <div className="ml-auto flex items-center gap-3">
            {runningCount > 0 ? (
              <span className="flex items-center gap-1.5 text-xs text-fg-mute">
                <span className="breathe h-1.5 w-1.5 rounded-full bg-accent" />
                {runningCount} 个生成中
              </span>
            ) : null}
            <Button variant="primary" onClick={() => void startGeneration()} disabled={!canGenerate} className="px-6">
              <Icon name="Lightning" size={16} weight="fill" />
              生成
            </Button>
          </div>
        </div>

        {cErr ? (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
            <Icon name="Warning" size={13} />
            {cErr}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}

// ── 从资产选择 ──────────────────────────────────────────────────────────────

function AssetPicker() {
  const close = useBoardStore((s) => s.closeAssetPicker);
  const addCard = useBoardStore((s) => s.addCard);
  const showToast = useStudio((s) => s.showToast);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [addedNames, setAddedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((j) => setItems(((j.items || []) as HistoryItem[]).filter((it) => !/\.mp4$/i.test(it.name))))
      .catch(() => {
        setItems([]);
        showToast("error", "读取资产失败");
      });
  }, [showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  async function pick(it: HistoryItem) {
    try {
      const img = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve({ w: el.naturalWidth, h: el.naturalHeight });
        el.onerror = () => reject(new Error("图片加载失败"));
        el.src = it.url;
      });
      const w = DEFAULT_CARD_W;
      const h = Math.round((w * img.h) / img.w) || w;
      const s = useBoardStore.getState();
      const b = s.boards.find((x) => x.id === s.activeId);
      const n = addedNames.size;
      const center = boardWorldCenter(b?.viewport ?? { x: 0, y: 0, scale: 1 });
      addCard({ asset: it.name, x: center.x - w / 2 + n * 32, y: center.y - h / 2 + n * 32, w, h, natW: img.w, natH: img.h });
      setAddedNames((prev) => new Set(prev).add(it.name));
    } catch {
      showToast("error", "添加失败");
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[96] bg-black/60 backdrop-blur-sm"
        onClick={close}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        className="glass fixed left-1/2 top-1/2 z-[97] flex max-h-[82dvh] w-[min(880px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="Stack" size={18} className="text-accent" />
            <span className="font-medium text-fg">从资产添加到画板</span>
            <span className="text-xs text-fg-mute">点击即添加，可连点多张</span>
          </div>
          <button onClick={close} className="text-fg-mute hover:text-fg" aria-label="关闭">
            <Icon name="X" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {items === null ? (
            <div className="flex items-center justify-center py-16 text-sm text-fg-mute">
              <Icon name="CircleNotch" size={16} className="mr-2 animate-spin" />
              读取中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-fg-mute">
              <Icon name="ImageSquare" size={26} />
              <span className="text-sm">资产里还没有图片</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
              {items.map((it) => (
                <button key={it.name} type="button" onClick={() => void pick(it)} className="group relative overflow-hidden rounded-control border border-line transition-colors hover:border-accent">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.url} alt={it.name} className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                  {addedNames.has(it.name) ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Icon name="Check" size={20} weight="bold" className="text-accent" />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
