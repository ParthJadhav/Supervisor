import { useEffect, useCallback, useState, useRef } from "react";
import { Canvas } from "@/components/canvas/Canvas";
import { FocusView } from "@/components/focus/FocusView";
import { CreateAgentDialog } from "@/components/panels/CreateAgentDialog";
import { CreateProjectDialog } from "@/components/panels/CreateProjectDialog";
import { Toolbar } from "@/components/panels/Toolbar";

import { CommandPalette } from "@/components/panels/CommandPalette";
import { useAgentStore } from "@/stores/agent-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useProjectStore } from "@/stores/project-store";
import { useLayerStore } from "@/stores/layer-store";
import { useAgentEvents } from "@/hooks/use-agent-events";
import { useNotifications } from "@/hooks/use-notifications";
import { useTauriDrop } from "@/hooks/use-tauri-drop";
import { TauriDropContext } from "@/contexts/tauri-drop-context";
import { NotificationToast } from "@/components/notifications/NotificationToast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProjectSidebar } from "@/components/sidebar";

/** Duration for layer transition animations (enter/exit focus) */
const TRANSITION_DURATION_MS = 120;

function App() {
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const activeLayer = useLayerStore((s) => s.activeLayer);
  const focusedAgentId = useLayerStore((s) => s.focusedAgentId);
  const transitionState = useLayerStore((s) => s.transitionState);
  const enterFocus = useLayerStore((s) => s.enterFocus);
  const exitFocus = useLayerStore((s) => s.exitFocus);
  const openCommand = useLayerStore((s) => s.openCommand);
  const closeCommand = useLayerStore((s) => s.closeCommand);
  const switchAgent = useLayerStore((s) => s.switchAgent);
  const setTransitionState = useLayerStore((s) => s.setTransitionState);
  const toggleSidebar = useLayerStore((s) => s.toggleSidebar);

  useAgentEvents();
  useNotifications();
  const tauriDropState = useTauriDrop();

  // Dark mode is the only supported theme; this ensures the class is always present
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    const load = (fn: () => Promise<void>, label: string, retries = 2) => {
      fn().catch((err) => {
        console.warn(`${label} failed, retries left: ${retries}`, err);
        if (retries > 0) setTimeout(() => load(fn, label, retries - 1), 300);
      });
    };
    load(fetchAgents, "fetchAgents");
    load(fetchProjects, "fetchProjects");
  }, [fetchAgents, fetchProjects]);

  // Use refs to avoid stale closures for dialog state in the keyboard handler
  const showCreateAgentRef = useRef(showCreateAgent);
  showCreateAgentRef.current = showCreateAgent;
  const showCreateProjectRef = useRef(showCreateProject);
  showCreateProjectRef.current = showCreateProject;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const agents = useAgentStore.getState().agents;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isMod && e.key === "k") {
        e.preventDefault();
        if (activeLayer === "command") closeCommand();
        else openCommand();
        return;
      }

      if (e.key === "Escape") {
        if (showCreateAgentRef.current || showCreateProjectRef.current) return;
        if (activeLayer === "command") { closeCommand(); e.preventDefault(); return; }
        if (activeLayer === "focus") { exitFocus(); e.preventDefault(); return; }
        return;
      }

      if (isMod && e.key.toLowerCase() === "b" && !isInput) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (isMod && e.key === "n" && !e.shiftKey) { e.preventDefault(); setShowCreateAgent(true); return; }
      if (isMod && e.key === "n" && e.shiftKey) { e.preventDefault(); setShowCreateProject(true); return; }

      if (isMod && e.key === ".") {
        e.preventDefault();
        const targetId = focusedAgentId;
        if (targetId) {
          const agent = agents.find((a) => a.id === targetId);
          if (agent?.status === "running") useAgentStore.getState().stopAgent(targetId);
        }
        return;
      }

      if (isMod && e.key.toLowerCase() === "p" && activeLayer === "canvas") {
        e.preventDefault();
        document.getElementById("studio-filter-input")?.focus();
        return;
      }

    },
    [activeLayer, focusedAgentId, enterFocus, exitFocus, openCommand, closeCommand, toggleSidebar],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (transitionState === "idle") return;
    const timer = setTimeout(() => setTransitionState("idle"), TRANSITION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [transitionState, setTransitionState]);

  const showFocus = activeLayer === "focus" || transitionState !== "idle";

  return (
    <TauriDropContext.Provider value={tauriDropState}>
    <TooltipProvider>
      <div className="h-screen flex flex-col" style={{ background: "var(--studio-bg, #09090b)" }}>
        <Toolbar
          onNewAgent={() => setShowCreateAgent(true)}
          onNewProject={() => setShowCreateProject(true)}
        />
        <div className="flex-1 flex overflow-hidden">
          <ProjectSidebar />
          <div className="flex-1 relative overflow-hidden">
          <div className={cn(
            "absolute inset-0",
            activeLayer === "focus" && transitionState === "entering" && "animate-canvas-recede",
            activeLayer === "canvas" && transitionState === "exiting" && "animate-canvas-restore",
            activeLayer === "focus" && transitionState === "idle" && "invisible pointer-events-none",
          )}>
            <Canvas
              onCreateAgent={() => setShowCreateAgent(true)}
              onCreateProject={() => setShowCreateProject(true)}
              onAgentClick={(agentId) => enterFocus(agentId)}
            />
          </div>
          {showFocus && focusedAgentId && (
            <div className={cn(
              "absolute inset-0",
              activeLayer === "focus" && transitionState === "entering" && "animate-focus-enter",
              activeLayer === "canvas" && transitionState === "exiting" && "animate-focus-exit",
              activeLayer === "canvas" && transitionState === "idle" && "hidden",
            )}>
              <FocusView agentId={focusedAgentId} onSwitchAgent={switchAgent} />
            </div>
          )}
          </div>
        </div>
        <CreateAgentDialog open={showCreateAgent} onOpenChange={setShowCreateAgent} />
        <CreateProjectDialog open={showCreateProject} onOpenChange={setShowCreateProject} />
        <CommandPalette
          open={activeLayer === "command"}
          onClose={closeCommand}
          onCreateAgent={() => setShowCreateAgent(true)}
          onCreateProject={() => setShowCreateProject(true)}
          onToggleNotifications={() => useNotificationStore.getState().toggleDnd()}
          onMarkAllRead={() => useNotificationStore.getState().markAllRead()}
          onSelectAgent={(agentId) => { useLayerStore.getState().commandToFocus(agentId); }}
        />
        <NotificationToast />
      </div>
    </TooltipProvider>
    </TauriDropContext.Provider>
  );
}

export default App;
