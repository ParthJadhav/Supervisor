import { createContext, useContext } from "react";
import type { TauriDropState } from "@/hooks/use-tauri-drop";

const defaultState: TauriDropState = {
  isDragging: false,
  position: null,
  targetId: null,
};

export const TauriDropContext = createContext<TauriDropState>(defaultState);

export function useTauriDropContext() {
  return useContext(TauriDropContext);
}
