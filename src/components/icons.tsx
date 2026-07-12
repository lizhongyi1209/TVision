"use client";

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowRight,
  ArrowsLeftRight,
  ArrowsOutSimple,
  Belt,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  CircleNotch,
  CoatHanger,
  Copy,
  Crop,
  DownloadSimple,
  Eraser,
  Eye,
  FrameCorners,
  Gear,
  ImageSquare,
  Lightning,
  MagicWand,
  Mountains,
  PaintBrush,
  Pants,
  Plus,
  Pulse,
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
  CoatHanger,
  Belt,
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
  CaretLeft,
  CaretRight,
  CaretUp,
  MagicWand,
  FrameCorners,
  Crop,
  ArrowRight,
  ArrowsLeftRight,
  Pulse,
  Copy,
  Eye,
  PaintBrush,
  Eraser,
  ArrowCounterClockwise,
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
