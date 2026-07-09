"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { ACTIONS } from "@/lib/actions";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

const SPAN = 104; // degrees swept by the fan
const R = 152;
const BASE_N = 5; // pill count R/SPAN were originally tuned for (5 ACTIONS, no overlap)
const R_STEP = 40; // extra radius per item beyond BASE_N — equal angle steps compress the
// fan's y-spacing at its edges (sine curve), so more items need more room or the h-11
// pills at the top/bottom of the arc start overlapping. Only kicks in past 5 items.

function pos(i: number, n: number) {
  const radius = n > BASE_N ? R + (n - BASE_N) * R_STEP : R;
  const ang = n > 1 ? ((-SPAN / 2 + i * (SPAN / (n - 1))) * Math.PI) / 180 : 0;
  return { x: Math.cos(ang) * radius, y: Math.sin(ang) * radius };
}

// Local quick tools (left fan). AI actions from lib/actions fan out on the right.
const TOOLS = [
  { id: "crop", label: "裁剪", hint: "裁剪画布图片（默认 1:1）", icon: "Crop" },
  { id: "brush", label: "局部重绘", hint: "涂抹要修改的区域，仅重绘该区域", icon: "PaintBrush" },
];

// Two fans around the clicked image: quick edit tools on the left,
// generation actions on the right.
export function RadialMenu() {
  const choose = useStudio((s) => s.chooseAction);
  const openCrop = useStudio((s) => s.openCrop);
  const openBrushPanel = useStudio((s) => s.openBrushPanel);
  const reduce = useReducedMotion();

  function onTool(id: string) {
    if (id === "crop") openCrop();
    else if (id === "brush") openBrushPanel();
  }

  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: reduce ? 0 : 0.045 } },
    exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
  };
  const makeItem = (x: number, y: number): Variants => ({
    hidden: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, x: -x * 0.5, y: -y * 0.5 },
    visible: { opacity: 1, scale: 1, x: 0, y: 0, transition: { type: "spring", stiffness: 420, damping: 26 } },
    exit: reduce
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.4, x: -x * 0.4, y: -y * 0.4, transition: { duration: 0.14 } },
  });

  const pill = "glass flex h-11 items-center gap-2 rounded-full py-0 hover:border-line-2";
  const ball = "flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-accent";
  const label = "whitespace-nowrap text-sm font-medium text-fg";

  return (
    <>
      <motion.div
        variants={container}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="absolute left-full top-1/2 z-30"
        style={{ marginLeft: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        {ACTIONS.map((a, i) => {
          const p = pos(i, ACTIONS.length);
          return (
            <div key={a.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: p.x, top: p.y }}>
              <motion.button
                variants={makeItem(p.x, p.y)}
                whileHover={reduce ? undefined : { scale: 1.06 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => choose(a.id)}
                title={a.hint}
                className={cn(pill, "pl-2 pr-4")}
              >
                <span className={ball}>
                  <Icon name={a.icon} size={16} weight="bold" />
                </span>
                <span className={label}>{a.label}</span>
              </motion.button>
            </div>
          );
        })}
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="absolute right-full top-1/2 z-30"
        style={{ marginRight: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        {TOOLS.map((t, i) => {
          const p = pos(i, TOOLS.length);
          return (
            <div key={t.id} className="absolute translate-x-1/2 -translate-y-1/2" style={{ right: p.x, top: p.y }}>
              <motion.button
                variants={makeItem(-p.x, p.y)}
                whileHover={reduce ? undefined : { scale: 1.06 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onTool(t.id)}
                title={t.hint}
                className={cn(pill, "flex-row-reverse pl-4 pr-2")}
              >
                <span className={ball}>
                  <Icon name={t.icon} size={16} weight="bold" />
                </span>
                <span className={label}>{t.label}</span>
              </motion.button>
            </div>
          );
        })}
      </motion.div>
    </>
  );
}
