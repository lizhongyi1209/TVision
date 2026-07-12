"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconProps } from "./icons";

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "subtle";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const variants: Record<string, string> = {
    primary: "bg-accent text-ink hover:bg-accent-2 shadow-[0_10px_34px_-8px_rgba(230,178,119,0.55)]",
    ghost: "border border-line text-fg hover:bg-white/5 hover:border-line-2",
    subtle: "text-fg-dim hover:text-fg hover:bg-white/5",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-10 select-none items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-all duration-200",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  name,
  onClick,
  label,
  active,
  className,
  size = 20,
  weight = "regular",
}: {
  name: string;
  onClick?: () => void;
  label: string;
  active?: boolean;
  className?: string;
  size?: number;
  weight?: IconProps["weight"];
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 active:scale-95",
        active ? "bg-white/10 text-fg" : "text-fg-dim hover:bg-white/5 hover:text-fg",
        className,
      )}
    >
      <Icon name={name} size={size} weight={weight} />
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-fg-mute">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-fg-mute">{hint}</span> : null}
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary line under the label in the menu (e.g. model blurb). */
  hint?: string;
  /** Leading glyph, shown in both the trigger and the menu row. */
  icon?: ReactNode;
  disabled?: boolean;
}

/** Custom listbox replacing the native <select>: same API, but the menu is a
 *  glass panel with icons/hints/check marks instead of the OS dropdown. Both
 *  bars that use it sit at the bottom of the viewport, so the menu measures
 *  free space on open and flips upward when the room below runs out. */
export function Select({
  value,
  onChange,
  options,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = options[selectedIdx];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Keep the active row visible while keyboard-navigating a scrolled menu.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openMenu() {
    if (disabled || !options.length) return;
    const r = rootRef.current?.getBoundingClientRect();
    const est = Math.min(options.length * 40 + 12, 320); // rough menu height for the flip decision
    setOpenUp(!!r && r.bottom + est + 8 > window.innerHeight && r.top > window.innerHeight - r.bottom);
    setActive(selectedIdx >= 0 ? selectedIdx : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }

  function move(dir: 1 | -1) {
    let i = active;
    for (let step = 0; step < options.length; step++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) return setActive(i);
    }
  }

  function commit(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") return setOpen(false);
    if (e.key === "ArrowDown") return e.preventDefault(), move(1);
    if (e.key === "ArrowUp") return e.preventDefault(), move(-1);
    if (e.key === "Home") return e.preventDefault(), setActive(options.findIndex((o) => !o.disabled));
    if (e.key === "End") return e.preventDefault(), setActive(options.findLastIndex((o) => !o.disabled));
    if (e.key === "Enter" || e.key === " ") return e.preventDefault(), commit(active);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        className={cn(
          "flex h-10 w-full cursor-pointer items-center gap-2 rounded-control border bg-panel-2 pl-3 pr-8 text-left text-sm text-fg transition-colors focus:outline-none",
          open ? "border-accent" : "border-line hover:border-line-2 focus-visible:border-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {selected?.icon ? <span className="flex shrink-0 items-center">{selected.icon}</span> : null}
        <span className="truncate">{selected?.label ?? value}</span>
      </button>
      <Icon
        name="CaretDown"
        size={14}
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-mute transition-transform duration-200",
          open && "rotate-180 text-fg-dim",
        )}
      />

      <AnimatePresence>
        {open ? (
          <motion.ul
            ref={listRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
            initial={{ opacity: 0, scale: 0.96, y: openUp ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: openUp ? 4 : -4 }}
            transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              "absolute left-0 z-50 max-h-[320px] w-max min-w-full max-w-[300px] overflow-y-auto overscroll-contain rounded-[14px] border border-line-2 bg-[#17171b]/[0.97] p-1.5 backdrop-blur-2xl",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_50px_-12px_rgba(0,0,0,0.75)]",
              openUp ? "bottom-[calc(100%+6px)] origin-bottom" : "top-[calc(100%+6px)] origin-top",
            )}
          >
            {options.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${id}-opt-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => commit(i)}
                  className={cn(
                    "flex select-none items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-sm transition-colors duration-100",
                    o.disabled
                      ? "cursor-not-allowed opacity-35"
                      : cn("cursor-pointer", active === i ? "bg-white/[0.07] text-fg" : "text-fg-dim"),
                  )}
                >
                  {o.icon ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.05] text-fg">
                      {o.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate leading-tight", isSelected && "font-medium text-fg")}>
                      {o.label}
                    </span>
                    {o.hint ? (
                      <span className="mt-0.5 block truncate text-[11px] leading-tight text-fg-mute">{o.hint}</span>
                    ) : null}
                  </span>
                  {isSelected ? <Icon name="Check" size={14} weight="bold" className="shrink-0 text-accent" /> : null}
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex gap-1 rounded-full border border-line bg-panel-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 min-w-8 rounded-full px-3 text-sm transition-all duration-200",
            value === o.value ? "bg-accent font-medium text-ink" : "text-fg-dim hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
