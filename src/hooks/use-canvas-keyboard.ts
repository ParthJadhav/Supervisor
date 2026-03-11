import { useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";

/**
 * Handles space-to-pan (Figma-style) and Cmd+/Cmd- zoom shortcuts.
 * Returns `spaceHeld` state for cursor styling.
 */
export function useCanvasKeyboard() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  // Space-to-pan: track whether space is held for Figma-style pan mode
  const [spaceHeld, setSpaceHeld] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLElement && e.target.isContentEditable)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // CMD+/CMD- to zoom canvas only, CMD+0 to fit view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        fitView({ duration: 200 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, fitView]);

  return { spaceHeld };
}
