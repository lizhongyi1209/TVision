"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { ACTIONS } from "@/lib/actions";
import { useStudio } from "@/lib/store";
import { Icon } from "./icons";

const SPAN = 104; // degrees swept by the fan

function pos(i: number, n: number) {
  const step = n > 1 ? SPAN / (n - 1) : 0;
  const ang = ((-SPAN / 2 + i * step) * Math.PI) / 180;
  const R = 152;
  return { x: Math.cos(ang) * R, y: Math.sin(ang) * R };
}

// The quick-action fan that springs out to the right of the clicked image.
export function RadialMenu() {
  const choose = useStudio((s) => s.chooseAction);
  const reduce = useReducedMotion();
  const n = ACTIONS.length;

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

  return (
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
        const p = pos(i, n);
        return (
          <div key={a.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: p.x, top: p.y }}>
            <motion.button
              variants={makeItem(p.x, p.y)}
              whileHover={reduce ? undefined : { scale: 1.06 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => choose(a.id)}
              title={a.hint}
              className="glass flex h-11 items-center gap-2 rounded-full py-0 pl-2 pr-4 hover:border-line-2"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-accent">
                <Icon name={a.icon} size={16} weight="bold" />
              </span>
              <span className="whitespace-nowrap text-sm font-medium text-fg">{a.label}</span>
            </motion.button>
          </div>
        );
      })}
    </motion.div>
  );
}
