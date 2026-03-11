/**
 * Streaming token buffer — batches rapid token arrivals and flushes
 * to the store at ~30ms intervals to avoid per-token DOM reflows.
 */

const FLUSH_INTERVAL_MS = 33; // ~30fps

type FlushCallback = (agentId: string, text: string, streaming: boolean) => void;

interface PendingChunk {
  text: string;
  streaming: boolean;
}

class StreamingBuffer {
  private pending = new Map<string, PendingChunk>();
  private rafId: number | null = null;
  private flushCb: FlushCallback | null = null;
  private lastFlush = 0;

  setFlushCallback(cb: FlushCallback) {
    this.flushCb = cb;
  }

  push(agentId: string, text: string, streaming?: boolean) {
    const isStreaming = streaming ?? false;

    // Non-streaming messages flush immediately (they're infrequent)
    if (!isStreaming) {
      this.flushAgent(agentId);
      this.flushCb?.(agentId, text, false);
      return;
    }

    // Accumulate streaming tokens
    const existing = this.pending.get(agentId);
    if (existing) {
      existing.text += text;
    } else {
      this.pending.set(agentId, { text, streaming: true });
    }

    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const now = performance.now();

      // Ensure minimum interval between flushes
      if (now - this.lastFlush < FLUSH_INTERVAL_MS) {
        // Re-schedule if we haven't hit the interval yet
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          this.flushAll();
        });
        return;
      }

      this.flushAll();
    });
  }

  private flushAll() {
    this.lastFlush = performance.now();
    for (const [agentId] of this.pending) {
      this.flushAgent(agentId);
    }
  }

  private flushAgent(agentId: string) {
    const chunk = this.pending.get(agentId);
    if (!chunk) return;
    this.pending.delete(agentId);
    this.flushCb?.(agentId, chunk.text, chunk.streaming);
  }

  /** Flush any remaining tokens for an agent (e.g. when streaming ends) */
  flushImmediate(agentId: string) {
    this.flushAgent(agentId);
  }

  dispose() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.flushAll();
    this.pending.clear();
  }
}

export const streamingBuffer = new StreamingBuffer();
