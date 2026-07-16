"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { extractImageText, PNG_META_KEYWORD } from "@/lib/pngMeta";
import { useStudio } from "@/lib/store";
import {
  parseEmbeddedMeta,
  parseTemplateFile,
  PRESET_TEMPLATES,
  templateToFile,
  type Template,
} from "@/lib/templates";
import { cn, downloadUrl } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

// 模板库（PLAN-TEMPLATE，独立导航页）：预设模板（内置，不落盘、不可删）+
// 我的模板（data/templates.json）。点「使用」把配方写进单图创作的 params 并
// 切回 single 模式；「保存当前参数」反向读取 params 存成新模板 —— useStudio
// 在模式切换间不销毁，所以跨页读写没有时序问题。导入支持 .json 模板文件和
// TVision 生成的图片（PNG iTXt / JPEG COM 自带参数，见 pngMeta.ts）。
// 模板配图：data/template-images/<模板名>/ 里的图按「参考 / 效果」分类展示
// （约定式文件夹，用户手工放图 — 见该目录下的 说明.txt 和 API 路由注释）。

function paramChip(t: Template): string {
  const ratio = t.aspectRatio === "auto" ? "自动比例" : t.aspectRatio;
  return `${t.model} · ${t.resolution} · ${ratio} · ${t.billing}${t.count && t.count > 1 ? ` · ×${t.count}` : ""}`;
}

/** data/template-images 清单：模板名 → 参考图/效果图 URL 列表。 */
type MediaMap = Record<string, { refs: string[]; results: string[] }>;

export function TemplateWorkshop() {
  const image = useStudio((s) => s.image);
  const params = useStudio((s) => s.params);
  const updateParams = useStudio((s) => s.updateParams);
  const setWorkMode = useStudio((s) => s.setWorkMode);
  const showToast = useStudio((s) => s.showToast);

  const [items, setItems] = useState<Template[]>([]);
  const [media, setMedia] = useState<MediaMap>({});
  const [loading, setLoading] = useState(true);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => setItems(j.items || []))
      .catch(() => showToast("error", "读取模板失败"))
      .finally(() => setLoading(false));
    // 配图清单独立拉取：失败只影响展示图，不影响模板本身。
    fetch("/api/templates/media")
      .then((r) => r.json())
      .then((j) => setMedia(j.map || {}))
      .catch(() => {});
  }, [showToast]);

  function apply(t: Template) {
    updateParams({
      prompt: t.prompt,
      model: t.model,
      resolution: t.resolution,
      aspectRatio: t.aspectRatio,
      billing: t.billing,
      quality: t.quality ?? "auto",
      ...(t.count ? { count: t.count } : {}),
    });
    setWorkMode("single");
    showToast("success", image ? `已应用模板「${t.name}」` : `已应用模板「${t.name}」，请先添加图片`);
  }

  async function saveCurrent() {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const r = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          prompt: params.prompt,
          model: params.model,
          resolution: params.resolution,
          aspectRatio: params.aspectRatio,
          billing: params.billing,
          quality: params.quality,
          count: params.count,
        }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setItems(r.items || []);
      setSaveName("");
      showToast("success", `模板「${name}」已保存`);
    } catch (e) {
      showToast("error", (e as Error)?.message || "保存模板失败");
    } finally {
      setSaving(false);
    }
  }

  async function del(t: Template) {
    try {
      const r = await fetch("/api/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      }).then((x) => x.json());
      setItems(r.items || []);
    } catch {
      showToast("error", "删除失败");
    }
  }

  function exportOne(t: Template) {
    const blob = new Blob([JSON.stringify(templateToFile(t), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `TVision模板-${t.name}.json`);
    URL.revokeObjectURL(url);
  }

  async function importFiles(files: File[]) {
    let imported = 0;
    for (const f of files) {
      try {
        let payload: { name: string; notes?: string; count?: number; params: NonNullable<ReturnType<typeof parseEmbeddedMeta>> } | null =
          null;
        if (/\.json$/i.test(f.name)) {
          payload = parseTemplateFile(await f.text());
        } else {
          // TVision 生成的图片：图片即模板（PNG iTXt / JPEG COM 里带完整参数）。
          const meta = extractImageText(new Uint8Array(await f.arrayBuffer()), PNG_META_KEYWORD);
          const p = meta ? parseEmbeddedMeta(meta) : null;
          if (p) payload = { name: f.name.replace(/\.\w+$/, "").slice(0, 40) || "图片模板", params: p };
        }
        if (!payload) continue;
        const r = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: payload.name, notes: payload.notes, count: payload.count, ...payload.params }),
        }).then((x) => x.json());
        if (!r.error) {
          setItems(r.items || []);
          imported++;
        }
      } catch {
        // skip the bad file, keep importing the rest
      }
    }
    showToast(
      imported ? "success" : "error",
      imported ? `已导入 ${imported} 个模板` : "未识别到模板（支持 .json 模板文件或 TVision 生成的图片）",
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(58% 52% at 50% 30%, rgba(230,178,119,0.05), transparent 70%)" }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json,image/png,image/jpeg"
        multiple
        hidden
        onChange={(e) => {
          importFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />

      <div className="absolute inset-0 overflow-y-auto px-8 py-6">
        <div className="mx-auto w-full max-w-[1080px]">
          {/* 页头：标题 + 保存当前 / 导入 */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <Icon name="BookmarksSimple" size={20} className="text-accent" />
                <h1 className="text-lg font-medium text-fg">模板库</h1>
              </div>
              <p className="mt-1.5 text-sm text-fg-mute">
                一键复用整套提示词与参数；也可导入模板文件，或直接导入 TVision 生成的图片（图片自带配方）
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCurrent();
                }}
                placeholder="把单图创作的当前参数存为模板…"
                className="h-9 w-[240px] rounded-control border border-line bg-panel-2/60 px-3 text-xs text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
              />
              <Button variant="primary" onClick={saveCurrent} disabled={!saveName.trim() || saving} className="h-9 px-3 text-xs">
                <Icon name={saving ? "CircleNotch" : "Plus"} size={13} className={saving ? "animate-spin" : undefined} />
                保存
              </Button>
              <Button variant="ghost" onClick={() => importRef.current?.click()} className="h-9 px-3 text-xs">
                <Icon name="UploadSimple" size={13} />
                导入
              </Button>
            </div>
          </div>

          {/* 预设模板 */}
          <div className="mt-7">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-fg-mute">
              预设模板
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px]">内置 · 不可删除</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PRESET_TEMPLATES.map((t, i) => (
                <TemplateCard key={t.id} t={t} index={i} preset media={media[t.name]} onApply={apply} onExport={exportOne} />
              ))}
            </div>
          </div>

          {/* 我的模板 */}
          <div className="mt-8 pb-10">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-fg-mute">
              我的模板
              <span className="text-[10px] text-fg-mute">{items.length}</span>
            </div>
            {loading ? (
              <div className="flex h-28 items-center justify-center text-fg-mute">
                <Icon name="CircleNotch" size={18} className="animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-panel border border-dashed border-line-2 px-6 py-10 text-center text-xs leading-relaxed text-fg-mute">
                还没有自己的模板
                <br />
                在单图创作调好提示词与参数后，回到这里用上方输入框保存；也可导入模板文件或 TVision 生成的图片
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((t, i) => (
                  <TemplateCard key={t.id} t={t} index={i} media={media[t.name]} onApply={apply} onExport={exportOne} onDelete={del} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 参考图 → 效果图 展示条：所有图等高一行排开，参考图和效果图之间画一个
 *  箭头分隔。任一侧为空就只显示有图的一侧（不画箭头）。 */
function MediaStrip({ media, name }: { media: { refs: string[]; results: string[] }; name: string }) {
  const cell = (url: string, label: string, i: number) => (
    <div key={url} className="relative h-full min-w-0 flex-1 overflow-hidden rounded-control border border-line bg-black/20">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`${name} ${label}${i + 1}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] text-fg backdrop-blur-sm">
        {label}
      </span>
    </div>
  );
  return (
    <div className="mb-3 flex h-[132px] items-stretch gap-1.5">
      {media.refs.map((u, i) => cell(u, "参考", i))}
      {media.refs.length && media.results.length ? (
        <span className="flex shrink-0 items-center text-accent/70">
          <Icon name="ArrowRight" size={14} weight="bold" />
        </span>
      ) : null}
      {media.results.map((u, i) => cell(u, "效果", i))}
    </div>
  );
}

function TemplateCard({
  t,
  index,
  preset = false,
  media,
  onApply,
  onExport,
  onDelete,
}: {
  t: Template;
  index: number;
  preset?: boolean;
  media?: { refs: string[]; results: string[] };
  onApply: (t: Template) => void;
  onExport: (t: Template) => void;
  onDelete?: (t: Template) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26, delay: Math.min(index * 0.04, 0.3) }}
      className={cn(
        "group flex flex-col rounded-panel border border-line bg-panel-2/60 p-4 transition-colors",
        "hover:border-line-2 hover:bg-panel-2",
      )}
    >
      {media && (media.refs.length || media.results.length) ? <MediaStrip media={media} name={t.name} /> : null}
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-accent">
          <Icon name={t.icon || "BookmarksSimple"} size={15} weight="bold" />
        </span>
        <span className="truncate text-sm font-medium text-fg">{t.name}</span>
        {preset ? (
          <span className="ml-auto shrink-0 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
            预设
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 text-[11px] text-fg-mute">{paramChip(t)}</div>

      {t.notes ? <div className="mt-1.5 text-xs leading-relaxed text-fg-dim">{t.notes}</div> : null}

      <div className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-fg-mute" title={t.prompt}>
        {t.prompt || <span className="italic">（仅参数，不含提示词）</span>}
      </div>

      <div className="mt-3.5 flex items-center gap-2 border-t border-line pt-3">
        <Button variant="primary" onClick={() => onApply(t)} className="h-8 px-4 text-xs">
          <Icon name="Lightning" size={12} weight="fill" />
          使用
        </Button>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onExport(t)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-fg-mute transition-colors hover:bg-white/10 hover:text-fg"
            title="导出为 .json 文件"
          >
            <Icon name="DownloadSimple" size={13} />
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(t)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-fg-mute transition-colors hover:bg-white/10 hover:text-red-300"
              title="删除模板"
            >
              <Icon name="Trash" size={13} />
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
