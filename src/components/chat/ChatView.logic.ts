/**
 * Pure helper functions for ChatView — no side effects, no React imports.
 */

/** If the viewport is within this many pixels of the bottom, we consider it "at bottom". */
export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;

/** Messages in the always-rendered tail (never virtualized). */
export const TAIL_SIZE = 8;

/** Check if a scroll container is near the bottom. */
export function isNearBottom(el: HTMLElement): boolean {
  const { scrollTop, scrollHeight, clientHeight } = el;
  return scrollHeight - scrollTop - clientHeight < AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
}

/** Estimate row height for the virtualizer based on message role. */
export function estimateMessageSize(role: string): number {
  switch (role) {
    case "user":
      return 60;
    case "assistant":
      return 200;
    case "tool":
      return 100;
    default:
      return 80;
  }
}
