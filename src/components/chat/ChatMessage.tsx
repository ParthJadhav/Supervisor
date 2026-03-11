import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Image } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallBlock } from "@/components/chat/ToolCallBlock";
import { rgba as projectRgba } from "@/lib/project-colors";
import type { ChatMessage as ChatMessageType, ImageAttachment } from "@/types";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/**
 * Split markdown content into "completed" blocks and an "active" tail.
 * Completed blocks are paragraphs/sections separated by double newlines
 * that won't change as more tokens arrive. The active block is the last
 * incomplete section that's still being appended to.
 */
function splitBlocks(content: string): { completed: string[]; active: string } {
  // Split on double newlines (paragraph boundaries)
  const parts = content.split(/\n\n/);
  if (parts.length <= 1) {
    return { completed: [], active: content };
  }
  // All but the last part are "completed" — they won't change
  const completed = parts.slice(0, -1);
  const active = parts[parts.length - 1];
  return { completed, active };
}

/** Renders a completed markdown block — memoized so it never re-renders */
const CompletedBlock = memo<{ content: string }>(({ content }) => (
  <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
    {content}
  </ReactMarkdown>
));
CompletedBlock.displayName = "CompletedBlock";

function getImageSrc(img: ImageAttachment): string {
  // Path-based images (from Tauri drop): use Tauri's asset protocol (no base64 in state)
  if (img.path) return convertFileSrc(img.path);
  // Data-based images (from paste/picker): use data URL
  return `data:${img.media_type};base64,${img.data}`;
}

interface ChatMessageProps {
  message: ChatMessageType;
  projectColor?: string;
}

export const ChatMessage = memo<ChatMessageProps>(({ message, projectColor }) => {
  // Tool call messages render as a ToolCallBlock
  if (message.role === "tool" && message.toolCall) {
    return <ToolCallBlock toolCall={message.toolCall} />;
  }

  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "relative text-base leading-relaxed",
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-sm px-4 py-3 text-foreground"
            : "max-w-full text-muted-foreground",
        )}
        style={isUser ? { background: projectColor ? projectRgba(projectColor, 0.12) : "color-mix(in oklch, var(--muted) 50%, transparent)" } : undefined}
      >
        {isUser ? (
          <>
            {message.images && message.images.length > 0 && (
              <div className="chat-msg-images">
                {message.images.map((img, i) => (
                  <img
                    key={i}
                    src={getImageSrc(img)}
                    alt={`Attachment ${i + 1}`}
                    className="chat-msg-image"
                  />
                ))}
              </div>
            )}
            {!message.images && message.imageCount && message.imageCount > 0 && (
              <div className="chat-msg-image-placeholder">
                <Image size={14} strokeWidth={1.5} />
                <span>{message.imageCount} {message.imageCount === 1 ? "image" : "images"} attached</span>
              </div>
            )}
            {message.content && <p className="text-pretty">{message.content}</p>}
          </>
        ) : message.isStreaming ? (
          <StreamingContent content={message.content} />
        ) : (
          <div className="prose-chat text-pretty">
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

/**
 * Streaming-optimized content renderer.
 * Splits content into completed blocks (memoized, never re-rendered)
 * and an active tail block (re-rendered on each token batch).
 */
const StreamingContent = memo<{ content: string }>(({ content }) => {
  const { completed, active } = useMemo(() => splitBlocks(content), [content]);

  return (
    <div className="prose-chat streaming-message text-pretty">
      {completed.map((block, i) => (
        <CompletedBlock key={`${i}-${block.length}-${block.slice(0, 32)}`} content={block} />
      ))}
      {active && (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
        >
          {active}
        </ReactMarkdown>
      )}
      <span className="studio-cursor" />
    </div>
  );
});

StreamingContent.displayName = "StreamingContent";
