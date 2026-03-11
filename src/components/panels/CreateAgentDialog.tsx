import { useState, useCallback } from "react";
import { ChevronDownIcon, ChevronRightIcon, CornerDownLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAgentStore } from "@/stores/agent-store";
import { useProjectStore } from "@/stores/project-store";

const ADJECTIVES = [
  "Swift", "Bright", "Bold", "Keen", "Calm", "Deft", "Wise", "Quick",
  "Sharp", "Brave", "Noble", "Vivid", "Witty", "Steady", "Clever",
  "Silent", "Lucid", "Nimble", "Gentle", "Fierce",
];

const NOUNS = [
  "Phoenix", "Falcon", "Sage", "Raven", "Cipher", "Nova", "Orbit",
  "Pulse", "Spark", "Drift", "Echo", "Flint", "Prism", "Atlas",
  "Comet", "Ember", "Quill", "Jasper", "Onyx", "Zephyr",
];

function generateAgentName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

const MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "opus", label: "Opus", hint: "Best quality" },
  { value: "sonnet", label: "Sonnet", hint: "Balanced" },
  { value: "haiku", label: "Haiku", hint: "Fastest" },
];

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: CreateAgentDialogProps) {
  const createAgent = useAgentStore((s) => s.createAgent);
  const projects = useProjectStore((s) => s.projects);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("opus");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(
    () => localStorage.getItem("create-agent-dangerous-permissions") === "true"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setRole("");
    setModel("opus");
    setProjectId(defaultProjectId ?? "");
    setSystemPrompt("");
    setShowSystemPrompt(false);
    setError(null);
    setLoading(false);
  }, [defaultProjectId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm],
  );

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const agent = await createAgent({
        name: name.trim() || generateAgentName(),
        role: role.trim() || undefined,
        model,
        project_id: projectId || undefined,
        system_prompt: systemPrompt.trim() || undefined,
        dangerously_skip_permissions: dangerouslySkipPermissions || undefined,
      });
      resetForm();
      onOpenChange(false);
      useAgentStore.getState().requestFocusAgent(agent.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create agent.",
      );
    } finally {
      setLoading(false);
    }
  }, [name, role, model, projectId, systemPrompt, dangerouslySkipPermissions, createAgent, onOpenChange, resetForm]);

  const selectedModel = MODEL_OPTIONS.find((option) => option.value === model);
  const selectedProject = projectId
    ? projects.find((project) => project.id === projectId)
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-balance">Create Agent</DialogTitle>
          <DialogDescription>
            Defaults are enough for most agents. Add a role or instructions
            only when this one needs a specific job.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="agent-name">Name</Label>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Optional
                </Badge>
              </div>
              <Input
                id="agent-name"
                placeholder="Auto-generate a name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Shown on the canvas and in notifications.
              </p>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="agent-role">Role</Label>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Optional
                </Badge>
              </div>
              <Input
                id="agent-role"
                placeholder="Frontend developer"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Short label shown on the agent card.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Model</Label>
              <Select
                value={model}
                onValueChange={(v) => setModel(v ?? "opus")}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a model">
                    {selectedModel?.label ?? "Select a model"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-medium leading-none">{option.label}</div>
                        <div className="text-xs leading-none text-muted-foreground">
                          {option.hint}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Project</Label>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Optional
                </Badge>
              </div>
              <Select
                value={projectId}
                onValueChange={(v) => setProjectId(v ?? "")}
                disabled={loading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No project">
                    {selectedProject?.name ?? "No project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-medium leading-none">No project</div>
                      <div className="text-xs text-muted-foreground">
                        Use this agent anywhere
                      </div>
                    </div>
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <div className="min-w-0 space-y-0.5">
                        <div className="truncate font-medium leading-none">
                          {project.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {project.path}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20">
            <button
              type="button"
              className="flex w-full items-center gap-2 p-3 cursor-pointer"
              onClick={() => setShowSystemPrompt((current) => !current)}
              aria-expanded={showSystemPrompt}
              aria-controls="agent-system-prompt"
              disabled={loading}
            >
              {showSystemPrompt ? <ChevronDownIcon className="size-4 shrink-0" /> : <ChevronRightIcon className="size-4 shrink-0" />}
              <div className="flex items-center gap-2">
                <Label className="pointer-events-none">Instructions</Label>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Optional
                </Badge>
              </div>
            </button>

            {showSystemPrompt && (
              <div className="px-3 pb-3">
                <Textarea
                  id="agent-system-prompt"
                  placeholder="Write tests first. Use strict TypeScript. Keep answers concise."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="min-h-24 resize-y"
                  disabled={loading}
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={dangerouslySkipPermissions}
                onChange={(e) => {
                  setDangerouslySkipPermissions(e.target.checked);
                  localStorage.setItem("create-agent-dangerous-permissions", String(e.target.checked));
                }}
                disabled={loading}
                className="size-4 rounded border-border accent-destructive shrink-0"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium">Allow dangerous permissions</span>
                {dangerouslySkipPermissions && (
                  <p className="text-xs text-destructive">
                    Gives the agent unrestricted access to filesystem and shell commands.
                    Only enable for trusted workspaces.
                  </p>
                )}
                {!dangerouslySkipPermissions && (
                  <p className="text-xs text-muted-foreground">
                    The agent will ask for confirmation before risky operations.
                  </p>
                )}
              </div>
            </label>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}

          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
            >
              {!loading && <CornerDownLeft className="size-3.5 opacity-70" />}
              {loading ? "Creating..." : "Create Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
