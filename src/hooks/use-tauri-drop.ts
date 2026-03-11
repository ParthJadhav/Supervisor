import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import type { ImageAttachment } from "@/types";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

// ---------------------------------------------------------------------------
// Global drop target registry — composers register themselves here
// ---------------------------------------------------------------------------
type ComposerAddFiles = (images: ImageAttachment[]) => void;

const composerRegistry = new Map<string, { element: HTMLElement; addImages: ComposerAddFiles }>();

export function registerDropTarget(id: string, element: HTMLElement, addImages: ComposerAddFiles) {
  composerRegistry.set(id, { element, addImages });
  return () => { composerRegistry.delete(id); };
}

function findDropTarget(x: number, y: number): { id: string; addImages: ComposerAddFiles } | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  // Check if the point is inside any registered drop target
  for (const [id, target] of composerRegistry) {
    if (target.element.contains(el)) {
      return { id, addImages: target.addImages };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// App-level hook — listens to Tauri drag-drop, shows overlay, routes to target
// ---------------------------------------------------------------------------

export interface TauriDropState {
  isDragging: boolean;
  position: { x: number; y: number } | null;
  targetId: string | null;
}

export function useTauriDrop(): TauriDropState {
  const [state, setState] = useState<TauriDropState>({
    isDragging: false,
    position: null,
    targetId: null,
  });

  useEffect(() => {
    let cancelled = false;
    let hasImages = false;

    const setup = async () => {
      const unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (cancelled) return;

        const payload = event.payload;

        if (payload.type === "enter") {
          const { position, paths } = payload;
          hasImages = (paths ?? []).some(isImagePath);
          if (hasImages) {
            const target = findDropTarget(position.x, position.y);
            setState({ isDragging: true, position, targetId: target?.id ?? null });
          }
        } else if (payload.type === "over") {
          if (!hasImages) return;
          const { position } = payload;
          const target = findDropTarget(position.x, position.y);
          setState({ isDragging: true, position, targetId: target?.id ?? null });
        } else if (payload.type === "leave") {
          hasImages = false;
          setState({ isDragging: false, position: null, targetId: null });
        } else if (payload.type === "drop") {
          const { paths, position } = payload;
          setState({ isDragging: false, position: null, targetId: null });

          const imagePaths = (paths ?? []).filter(isImagePath);
          if (imagePaths.length === 0) return;

          const target = findDropTarget(position.x, position.y);
          if (!target) return;

          // Read base64 for UI preview (async, non-blocking), keep path
          // so send can pass just the path to Rust instead of re-serializing base64.
          const images: ImageAttachment[] = [];
          for (const filePath of imagePaths) {
            try {
              const result = await invoke<{ data: string; media_type: string }>(
                "read_image_as_base64",
                { path: filePath },
              );
              images.push({ data: result.data, media_type: result.media_type, path: filePath });
            } catch (err) {
              console.error("Failed to read dropped image:", filePath, err);
            }
          }
          if (images.length > 0) {
            target.addImages(images);
          }
        }
      });

      return unlisten;
    };

    let unlistenFn: (() => void) | undefined;
    setup().then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  return state;
}

// ---------------------------------------------------------------------------
// Hook for individual drop targets to register and track drag-over state
// ---------------------------------------------------------------------------

export function useDropTarget(
  id: string,
  ref: React.RefObject<HTMLElement | null>,
  addImages: ComposerAddFiles,
  globalState: TauriDropState,
) {
  // Register this target
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerDropTarget(id, el, addImages);
  }, [id, ref, addImages]);

  // Is the drag currently over this target?
  return globalState.isDragging && globalState.targetId === id;
}
