import { memo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen, Code, Globe, Database, Terminal,
  Box, Cpu, Zap, Rocket, Palette,
  Shield, Book, Music, Camera, Heart,
  Plus, Trash2, Settings, ChevronDown, ChevronRight,
} from "lucide-react";
import { NodeResizer, useReactFlow, useStore, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateAgentDialog } from "@/components/panels/CreateAgentDialog";
import { useProjectStore } from "@/stores/project-store";
import { cn } from "@/lib/utils";
import { rgba, solidBg } from "@/lib/project-colors";
import { PROJECT_COLORS, PROJECT_ICONS } from "@/types";
import type { Project } from "@/types";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  folder: FolderOpen, code: Code, globe: Globe, database: Database,
  terminal: Terminal, box: Box, cpu: Cpu, zap: Zap, rocket: Rocket,
  palette: Palette, shield: Shield, book: Book, music: Music,
  camera: Camera, heart: Heart,
};

type ProjectZoneData = {
  project: Project;
  agentCount: number;
};

const TOOLBAR_HEIGHT = 72;
const COLLAPSED_HEIGHT = TOOLBAR_HEIGHT;

type ProjectZoneNode = FlowNode<ProjectZoneData>;

export const ProjectZone = memo(({ id, data }: NodeProps<ProjectZoneNode>) => {
  const { project, agentCount } = data;
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const { setNodes } = useReactFlow();
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Derive collapsed state from React Flow node store (survives re-mounts).
  // Uses useStore to reactively subscribe to node changes.
  const isCollapsed = useStore(
    useCallback(
      (s: { nodeLookup: Map<string, any> }) => {
        const self = s.nodeLookup.get(id);
        if (self?.internals?.userNode?.style?.height === COLLAPSED_HEIGHT) return true;
        // Check if any child is hidden
        for (const [, node] of s.nodeLookup) {
          if (node.parentId === id && node.hidden) return true;
        }
        return false;
      },
      [id],
    ),
  );

  // Read color reactively from store so it updates when changed in settings
  const colorName = useProjectStore(
    (s) => s.projects.find((p) => p.id === project.id)?.color || project.color || "gray",
  );

  const handleDelete = useCallback(() => {
    deleteProject(project.id);
  }, [deleteProject, project.id]);

  const toggleCollapse = useCallback(() => {
    const next = !isCollapsed;
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id === id) {
          if (next) {
            // Collapsing: save current height before collapsing
            const currentHeight = (node.style?.height as number) || (node.measured?.height as number) || 280;
            return { ...node, data: { ...node.data, savedExpandedHeight: currentHeight }, style: { ...node.style, height: COLLAPSED_HEIGHT } };
          }
          // Expanding: restore saved height
          const savedHeight = (node.data as any).savedExpandedHeight ?? 280;
          return { ...node, style: { ...node.style, height: savedHeight } };
        }
        if (node.parentId === id) {
          return { ...node, hidden: next };
        }
        return node;
      })
    );
  }, [id, isCollapsed, setNodes]);

  // Track settings button position for portal placement
  const settingsBtnRef = useRef<HTMLElement>(null);
  const settingsBtnCallbackRef = useCallback((el: HTMLElement | null) => {
    (settingsBtnRef as React.MutableRefObject<HTMLElement | null>).current = el;
  }, []);
  const [settingsPos, setSettingsPos] = useState<{ top: number; left: number } | null>(null);

  // Calculate position in the click handler instead of an effect
  const handleToggleSettings = useCallback(() => {
    const next = !showSettings;
    if (next && settingsBtnRef.current) {
      const rect = settingsBtnRef.current.getBoundingClientRect();
      setSettingsPos({ top: rect.bottom + 4, left: rect.right - 280 });
    } else if (!next) {
      setSettingsPos(null);
    }
    setShowSettings(next);
  }, [showSettings]);

  // Handle outside click or canvas pan/scroll to close settings
  useEffect(() => {
    if (!showSettings) return;

    const closeSettings = () => {
      setShowSettings(false);
      setSettingsPos(null);
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-settings-panel]")) {
        closeSettings();
      }
    };

    // Close on scroll/wheel (canvas pan via panOnScroll) or
    // pointermove with button held (canvas drag-pan)
    const handleWheel = () => closeSettings();
    const handlePointerMove = (e: PointerEvent) => {
      // Only close when actively dragging (button pressed)
      if (e.buttons > 0) closeSettings();
    };

    // Use capture phase so the listener fires before d3-drag's
    // stopImmediatePropagation() can block it during bubbling.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown, true);
      document.addEventListener("wheel", handleWheel, true);
      document.addEventListener("pointermove", handlePointerMove, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("wheel", handleWheel, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
    };
  }, [showSettings]);

  return (
    <>
      {/* Invisible NodeResizer — no visible lines or handles, just cursor zones */}
      {/* Hidden when collapsed to prevent resize from breaking collapsed state */}
      {!isCollapsed && (
        <NodeResizer
          isVisible
          minWidth={400}
          minHeight={200}
          lineStyle={{ borderColor: "transparent", borderWidth: 20 }}
          handleStyle={{
            backgroundColor: "transparent",
            border: "none",
            width: 24,
            height: 24,
            borderRadius: 0,
          }}
        />
      )}
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          border: `1px solid ${rgba(colorName, 0.3)}`,
          background: solidBg(colorName, 0.1),
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Toolbar — fixed height zone that agents cannot overlap */}
        <div style={{
          height: TOOLBAR_HEIGHT, minHeight: TOOLBAR_HEIGHT, flexShrink: 0,
          padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <button
              type="button"
              onClick={toggleCollapse}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: 0, display: "flex", alignItems: "center",
                color: rgba(colorName, 0.7), flexShrink: 0,
              }}
            >
              {isCollapsed ? <ChevronRight style={{ width: 24, height: 24 }} /> : <ChevronDown style={{ width: 24, height: 24 }} />}
            </button>
            {(() => {
              const IconComp = iconMap[project.icon || "folder"];
              return (
                <div style={{ flexShrink: 0, color: rgba(colorName, 0.8), display: "flex", alignItems: "center" }}>
                  <IconComp className="w-[22px] h-[22px]" />
                </div>
              );
            })()}
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 20, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "1.2px", color: rgba(colorName, 1.0), lineHeight: 1.2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {project.name}
              </div>
              <div style={{
                fontSize: 13, color: rgba(colorName, 0.55), lineHeight: 1.2, marginTop: 2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {project.path}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <Button
              size="icon-sm"
              variant="ghost"
              style={{ opacity: 0.7, width: 36, height: 36 }}
              onClick={() => setShowCreate(true)}
              aria-label="Add agent to project"
            >
              <Plus style={{ width: 20, height: 20 }} />
            </Button>
            <Button
              ref={settingsBtnCallbackRef}
              size="icon-sm"
              variant="ghost"
              style={{ opacity: 0.7, width: 36, height: 36 }}
              onClick={handleToggleSettings}
              aria-label="Project settings"
            >
              <Settings style={{ width: 20, height: 20 }} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              style={{ opacity: 0.7, width: 36, height: 36 }}
              onClick={() => setShowDeleteDialog(true)}
              aria-label="Delete project"
            >
              <Trash2 style={{ width: 20, height: 20 }} />
            </Button>
          </div>
        </div>

        {/* Content area */}
        {!isCollapsed && <div style={{ flex: 1, padding: 8, position: "relative" }}>
          {agentCount === 0 && !showSettings && (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="project-zone-add-btn"
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  fontSize: 22, fontWeight: 500, color: rgba(colorName, 0.6),
                  background: rgba(colorName, 0.08),
                  border: `1px dashed ${rgba(colorName, 0.25)}`,
                  borderRadius: 14, cursor: "pointer",
                  padding: "32px 52px",
                  transition: "all 150ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = rgba(colorName, 0.14);
                  e.currentTarget.style.borderColor = rgba(colorName, 0.4);
                  e.currentTarget.style.color = rgba(colorName, 0.85);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = rgba(colorName, 0.08);
                  e.currentTarget.style.borderColor = rgba(colorName, 0.25);
                  e.currentTarget.style.color = rgba(colorName, 0.6);
                }}
              >
                <Plus style={{ width: 44, height: 44 }} />
                <span>Add agent</span>
              </button>
            </div>
          )}
        </div>}
      </div>

      <CreateAgentDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        defaultProjectId={project.id}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project "{project.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the project from Supervisor. Agents assigned to this project will become unassigned. Your files on disk will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Settings panel rendered via portal so it appears above all React Flow nodes */}
      {showSettings && settingsPos && createPortal(
        <div
          data-settings-panel
          style={{
            position: "fixed",
            top: settingsPos.top,
            left: settingsPos.left,
            zIndex: 9999,
            width: 280,
          }}
        >
          <ProjectSettingsPanel
            project={project}
            onUpdate={(updates) => updateProject(project.id, updates)}
          />
        </div>,
        document.body,
      )}
    </>
  );
});

ProjectZone.displayName = "ProjectZone";

// ── Settings panel extracted ──
function ProjectSettingsPanel({ project, onUpdate }: {
  project: Project;
  onUpdate: (updates: { name?: string; color?: string; icon?: string }) => void;
}) {
  return (
    <div
      data-settings-panel
      style={{ padding: 10, borderRadius: 8, background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div>
        <div style={{ fontSize: 10, fontWeight: 500, color: "var(--studio-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
          Color
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PROJECT_COLORS.map((pc) => (
            <button
              key={pc.value}
              type="button"
              onClick={() => onUpdate({ color: pc.value })}
              className={cn(
                "size-5 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                pc.class,
                (project.color || "gray") === pc.value
                  ? "ring-2 ring-offset-1 ring-offset-background ring-white/50 scale-110"
                  : "opacity-60 hover:opacity-100",
              )}
              title={pc.name}
              aria-label={pc.name}
            />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 500, color: "var(--studio-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
          Icon
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {PROJECT_ICONS.map((iconKey) => {
            const Ic = iconMap[iconKey];
            return (
              <button
                key={iconKey}
                type="button"
                onClick={() => onUpdate({ icon: iconKey })}
                className={cn(
                  "size-6 rounded flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  (project.icon || "folder") === iconKey
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                title={iconKey}
                aria-label={`Select ${iconKey} icon`}
              >
                <Ic className="size-3" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
