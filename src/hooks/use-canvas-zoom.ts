import { useCallback, useRef } from "react";
import { useStore } from "@xyflow/react";

export type ZoomDensity = "full" | "compact" | "minimal";

// Breakpoints with hysteresis to prevent flicker at boundaries
const THRESHOLDS = {
  fullToCompact: 0.65,
  compactToFull: 0.67,
  compactToMinimal: 0.45,
  minimalToCompact: 0.47,
};

export function useCanvasZoom(): ZoomDensity {
  const lastDensity = useRef<ZoomDensity>("full");

  return useStore(
    useCallback((s: { transform: [number, number, number] }) => {
      const zoom = s.transform[2];
      const prev = lastDensity.current;
      let next: ZoomDensity;

      if (prev === "full") {
        next = zoom <= THRESHOLDS.fullToCompact ? "compact" : "full";
      } else if (prev === "compact") {
        if (zoom >= THRESHOLDS.compactToFull) next = "full";
        else if (zoom <= THRESHOLDS.compactToMinimal) next = "minimal";
        else next = "compact";
      } else {
        // prev === "minimal"
        next = zoom >= THRESHOLDS.minimalToCompact ? "compact" : "minimal";
      }

      lastDensity.current = next;
      return next;
    }, []),
  );
}
