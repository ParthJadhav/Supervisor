import {
  Folder, Code, Globe, Database, Terminal,
  Box, Cpu, Zap, Rocket, Palette,
  Shield, Book, Music, Camera, Heart,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ProjectIcon } from "@/types";

const ICON_MAP: Record<ProjectIcon, LucideIcon> = {
  folder: Folder,
  code: Code,
  globe: Globe,
  database: Database,
  terminal: Terminal,
  box: Box,
  cpu: Cpu,
  zap: Zap,
  rocket: Rocket,
  palette: Palette,
  shield: Shield,
  book: Book,
  music: Music,
  camera: Camera,
  heart: Heart,
};

function isProjectIcon(value: string): value is ProjectIcon {
  return value in ICON_MAP;
}

export function getProjectIcon(icon: string | null): LucideIcon {
  return (icon && isProjectIcon(icon) ? ICON_MAP[icon] : null) || Folder;
}

export const UngroupedIcon = Layers;

const COLOR_MAP: Record<string, string> = {
  gray: "text-zinc-500",
  red: "text-red-500",
  orange: "text-orange-500",
  amber: "text-amber-500",
  green: "text-emerald-500",
  teal: "text-teal-500",
  blue: "text-blue-500",
  indigo: "text-indigo-500",
  purple: "text-purple-500",
  pink: "text-pink-500",
};

export function getProjectColorClass(color: string | null): string {
  return (color && COLOR_MAP[color]) || "text-muted-foreground";
}
