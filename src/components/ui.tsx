"use client";

import type { ReactNode } from "react";
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

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full cursor-pointer appearance-none rounded-control border border-line bg-panel-2 pl-3 pr-9 text-sm text-fg transition-colors hover:border-line-2 focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="bg-panel text-fg">
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="CaretDown"
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-mute"
      />
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
  options: { value: T; label: string }[];
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
