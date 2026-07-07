"use client";

import {
  ArrowClockwise,
  ArrowsOutSimple,
  CaretDown,
  Check,
  CircleNotch,
  DownloadSimple,
  FrameCorners,
  Gear,
  ImageSquare,
  Lightning,
  MagicWand,
  Mountains,
  Pants,
  Plus,
  SlidersHorizontal,
  Sparkle,
  Square,
  Stack,
  Trash,
  TShirt,
  UploadSimple,
  Warning,
  X,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

export type IconProps = {
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  className?: string;
  color?: string;
};

const MAP: Record<string, ComponentType<IconProps>> = {
  TShirt,
  Pants,
  Mountains,
  Sparkle,
  Square,
  Gear,
  UploadSimple,
  X,
  ArrowClockwise,
  DownloadSimple,
  Plus,
  ImageSquare,
  Lightning,
  CircleNotch,
  ArrowsOutSimple,
  Trash,
  Check,
  Warning,
  SlidersHorizontal,
  Stack,
  CaretDown,
  MagicWand,
  FrameCorners,
} as unknown as Record<string, ComponentType<IconProps>>;

export function Icon({
  name,
  size = 20,
  weight = "regular",
  className,
  color,
}: { name: string } & IconProps) {
  const Cmp = MAP[name] ?? Square;
  return <Cmp size={size} weight={weight} className={className} color={color} />;
}
