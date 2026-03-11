import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen, Code, Globe, Database, Terminal,
  Box, Cpu, Zap, Rocket, Palette,
  Shield, Book, Music, Camera, Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PROJECT_COLORS, PROJECT_ICONS, type ProjectIcon } from "@/types";

const iconMap: Record<ProjectIcon, React.ComponentType<{ className?: string }>> = {
  folder: FolderOpen, code: Code, globe: Globe, database: Database,
  terminal: Terminal, box: Box, cpu: Cpu, zap: Zap, rocket: Rocket,
  palette: Palette, shield: Shield, book: Book, music: Music,
  camera: Camera, heart: Heart,
};

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
}: CreateProjectDialogProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  const [icon, setIcon] = useState<ProjectIcon>("folder");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setPath("");
    setName("");
    setColor("blue");
    setIcon("folder");
    setError(null);
    setLoading(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetForm();
      onOpenChange(next);
    },
    [onOpenChange, resetForm],
  );

  const handlePathChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newPath = e.target.value;
      setPath(newPath);
      setError(null);
      const segments = newPath.replace(/\/+$/, "").split("/");
      const derived = segments[segments.length - 1] || "";
      setName(derived);
    },
    [],
  );

  const handleBrowse = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select project directory",
    });
    if (selected) {
      const selectedPath = selected as string;
      setPath(selectedPath);
      setError(null);
      const segments = selectedPath.replace(/\/+$/, "").split("/");
      setName(segments[segments.length - 1] || "");
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedPath = path.trim();
      const trimmedName = name.trim();
      if (!trimmedPath) return;

      setLoading(true);
      setError(null);

      try {
        await useProjectStore
          .getState()
          .registerProject(trimmedName || trimmedPath, trimmedPath, color, icon);
        resetForm();
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add project.");
      } finally {
        setLoading(false);
      }
    },
    [path, name, color, icon, onOpenChange, resetForm],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-balance">Add Project</DialogTitle>
            <DialogDescription>
              Register a local project directory so agents can work within it.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="project-path">Path</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="project-path"
                  placeholder="/Users/you/projects/my-app"
                  value={path}
                  onChange={handlePathChange}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  disabled={loading}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleBrowse}
                  disabled={loading}
                  aria-label="Browse for folder"
                >
                  <FolderOpen data-icon />
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="my-app"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                autoComplete="off"
                disabled={loading}
              />
            </div>

            {/* Color picker */}
            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={cn(
                      "size-6 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      c.class,
                      color === c.value
                        ? "ring-2 ring-offset-2 ring-offset-background ring-white/50 scale-110"
                        : "opacity-60 hover:opacity-100",
                    )}
                    title={c.name}
                    aria-label={c.name}
                  />
                ))}
              </div>
            </div>

            {/* Icon picker */}
            <div className="grid gap-2">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-1">
                {PROJECT_ICONS.map((iconKey) => {
                  const Icon = iconMap[iconKey];
                  return (
                    <button
                      key={iconKey}
                      type="button"
                      onClick={() => setIcon(iconKey)}
                      className={cn(
                        "size-8 rounded-lg flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        icon === iconKey
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      title={iconKey}
                      aria-label={`Select ${iconKey} icon`}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!path.trim() || loading}>
              {loading ? "Adding..." : "Add Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
