import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useStable } from "@/hooks/use-stable";
import type { SlashCommand } from "@/types";

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  showAgentHint?: boolean;
}

export function SlashCommandMenu({ commands, query, onSelect, onClose, showAgentHint }: SlashCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => (commands || []).filter((cmd) =>
      cmd && cmd.name && cmd.name.toLowerCase().includes(query.toLowerCase()),
    ),
    [commands, query],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const latest = useStable({ filtered, selectedIndex, onSelect, onClose });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!document.activeElement?.closest('[data-chat-composer]')) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, latest.filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && latest.filtered.length > 0) {
        e.preventDefault();
        latest.onSelect(latest.filtered[latest.selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        latest.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [latest]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const item = menu.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      role="listbox"
      className="slash-menu"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          role="option"
          aria-selected={i === selectedIndex}
          onClick={() => onSelect(cmd)}
          className={cn(
            "slash-menu-item",
            i === selectedIndex && "slash-menu-item-selected",
          )}
        >
          <span className="slash-menu-cmd">/{cmd.name}</span>
          <span className="slash-menu-desc">{cmd.description}</span>
        </button>
      ))}
      {showAgentHint && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-t border-border">
          Start the agent to see more commands
        </div>
      )}
    </div>
  );
}
