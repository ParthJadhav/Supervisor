import { create } from "zustand";

export type LayerName = "canvas" | "focus" | "command";
export type TransitionState = "idle" | "entering" | "exiting";

interface LayerState {
  activeLayer: LayerName;
  previousLayer: LayerName;
  focusedAgentId: string | null;
  transitionState: TransitionState;
  commandSubView: "search" | null;
  sidebarExpanded: boolean;
  toggleSidebar: () => void;

  enterFocus: (agentId: string) => void;
  exitFocus: () => void;
  openCommand: () => void;
  closeCommand: () => void;
  switchAgent: (agentId: string) => void;
  setTransitionState: (state: TransitionState) => void;
  commandToFocus: (agentId: string) => void;
  closeSubView: () => void;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  activeLayer: "canvas",
  previousLayer: "canvas",
  focusedAgentId: null,
  transitionState: "idle",
  commandSubView: null,
  sidebarExpanded: true,

  enterFocus: (agentId) =>
    set({
      previousLayer: get().activeLayer,
      activeLayer: "focus",
      focusedAgentId: agentId,
      transitionState: "entering",
    }),

  exitFocus: () =>
    set({
      activeLayer: "canvas",
      focusedAgentId: null,
      transitionState: "exiting",
    }),

  openCommand: () =>
    set({
      previousLayer: get().activeLayer,
      activeLayer: "command",
      commandSubView: "search",
    }),

  closeCommand: () =>
    set((state) => ({
      activeLayer: state.previousLayer,
      commandSubView: null,
    })),

  commandToFocus: (agentId) =>
    set({
      activeLayer: "focus",
      focusedAgentId: agentId,
      transitionState: "idle",
      commandSubView: null,
    }),

  switchAgent: (agentId) =>
    set({ focusedAgentId: agentId, transitionState: "entering" }),

  setTransitionState: (transitionState) => set({ transitionState }),

  closeSubView: () => set({ commandSubView: "search" }),

  toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
}));
