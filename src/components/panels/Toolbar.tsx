import { useCallback } from "react";
import supervisorLogo from "@/assets/supervisor-logo.svg";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { useAgentStore } from "@/stores/agent-store";
import { useProjectStore } from "@/stores/project-store";
import { SettingsDialog } from "./SettingsDialog";

interface ToolbarProps {
  onNewAgent: () => void;
  onNewProject: () => void;
}

export function Toolbar({ onNewAgent, onNewProject }: ToolbarProps) {
  const agentCount = useAgentStore((s) => s.agents.length);
  const projectCount = useProjectStore((s) => s.projects.length);
  const filterQuery = useAgentStore((s) => s.canvasFilter.query);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    useAgentStore.getState().setCanvasFilter({ query: e.target.value });
  }, []);

  /*
   * data-tauri-drag-region on outer div: Tauri v2 auto-excludes <button>,
   * <input>, <a>, <select>, <textarea> from drag. The decorum plugin's
   * default overlay is disabled via a data-tauri-decorum-tb element in
   * index.html. This means the outer data-tauri-drag-region works normally
   * like the original toolbar — interactive HTML elements pass through.
   */
  return (
    <div
      data-tauri-drag-region
      className="h-[48px] pl-[80px] pr-4 grid items-center select-none studio-glass"
      style={{
        borderBottom: "1px solid var(--studio-border)",
        gridTemplateColumns: "1fr auto 1fr",
      }}
    >
      {/* Left */}
      <div data-tauri-drag-region className="flex items-center gap-3">
        <img
          data-tauri-drag-region
          src={supervisorLogo}
          alt="Supervisor"
          className="h-4 invert"
          draggable={false}
        />
        <span
          data-tauri-drag-region
          className="text-xs tabular-nums"
          style={{ color: "var(--studio-text-muted)" }}
        >
          {agentCount} agents &middot; {projectCount} projects
        </span>
      </div>

      {/* Center — Search */}
      <div data-tauri-drag-region className="relative flex items-center justify-center">
        <input
          id="studio-filter-input"
          type="text"
          aria-label="Search agents and projects"
          placeholder="Search agents & projects..."
          value={filterQuery}
          onChange={handleFilterChange}
          className="text-xs outline-none"
          style={{
            padding: "5px 12px",
            paddingRight: 32,
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            minWidth: 240,
            color: "var(--studio-text-primary)",
          }}
        />
        <Kbd className="absolute right-[5px] top-1/2 -translate-y-1/2 pointer-events-none">⌘P</Kbd>
      </div>

      {/* Right */}
      <div data-tauri-drag-region className="flex items-center gap-1.5 justify-end">
        <SettingsDialog />
        <Separator orientation="vertical" className="h-4 self-center" />
        <Button size="sm" variant="outline" onClick={onNewProject}>
          Project
          <Kbd className="h-4 text-[10px]">⌘⇧N</Kbd>
        </Button>
        <Button size="sm" variant="outline" onClick={onNewAgent}>
          Agent
          <Kbd className="h-4 text-[10px]">⌘N</Kbd>
        </Button>
      </div>
    </div>
  );
}
