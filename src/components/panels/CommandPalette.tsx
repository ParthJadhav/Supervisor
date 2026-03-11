import { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
  Bot,
  FolderOpen,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
  Plus,
  BellOff,
  CheckCheck,
  Clock,
} from "lucide-react";
import { useAgentStore } from "@/stores/agent-store";
import { useProjectStore } from "@/stores/project-store";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommandCategory = "Recent" | "Agents" | "Projects" | "Actions";
type FilterTab = "All" | "Agents" | "Projects";

interface PaletteItem {
  id: string;
  category: CommandCategory;
  label: string;
  description?: string;
  icon: React.ReactNode;
  statusDot?: string;
  onSelect: () => void;
}

// ---------------------------------------------------------------------------
// localStorage helpers for recent items
// ---------------------------------------------------------------------------

const RECENT_KEY = "supervisor-cmd-palette-recent";
const MAX_RECENT = 5;

function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecentId(id: string) {
  const recent = getRecentIds().filter((r) => r !== id);
  recent.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

// ---------------------------------------------------------------------------
// Status dot color mapping (uses semantic tokens from app.css)
// ---------------------------------------------------------------------------

function agentStatusDot(status: Agent["status"]): string {
  switch (status) {
    case "running":
      return "bg-status-active";
    case "waiting_input":
      return "bg-status-waiting";
    default:
      return "bg-status-idle";
  }
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const FILTER_TABS: FilterTab[] = ["All", "Agents", "Projects"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onCreateAgent: () => void;
  onCreateProject: () => void;
  onToggleNotifications?: () => void;
  onMarkAllRead?: () => void;
  onSelectAgent?: (agentId: string) => void;
}

export function CommandPalette({
  open,
  onClose,
  onCreateAgent,
  onCreateProject,
  onToggleNotifications,
  onMarkAllRead,
  onSelectAgent,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("All");

  const agents = useAgentStore((s) => s.agents);
  const projects = useProjectStore((s) => s.projects);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveTab("All");
    }
  }, [open]);

  // Build the full item list (unfiltered)
  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    agents.forEach((agent) => {
      const project = projects.find((p) => p.id === agent.project_id);
      items.push({
        id: `agent-${agent.id}`,
        category: "Agents",
        label: agent.name,
        description: [agent.role, project?.name].filter(Boolean).join(" \u00b7 "),
        icon: <Bot className="text-muted-foreground" />,
        statusDot: agentStatusDot(agent.status),
        onSelect: () => {
          pushRecentId(`agent-${agent.id}`);
          if (onSelectAgent) {
            onSelectAgent(agent.id);
          } else {
            useAgentStore.getState().selectAgent(agent.id);
            onClose();
          }
        },
      });
    });

    projects.forEach((project) => {
      items.push({
        id: `project-${project.id}`,
        category: "Projects",
        label: project.name,
        description: project.path,
        icon: <FolderOpen className="text-muted-foreground" />,
        onSelect: () => {
          pushRecentId(`project-${project.id}`);
          onClose();
        },
      });
    });

    items.push(
      {
        id: "action-create-agent",
        category: "Actions",
        label: "Create Agent",
        icon: <Plus className="text-muted-foreground" />,
        onSelect: () => {
          pushRecentId("action-create-agent");
          onClose();
          onCreateAgent();
        },
      },
      {
        id: "action-create-project",
        category: "Actions",
        label: "Create Project",
        icon: <FolderOpen className="text-muted-foreground" />,
        onSelect: () => {
          pushRecentId("action-create-project");
          onClose();
          onCreateProject();
        },
      },
      {
        id: "action-toggle-notifications",
        category: "Actions",
        label: "Toggle Notifications",
        icon: <BellOff className="text-muted-foreground" />,
        onSelect: () => {
          pushRecentId("action-toggle-notifications");
          onToggleNotifications?.();
          onClose();
        },
      },
      {
        id: "action-mark-all-read",
        category: "Actions",
        label: "Mark All Read",
        icon: <CheckCheck className="text-muted-foreground" />,
        onSelect: () => {
          pushRecentId("action-mark-all-read");
          onMarkAllRead?.();
          onClose();
        },
      },
    );

    return items;
  }, [agents, projects, onClose, onCreateAgent, onCreateProject, onToggleNotifications, onMarkAllRead, onSelectAgent]);

  // Build a map for quick lookup
  const itemMap = useMemo(() => {
    const map = new Map<string, PaletteItem>();
    allItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [allItems]);

  // Filtered + grouped results
  const grouped = useMemo(() => {
    const q = query.toLowerCase().trim();

    let pool = allItems;
    if (activeTab === "Agents") {
      pool = allItems.filter((item) => item.category === "Agents");
    } else if (activeTab === "Projects") {
      pool = allItems.filter((item) => item.category === "Projects");
    }

    let results: PaletteItem[];

    if (!q) {
      if (activeTab !== "All") {
        results = pool;
      } else {
        const recentIds = getRecentIds();
        const recentItems: PaletteItem[] = [];
        const recentIdSet = new Set<string>();
        recentIds.forEach((id) => {
          const item = itemMap.get(id);
          if (item) {
            recentItems.push({ ...item, category: "Recent" });
            recentIdSet.add(id);
          }
        });
        const rest = allItems.filter((item) => !recentIdSet.has(item.id));
        results = [...recentItems, ...rest];
      }
    } else {
      const matched = pool.filter((item) => {
        const searchable = [item.label, item.description || ""]
          .join(" ")
          .toLowerCase();
        return searchable.includes(q);
      });
      const order: Record<CommandCategory, number> = {
        Recent: 0,
        Agents: 1,
        Projects: 2,
        Actions: 3,
      };
      matched.sort((a, b) => order[a.category] - order[b.category]);
      results = matched;
    }

    // Group by category
    const groups: { category: CommandCategory; items: PaletteItem[] }[] = [];
    let currentCategory: CommandCategory | null = null;
    results.forEach((item) => {
      if (item.category !== currentCategory) {
        currentCategory = item.category;
        groups.push({ category: item.category, items: [] });
      }
      groups[groups.length - 1].items.push(item);
    });

    return groups;
  }, [query, allItems, itemMap, activeTab]);

  const hasResults = grouped.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      className="sm:max-w-xl"
    >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search agents, projects, and actions..."
            value={query}
            onValueChange={setQuery}
          />

          {/* Filter tabs */}
          <div className="flex items-center gap-1 px-2 py-1.5" role="tablist">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  activeTab === tab
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <CommandSeparator />

          <CommandList>
            {!hasResults && (
              <CommandEmpty>
                {query ? (
                  "No results found."
                ) : (
                  <span className="flex flex-col items-center gap-2">
                    <Clock className="size-5 text-muted-foreground" />
                    <span>No recent items. Start typing to search.</span>
                  </span>
                )}
              </CommandEmpty>
            )}

            {grouped.map((group) => (
              <CommandGroup key={group.category} heading={group.category}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => item.onSelect()}
                  >
                    {item.icon}

                    {item.statusDot && (
                      <span
                        className={cn(
                          "size-1.5 rounded-full shrink-0",
                          item.statusDot,
                        )}
                        aria-hidden="true"
                      />
                    )}

                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{item.label}</span>
                      {item.description && (
                        <span className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </div>

                    {query && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {item.category}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>

          {/* Footer */}
          <div className="flex items-center gap-4 border-t px-3 py-2">
            <span className="inline-flex items-center gap-1">
              <Kbd><ArrowUp /></Kbd>
              <Kbd><ArrowDown /></Kbd>
              <span className="text-xs text-muted-foreground">Navigate</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd><CornerDownLeft /></Kbd>
              <span className="text-xs text-muted-foreground">Select</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>esc</Kbd>
              <span className="text-xs text-muted-foreground">Close</span>
            </span>
          </div>
        </Command>
    </CommandDialog>
  );
}
