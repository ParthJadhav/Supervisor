import { useCallback, useRef } from "react";
import type { Node } from "@xyflow/react";
import {
  isSupported,
  perform,
  HapticFeedbackPattern,
  PerformanceTime,
} from "tauri-plugin-macos-haptics-api";

// ── Types ──

export interface SnapGuide {
  /** "x" = vertical line, "y" = horizontal line */
  axis: "x" | "y";
  /** Position on the perpendicular axis (px in canvas coords) */
  value: number;
  /** Extent of the line along its own axis */
  start: number;
  end: number;
}

export interface SnapResult {
  /** Adjusted position for the dragging node */
  x: number;
  y: number;
  /** Guide lines to render */
  guides: SnapGuide[];
}

// ── Constants ──

const SNAP_THRESHOLD = 8; // px in canvas coordinates
const SKIP_DISTANCE = 2000; // early-exit if nodes are far apart

// ── Helpers ──

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function nodeRect(node: Node): Rect {
  const w = (node.style?.width as number) ?? node.measured?.width ?? 280;
  const h = (node.style?.height as number) ?? node.measured?.height ?? 140;
  return { x: node.position.x, y: node.position.y, w, h };
}

function getEdgesAndCenters(r: Rect) {
  return {
    left: r.x,
    right: r.x + r.w,
    top: r.y,
    bottom: r.y + r.h,
    cx: r.x + r.w / 2,
    cy: r.y + r.h / 2,
  };
}

/**
 * Filter candidate nodes based on boundary rules:
 * - Free agents snap to free agents + project zones
 * - Bound agents snap to siblings in the same project zone
 * - Project zones snap to project zones + free agents
 */
export function getCandidates(dragging: Node, allNodes: Node[]): Node[] {
  if (dragging.type === "projectZone") {
    return allNodes.filter(
      (n) =>
        n.id !== dragging.id &&
        (n.type === "projectZone" || (n.type === "agent" && !n.parentId)),
    );
  }

  // Agent node
  if (dragging.parentId) {
    // Bound agent — snap to siblings only
    return allNodes.filter(
      (n) =>
        n.id !== dragging.id &&
        n.parentId === dragging.parentId &&
        n.type === "agent",
    );
  }

  // Free agent — snap to other free agents + project zones
  return allNodes.filter(
    (n) =>
      n.id !== dragging.id &&
      ((n.type === "agent" && !n.parentId) || n.type === "projectZone"),
  );
}

// ── Core snap calculation ──

function computeSnap(
  dragRect: Rect,
  candidates: Rect[],
): { dx: number; dy: number; guides: SnapGuide[] } {
  let bestDx: number | null = null;
  let bestDxDist = SNAP_THRESHOLD + 1;
  let bestDy: number | null = null;
  let bestDyDist = SNAP_THRESHOLD + 1;
  const guides: SnapGuide[] = [];

  const drag = getEdgesAndCenters(dragRect);

  // ── Edge & center alignment ──
  for (const cRect of candidates) {
    // Early exit for distant nodes
    if (
      Math.abs(cRect.x - dragRect.x) > SKIP_DISTANCE &&
      Math.abs(cRect.y - dragRect.y) > SKIP_DISTANCE
    ) {
      continue;
    }

    const c = getEdgesAndCenters(cRect);

    // X-axis snaps (vertical guide lines)
    const xPairs: Array<[number, number]> = [
      [drag.left, c.left],
      [drag.left, c.right],
      [drag.right, c.left],
      [drag.right, c.right],
      [drag.cx, c.cx],
    ];
    for (const [dv, cv] of xPairs) {
      const dist = Math.abs(dv - cv);
      if (dist <= SNAP_THRESHOLD && dist < bestDxDist) {
        bestDx = cv - (dv - dragRect.x);
        bestDxDist = dist;
      }
    }

    // Y-axis snaps (horizontal guide lines)
    const yPairs: Array<[number, number]> = [
      [drag.top, c.top],
      [drag.top, c.bottom],
      [drag.bottom, c.top],
      [drag.bottom, c.bottom],
      [drag.cy, c.cy],
    ];
    for (const [dv, cv] of yPairs) {
      const dist = Math.abs(dv - cv);
      if (dist <= SNAP_THRESHOLD && dist < bestDyDist) {
        bestDy = cv - (dv - dragRect.y);
        bestDyDist = dist;
      }
    }
  }

  // ── Equal spacing detection ──
  // Check if dragged node is between two others with equal gaps
  const allRects = [...candidates, dragRect];

  // Horizontal spacing
  const sortedByX = [...allRects].sort((a, b) => a.x - b.x);
  const dragIdxX = sortedByX.indexOf(dragRect);
  if (dragIdxX > 0 && dragIdxX < sortedByX.length - 1) {
    const leftRect = sortedByX[dragIdxX - 1];
    const rightRect = sortedByX[dragIdxX + 1];
    const gapLeft = dragRect.x - (leftRect.x + leftRect.w);
    const gapRight = rightRect.x - (dragRect.x + dragRect.w);
    const avgGap = (gapLeft + gapRight) / 2;
    if (Math.abs(gapLeft - gapRight) <= SNAP_THRESHOLD * 2 && avgGap > 0) {
      const snapX = leftRect.x + leftRect.w + avgGap;
      const dist = Math.abs(snapX - dragRect.x);
      if (dist <= SNAP_THRESHOLD && (bestDx === null || dist < bestDxDist)) {
        bestDx = snapX;
        bestDxDist = dist;
        // Add spacing guide lines
        const minY = Math.min(leftRect.y, dragRect.y, rightRect.y);
        const maxY = Math.max(
          leftRect.y + leftRect.h,
          dragRect.y + dragRect.h,
          rightRect.y + rightRect.h,
        );
        const midY = (minY + maxY) / 2;
        guides.push(
          { axis: "y", value: midY, start: leftRect.x + leftRect.w, end: snapX },
          { axis: "y", value: midY, start: snapX + dragRect.w, end: rightRect.x },
        );
      }
    }
  }

  // Vertical spacing
  const sortedByY = [...allRects].sort((a, b) => a.y - b.y);
  const dragIdxY = sortedByY.indexOf(dragRect);
  if (dragIdxY > 0 && dragIdxY < sortedByY.length - 1) {
    const aboveRect = sortedByY[dragIdxY - 1];
    const belowRect = sortedByY[dragIdxY + 1];
    const gapAbove = dragRect.y - (aboveRect.y + aboveRect.h);
    const gapBelow = belowRect.y - (dragRect.y + dragRect.h);
    const avgGap = (gapAbove + gapBelow) / 2;
    if (Math.abs(gapAbove - gapBelow) <= SNAP_THRESHOLD * 2 && avgGap > 0) {
      const snapY = aboveRect.y + aboveRect.h + avgGap;
      const dist = Math.abs(snapY - dragRect.y);
      if (dist <= SNAP_THRESHOLD && (bestDy === null || dist < bestDyDist)) {
        bestDy = snapY;
        bestDyDist = dist;
        const minX = Math.min(aboveRect.x, dragRect.x, belowRect.x);
        const maxX = Math.max(
          aboveRect.x + aboveRect.w,
          dragRect.x + dragRect.w,
          belowRect.x + belowRect.w,
        );
        const midX = (minX + maxX) / 2;
        guides.push(
          { axis: "x", value: midX, start: aboveRect.y + aboveRect.h, end: snapY },
          { axis: "x", value: midX, start: snapY + dragRect.h, end: belowRect.y },
        );
      }
    }
  }

  // ── Build alignment guide lines ──
  const snappedRect: Rect = {
    x: bestDx ?? dragRect.x,
    y: bestDy ?? dragRect.y,
    w: dragRect.w,
    h: dragRect.h,
  };
  const snapped = getEdgesAndCenters(snappedRect);

  if (bestDx !== null) {
    for (const cRect of candidates) {
      const c = getEdgesAndCenters(cRect);
      // Check which x-value matched
      const xValues = [c.left, c.right, c.cx];
      const snapXValues = [snapped.left, snapped.right, snapped.cx];
      for (const sv of snapXValues) {
        for (const cv of xValues) {
          if (Math.abs(sv - cv) < 1) {
            const minY = Math.min(snappedRect.y, cRect.y);
            const maxY = Math.max(snappedRect.y + snappedRect.h, cRect.y + cRect.h);
            guides.push({ axis: "x", value: sv, start: minY, end: maxY });
          }
        }
      }
    }
  }

  if (bestDy !== null) {
    for (const cRect of candidates) {
      const c = getEdgesAndCenters(cRect);
      const yValues = [c.top, c.bottom, c.cy];
      const snapYValues = [snapped.top, snapped.bottom, snapped.cy];
      for (const sv of snapYValues) {
        for (const yv of yValues) {
          if (Math.abs(sv - yv) < 1) {
            const minX = Math.min(snappedRect.x, cRect.x);
            const maxX = Math.max(snappedRect.x + snappedRect.w, cRect.x + cRect.w);
            guides.push({ axis: "y", value: sv, start: minX, end: maxX });
          }
        }
      }
    }
  }

  return {
    dx: bestDx !== null ? bestDx - dragRect.x : 0,
    dy: bestDy !== null ? bestDy - dragRect.y : 0,
    guides,
  };
}

// ── Offset guides from parent-relative to absolute canvas coords ──
function offsetGuides(guides: SnapGuide[], parentX: number, parentY: number): SnapGuide[] {
  if (parentX === 0 && parentY === 0) return guides;
  return guides.map((g) => {
    if (g.axis === "x") {
      // Vertical line: value is X position, start/end are Y range
      return { ...g, value: g.value + parentX, start: g.start + parentY, end: g.end + parentY };
    }
    // Horizontal line: value is Y position, start/end are X range
    return { ...g, value: g.value + parentY, start: g.start + parentX, end: g.end + parentX };
  });
}

/**
 * Find the absolute position of a node's parent (if it has one).
 * Returns { x: 0, y: 0 } for root-level nodes.
 */
export function getParentOffset(node: Node, allNodes: Node[]): { x: number; y: number } {
  if (!node.parentId) return { x: 0, y: 0 };
  const parent = allNodes.find((n) => n.id === node.parentId);
  if (!parent) return { x: 0, y: 0 };
  return { x: parent.position.x, y: parent.position.y };
}

// ── Deduplicate guides ──
function dedupeGuides(guides: SnapGuide[]): SnapGuide[] {
  const seen = new Set<string>();
  return guides.filter((g) => {
    const key = `${g.axis}:${Math.round(g.value)}:${Math.round(g.start)}:${Math.round(g.end)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Haptic feedback ──

let hapticSupported: boolean | null = null;

export function triggerHaptic() {
  if (hapticSupported === false) return;
  if (hapticSupported === null) {
    isSupported()
      .then((supported) => {
        hapticSupported = supported;
        if (supported) {
          perform(HapticFeedbackPattern.Alignment, PerformanceTime.Now).catch(() => {});
        }
      })
      .catch(() => {
        hapticSupported = false;
      });
    return;
  }
  perform(HapticFeedbackPattern.Alignment, PerformanceTime.Now).catch(() => {});
}

// ── Resize snap calculation ──
// During resize, only the edges being dragged should snap.
// `direction` is [dx, dy] from React Flow: e.g. [-1, -1] = top-left handle.

export function computeResizeSnap(
  resizeRect: Rect,
  candidates: Rect[],
  direction: number[],
  /** The rect before the current resize started — used to skip already-aligned edges */
  originalRect?: Rect,
): { rect: Rect; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  let { x, y, w, h } = resizeRect;

  const movingLeft = direction[0] === -1;
  const movingRight = direction[0] === 1;
  const movingTop = direction[1] === -1;
  const movingBottom = direction[1] === 1;

  // Pre-compute original edges so we can skip targets that were already aligned
  const origRight = originalRect ? originalRect.x + originalRect.w : undefined;
  const origLeft = originalRect?.x;
  const origBottom = originalRect ? originalRect.y + originalRect.h : undefined;
  const origTop = originalRect?.y;

  // Helper: skip snap target if the edge was already at this position before resize
  const wasAligned = (edgeValue: number | undefined, target: number) =>
    edgeValue !== undefined && Math.abs(edgeValue - target) < 1;

  for (const cRect of candidates) {
    if (
      Math.abs(cRect.x - resizeRect.x) > SKIP_DISTANCE &&
      Math.abs(cRect.y - resizeRect.y) > SKIP_DISTANCE
    ) {
      continue;
    }

    const c = getEdgesAndCenters(cRect);

    if (movingRight) {
      const rightEdge = x + w;
      for (const target of [c.left, c.right, c.cx]) {
        if (wasAligned(origRight, target)) continue;
        const dist = Math.abs(rightEdge - target);
        if (dist <= SNAP_THRESHOLD) {
          w = target - x;
          const minY = Math.min(y, cRect.y);
          const maxY = Math.max(y + h, cRect.y + cRect.h);
          guides.push({ axis: "x", value: target, start: minY, end: maxY });
        }
      }
    }

    if (movingLeft) {
      const leftEdge = x;
      for (const target of [c.left, c.right, c.cx]) {
        if (wasAligned(origLeft, target)) continue;
        const dist = Math.abs(leftEdge - target);
        if (dist <= SNAP_THRESHOLD) {
          const delta = leftEdge - target;
          x = target;
          w += delta;
          const minY = Math.min(y, cRect.y);
          const maxY = Math.max(y + h, cRect.y + cRect.h);
          guides.push({ axis: "x", value: target, start: minY, end: maxY });
        }
      }
    }

    if (movingBottom) {
      const bottomEdge = y + h;
      for (const target of [c.top, c.bottom, c.cy]) {
        if (wasAligned(origBottom, target)) continue;
        const dist = Math.abs(bottomEdge - target);
        if (dist <= SNAP_THRESHOLD) {
          h = target - y;
          const minX = Math.min(x, cRect.x);
          const maxX = Math.max(x + w, cRect.x + cRect.w);
          guides.push({ axis: "y", value: target, start: minX, end: maxX });
        }
      }
    }

    if (movingTop) {
      const topEdge = y;
      for (const target of [c.top, c.bottom, c.cy]) {
        if (wasAligned(origTop, target)) continue;
        const dist = Math.abs(topEdge - target);
        if (dist <= SNAP_THRESHOLD) {
          const delta = topEdge - target;
          y = target;
          h += delta;
          const minX = Math.min(x, cRect.x);
          const maxX = Math.max(x + w, cRect.x + cRect.w);
          guides.push({ axis: "y", value: target, start: minX, end: maxX });
        }
      }
    }

    // Snap to same width/height as candidate
    if (movingRight || movingLeft) {
      const widthDist = Math.abs(w - cRect.w);
      if (widthDist <= SNAP_THRESHOLD) {
        if (movingRight) {
          if (!wasAligned(origRight, x + cRect.w)) w = cRect.w;
        } else if (movingLeft) {
          const newLeft = (x + w) - cRect.w;
          if (!wasAligned(origLeft, newLeft)) {
            const oldRight = x + w;
            w = cRect.w;
            x = oldRight - w;
          }
        }
      }
    }

    if (movingBottom || movingTop) {
      const heightDist = Math.abs(h - cRect.h);
      if (heightDist <= SNAP_THRESHOLD) {
        if (movingBottom) {
          if (!wasAligned(origBottom, y + cRect.h)) h = cRect.h;
        } else if (movingTop) {
          const newTop = (y + h) - cRect.h;
          if (!wasAligned(origTop, newTop)) {
            const oldBottom = y + h;
            h = cRect.h;
            y = oldBottom - h;
          }
        }
      }
    }
  }

  return { rect: { x, y, w, h }, guides: dedupeGuides(guides) };
}

// ── Module-level resize guide channel ──
// Node components call emitResizeGuides during resize;
// Canvas reads them via setResizeGuidesListener.

let _resizeGuidesListener: ((guides: SnapGuide[]) => void) | null = null;

export function setResizeGuidesListener(fn: ((guides: SnapGuide[]) => void) | null) {
  _resizeGuidesListener = fn;
}

export function emitResizeGuides(guides: SnapGuide[]) {
  _resizeGuidesListener?.(guides);
}

// ── Hook ──

export function useSnapGuides() {
  const guidesRef = useRef<SnapGuide[]>([]);
  /** Track whether we were snapped on each axis to fire haptics on transitions */
  const wasSnappedX = useRef(false);
  const wasSnappedY = useRef(false);

  const calculateSnap = useCallback(
    (draggingNode: Node, allNodes: Node[]): SnapResult => {
      const dragRect = nodeRect(draggingNode);
      const candidates = getCandidates(draggingNode, allNodes);
      const candidateRects = candidates.map(nodeRect);

      const { dx, dy, guides } = computeSnap(dragRect, candidateRects);

      // Offset guides to absolute canvas coordinates if node is inside a parent
      const parentOff = getParentOffset(draggingNode, allNodes);
      const absoluteGuides = offsetGuides(guides, parentOff.x, parentOff.y);
      const dedupedGuides = dedupeGuides(absoluteGuides);
      guidesRef.current = dedupedGuides;

      // Fire haptic on snap engage (transition from unsnapped to snapped)
      const snappedX = dx !== 0;
      const snappedY = dy !== 0;
      if ((snappedX && !wasSnappedX.current) || (snappedY && !wasSnappedY.current)) {
        triggerHaptic();
      }
      wasSnappedX.current = snappedX;
      wasSnappedY.current = snappedY;

      return {
        x: dragRect.x + dx,
        y: dragRect.y + dy,
        guides: dedupedGuides,
      };
    },
    [],
  );

  const clearGuides = useCallback(() => {
    guidesRef.current = [];
    wasSnappedX.current = false;
    wasSnappedY.current = false;
  }, []);

  return { calculateSnap, clearGuides, guidesRef };
}
