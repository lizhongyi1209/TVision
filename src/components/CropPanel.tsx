"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { useStudio } from "@/lib/store";
import { cropImageToDataURL } from "@/lib/utils";
import { Icon } from "./icons";
import { Button, Segmented } from "./ui";

const RATIOS: { value: string; label: string; aspect?: number }[] = [
  { value: "free", label: "自由" },
  { value: "1:1", label: "1:1", aspect: 1 },
  { value: "3:4", label: "3:4", aspect: 3 / 4 },
  { value: "4:3", label: "4:3", aspect: 4 / 3 },
  { value: "2:3", label: "2:3", aspect: 2 / 3 },
  { value: "3:2", label: "3:2", aspect: 3 / 2 },
  { value: "9:16", label: "9:16", aspect: 9 / 16 },
  { value: "16:9", label: "16:9", aspect: 16 / 9 },
];

function centeredCrop(aspect: number, w: number, h: number): PercentCrop {
  return centerCrop(makeAspectCrop({ unit: "%", width: 90 }, aspect, w, h), w, h);
}

export function CropPanel() {
  const image = useStudio((s) => s.image);
  const close = useStudio((s) => s.closeCrop);
  const replaceImage = useStudio((s) => s.replaceImage);
  const showToast = useStudio((s) => s.showToast);

  const imgRef = useRef<HTMLImageElement>(null);
  const [ratio, setRatio] = useState("1:1");
  const [crop, setCrop] = useState<Crop>();
  const [applying, setApplying] = useState(false);

  const aspect = RATIOS.find((r) => r.value === ratio)?.aspect;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const onImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    setCrop(centeredCrop(1, width, height)); // 默认 1:1 居中选区
  }, []);

  function pickRatio(v: string) {
    setRatio(v);
    const el = imgRef.current;
    const a = RATIOS.find((r) => r.value === v)?.aspect;
    if (el && a) setCrop(centeredCrop(a, el.width, el.height));
    // 自由模式保留当前选区，仅解除比例锁定
  }

  async function apply() {
    const el = imgRef.current;
    if (!el || !image || !crop || applying) return;
    setApplying(true);
    try {
      // percent crop -> natural pixels（展示尺寸与原图无关，按百分比换算最稳）
      const pc =
        crop.unit === "%"
          ? crop
          : {
              x: (crop.x / el.width) * 100,
              y: (crop.y / el.height) * 100,
              width: (crop.width / el.width) * 100,
              height: (crop.height / el.height) * 100,
            };
      const nw = el.naturalWidth;
      const nh = el.naturalHeight;
      const res = await cropImageToDataURL(image.src, {
        x: (pc.x / 100) * nw,
        y: (pc.y / 100) * nh,
        width: (pc.width / 100) * nw,
        height: (pc.height / 100) * nh,
      });
      replaceImage({ src: res.dataUrl, width: res.width, height: res.height });
      showToast("success", `裁剪完成 · ${res.width}×${res.height}`);
    } catch {
      showToast("error", "裁剪失败");
    } finally {
      setApplying(false);
    }
  }

  if (!image) return null;

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
        className="glass fixed left-1/2 top-1/2 z-[97] flex max-h-[92dvh] w-fit min-w-[min(700px,94vw)] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="Crop" size={18} className="text-accent" />
            <span className="font-medium text-fg">裁剪图片</span>
          </div>
          <button onClick={close} className="text-fg-mute hover:text-fg" aria-label="关闭">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-4">
          <ReactCrop
            crop={crop}
            onChange={(_, pc) => setCrop(pc)}
            aspect={aspect}
            keepSelection
            ruleOfThirds
            minWidth={32}
            minHeight={32}
            className="max-h-[46dvh]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={image.src}
              alt="裁剪预览"
              draggable={false}
              onLoad={onImgLoad}
              className="w-auto max-w-full select-none"
            />
          </ReactCrop>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <Segmented value={ratio} onChange={pickRatio} options={RATIOS.map((r) => ({ value: r.value, label: r.label }))} />
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={close}>取消</Button>
            <Button variant="primary" onClick={apply} disabled={!crop || applying} className="px-5">
              {applying ? <Icon name="CircleNotch" size={15} className="animate-spin" /> : <Icon name="Check" size={15} weight="bold" />}
              应用裁剪
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
