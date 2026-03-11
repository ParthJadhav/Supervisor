import { memo, useCallback } from "react";
import { Panel, useReactFlow } from "@xyflow/react";
import { Plus, Minus, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

export const CanvasControls = memo(function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleZoomIn = useCallback(() => zoomIn({ duration: 200 }), [zoomIn]);
  const handleZoomOut = useCallback(
    () => zoomOut({ duration: 200 }),
    [zoomOut],
  );
  const handleFitView = useCallback(
    () => fitView({ padding: 0.2, duration: 300 }),
    [fitView],
  );

  return (
    <Panel position="bottom-right">
      <TooltipProvider delay={400}>
        <div className="flex flex-col items-center gap-0.5 rounded-xl border border-border/50 bg-card/70 p-1 shadow-lg backdrop-blur-xl">
          <ControlButton
            icon={<Plus className="size-3.5" />}
            label="Zoom in"
            onClick={handleZoomIn}
          />
          <ControlButton
            icon={<Minus className="size-3.5" />}
            label="Zoom out"
            onClick={handleZoomOut}
          />

          <Separator className="my-0.5 w-5" />

          <ControlButton
            icon={<Maximize className="size-3.5" />}
            label="Fit view"
            onClick={handleFitView}
          />
        </div>
      </TooltipProvider>
    </Panel>
  );
});

function ControlButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClick}
            className="text-muted-foreground"
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
