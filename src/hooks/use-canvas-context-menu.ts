import { useCallback, useEffect, useRef, useState } from "react";

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
}

/**
 * Manages canvas-level context menu state: open/close, position, and
 * outside-click / Escape dismissal.
 */
export function useCanvasContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0 });
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Only show on the pane itself, not on nodes
    const target = e.target as HTMLElement;
    if (target.closest(".react-flow__node")) return;
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setContextMenu({ open: true, x, y });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, open: false }));
  }, []);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu.open) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as globalThis.Node)) {
        closeContextMenu();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu.open, closeContextMenu]);

  return { contextMenu, ctxMenuRef, handleContextMenu, closeContextMenu };
}
