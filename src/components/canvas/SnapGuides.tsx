import { memo } from "react";
import { useViewport } from "@xyflow/react";
import type { SnapGuide } from "../../hooks/use-snap-guides";

interface SnapGuidesProps {
  guides: SnapGuide[];
}

/**
 * Renders snap guide lines in canvas (flow) coordinates.
 * Uses useViewport() to apply the same pan/zoom transform as nodes,
 * so guides stay aligned with the nodes they reference.
 */
export const SnapGuides = memo(function SnapGuides({ guides }: SnapGuidesProps) {
  const { x, y, zoom } = useViewport();

  if (guides.length === 0) return null;

  return (
    <svg
      className="pointer-events-none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        zIndex: 1000,
      }}
    >
      <g transform={`translate(${x}, ${y}) scale(${zoom})`}>
        {guides.map((guide, i) => {
          if (guide.axis === "x") {
            // Vertical line
            return (
              <line
                key={`${guide.axis}-${guide.value}-${i}`}
                x1={guide.value}
                y1={guide.start}
                x2={guide.value}
                y2={guide.end}
                stroke="rgba(100, 160, 255, 0.5)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              />
            );
          }
          // Horizontal line
          return (
            <line
              key={`${guide.axis}-${guide.value}-${i}`}
              x1={guide.start}
              y1={guide.value}
              x2={guide.end}
              y2={guide.value}
              stroke="rgba(100, 160, 255, 0.5)"
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
          );
        })}
      </g>
    </svg>
  );
});
