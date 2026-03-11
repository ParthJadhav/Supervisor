import { memo, useCallback, useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { X, ImagePlus, ArrowUp, Square } from "lucide-react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $createParagraphNode, $createTextNode, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from "lexical";
import type { EditorState, LexicalEditor } from "lexical";
import { SlashCommandMenu } from "@/components/chat/SlashCommandMenu";
import type { SlashCommand, ImageAttachment } from "@/types";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// ---------------------------------------------------------------------------
// Lexical theme (minimal — we style via CSS classes on the container)
// ---------------------------------------------------------------------------
const EDITOR_THEME = {
  paragraph: "composer-paragraph",
};

// ---------------------------------------------------------------------------
// KeyboardPlugin — handles Enter-to-send and slash command detection
// ---------------------------------------------------------------------------
function KeyboardPlugin({
  onSend,
  showSlashMenu,
}: {
  onSend: () => void;
  showSlashMenu: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false;
        // Shift+Enter = newline (let Lexical handle it)
        if (event.shiftKey) return false;
        // If slash menu is open, consume the event so Lexical doesn't insert a newline.
        // SlashCommandMenu's own keydown listener handles the selection.
        if (showSlashMenu) return true;
        // Otherwise, send the message
        event.preventDefault();
        onSend();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSend, showSlashMenu]);

  return null;
}

// ---------------------------------------------------------------------------
// FocusPlugin — focus editor on mount
// ---------------------------------------------------------------------------
function FocusPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.focus();
  }, [editor]);
  return null;
}

// ---------------------------------------------------------------------------
// PasteImagePlugin — intercepts image pastes
// ---------------------------------------------------------------------------
function PasteImagePlugin({ onPasteImages }: { onPasteImages: (files: File[]) => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const handler = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.kind === "file" && ACCEPTED_TYPES.includes(item.type)) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        onPasteImages(imageFiles);
      }
    };

    root.addEventListener("paste", handler);
    return () => root.removeEventListener("paste", handler);
  }, [editor, onPasteImages]);

  return null;
}

// ---------------------------------------------------------------------------
// ChatComposer
// ---------------------------------------------------------------------------
interface ChatComposerProps {
  agentName: string;
  sending: boolean;
  slashCommands?: SlashCommand[];
  agentRunning?: boolean;
  onSend: (text: string, images?: ImageAttachment[]) => void;
  onStop?: () => void;
}

export interface ChatComposerHandle {
  addFiles: (files: File[]) => void;
  addImages: (images: ImageAttachment[]) => void;
}

export const ChatComposer = memo(forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer({
  agentName,
  sending,
  slashCommands,
  agentRunning = true,
  onSend,
  onStop,
}: ChatComposerProps, ref) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const editorRef = useRef<LexicalEditor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = (text.trim() || images.length > 0) && !sending;

  // --- Image handling ---
  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (f) => ACCEPTED_TYPES.includes(f.type) && f.size <= MAX_SIZE,
    );
    for (const file of fileArray) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        if (base64) {
          setImages((prev) => [...prev, { data: base64, media_type: file.type }]);
        }
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const addImages = useCallback((newImages: ImageAttachment[]) => {
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  useImperativeHandle(ref, () => ({
    addFiles: (files: File[]) => addFiles(files),
    addImages,
  }), [addFiles, addImages]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // --- Editor text extraction ---
  const handleEditorChange = useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const root = $getRoot();
      const val = root.getTextContent();
      setText(val);

      // Detect slash command — look for a "/" token being actively typed
      // Match the last "/" that starts a word (beginning of text or after a space)
      const match = val.match(/(?:^|[ ])\/([^\s/]*)$/);
      if (match) {
        setShowSlashMenu(true);
        setSlashQuery(match[1]);
      } else {
        setShowSlashMenu(false);
        setSlashQuery("");
      }
    });
  }, []);

  // --- Send ---
  const doSend = useCallback(() => {
    if (!text.trim() && images.length === 0) return;
    if (sending) return;
    onSend(text.trim(), images.length > 0 ? images : undefined);
    setImages([]);
    setShowSlashMenu(false);
    // Clear the editor
    const editor = editorRef.current;
    if (editor) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      });
    }
  }, [text, images, sending, onSend]);

  // --- Slash command selection ---
  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashMenu(false);
    const editor = editorRef.current;
    if (editor) {
      editor.update(() => {
        const root = $getRoot();
        const currentText = root.getTextContent();
        // Replace the trailing /query token with the completed command
        const replaced = currentText.replace(/\/[^\s/]*$/, `/${cmd.name} `);
        root.clear();
        const p = $createParagraphNode();
        p.append($createTextNode(replaced));
        root.append(p);
        root.selectEnd();
      });
      editor.focus();
    }
  }, []);

  const handleSlashClose = useCallback(() => {
    setShowSlashMenu(false);
  }, []);

  // --- File picker ---
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = "";
  }, [addFiles]);

  // --- Slash button click ---
  const handleSlashButtonClick = useCallback(() => {
    if (showSlashMenu) return;
    const editor = editorRef.current;
    if (editor) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const p = $createParagraphNode();
        p.append($createTextNode("/"));
        root.append(p);
        root.selectEnd();
      });
      editor.focus();
    }
  }, [showSlashMenu]);

  // --- Lexical config ---
  const initialConfig = {
    namespace: "ChatComposer",
    theme: EDITOR_THEME,
    onError: (error: Error) => console.error("Lexical error:", error),
    editorState: undefined,
  };

  return (
    <div className="px-3 pb-3 nopan nodrag nowheel" data-chat-composer>
      <div className="composer-container relative flex flex-col">
        {/* Slash command menu */}
        {showSlashMenu && slashCommands && slashCommands.length > 0 && (
          <SlashCommandMenu
            commands={(slashCommands || []).filter(Boolean)}
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={handleSlashClose}
            showAgentHint={!agentRunning}
          />
        )}

        {/* Image previews */}
        {images.length > 0 && (
          <div className="flex gap-2 px-3 pt-3 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="group relative">
                <img
                  src={`data:${img.media_type};base64,${img.data}`}
                  alt={`Attachment ${i + 1}`}
                  className="composer-thumbnail"
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="composer-thumbnail-remove"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <LexicalComposer initialConfig={initialConfig}>
            <div className="composer-editor-wrapper">
              <PlainTextPlugin
                contentEditable={
                  <ContentEditable
                    className="composer-editor"
                    aria-label={`Message ${agentName}`}
                  />
                }
                placeholder={
                  <div className="composer-placeholder">
                    Message {agentName}...
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <OnChangePlugin onChange={handleEditorChange} />
              <KeyboardPlugin
                onSend={doSend}
                showSlashMenu={showSlashMenu}
              />
              <FocusPlugin />
              <PasteImagePlugin onPasteImages={addFiles} />
              <EditorRefPlugin editorRef={editorRef} />
            </div>
          </LexicalComposer>

          {/* Action buttons */}
          <div className="flex gap-1.5 shrink-0 items-center">
            <button
              type="button"
              onClick={handleAttachClick}
              className="composer-icon-btn"
              aria-label="Attach image"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              type="button"
              className="composer-icon-btn"
              aria-label="Slash commands"
              onClick={handleSlashButtonClick}
            >
              <span className="text-[11px] font-medium leading-none">/</span>
            </button>

            {agentRunning ? (
              <button
                type="button"
                onClick={onStop}
                className="composer-send-btn composer-stop-btn"
                aria-label="Stop agent"
              >
                <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />
              </button>
            ) : (
              <button
                type="button"
                onClick={doSend}
                disabled={!canSend}
                className={`composer-send-btn${canSend ? " composer-send-btn-active" : ""}`}
                aria-label="Send message"
              >
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}));

// ---------------------------------------------------------------------------
// Tiny helper components
// ---------------------------------------------------------------------------

/** Captures the editor instance into a ref for imperative control */
function EditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}

/** Simple error boundary for Lexical */
function LexicalErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
