import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../types";
import { useAgentStore } from "./agent-store";

interface ProjectState {
  projects: Project[];
  fetchProjects: () => Promise<void>;
  registerProject: (name: string, path: string, color?: string, icon?: string) => Promise<Project>;
  updateProject: (id: string, updates: { name?: string; color?: string; icon?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],

  fetchProjects: async () => {
    const projects = await invoke<Project[]>("list_projects");
    set({ projects });
  },

  registerProject: async (name, path, color, icon) => {
    const project = await invoke<Project>("register_project", {
      name,
      path,
      workspaceId: null,
      color: color ?? null,
      icon: icon ?? null,
    });
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  updateProject: async (id, updates) => {
    const current = get().projects.find((p) => p.id === id);
    await invoke("update_project", {
      id,
      name: updates.name ?? current?.name ?? null,
      color: updates.color ?? current?.color ?? null,
      icon: updates.icon ?? current?.icon ?? null,
    });
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id
          ? { ...p, ...Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined)) }
          : p,
      ),
    }));
  },

  deleteProject: async (id) => {
    await invoke("delete_project", { id });
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
    useAgentStore.setState((s) => ({
      agents: s.agents.map((agent) =>
        agent.project_id === id ? { ...agent, project_id: null } : agent,
      ),
    }));
  },
}));
