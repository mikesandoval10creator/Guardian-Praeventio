export interface DeepLinkEventDetail {
  /** In-app path + query. */
  url: string;
  /** Project the deep link pertains to, if any. */
  projectId?: string | null;
}

export const DEEP_LINK_EVENT_NAME = 'praeventio:deep-link';

const MAX_PENDING_DEEP_LINKS = 8;
let pendingDeepLinks: DeepLinkEventDetail[] = [];
let activeListeners = 0;

type DeepLinkListener = (detail: DeepLinkEventDetail) => void;

/**
 * Dispatch a deep link even when React Router has not mounted yet.
 *
 * Native appUrlOpen and push-action callbacks can arrive before the lazy
 * DeepLinkHandler effect subscribes. Keep a small in-memory handoff buffer for
 * that same application bootstrap; never persist potentially sensitive query
 * parameters to disk.
 */
export function dispatchDeepLink(detail: DeepLinkEventDetail): void {
  if (typeof window === 'undefined') return;
  if (activeListeners === 0) {
    pendingDeepLinks = [...pendingDeepLinks, detail].slice(-MAX_PENDING_DEEP_LINKS);
  }
  window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT_NAME, { detail }));
}

/** Register a router-side listener and replay events received during bootstrap. */
export function registerDeepLinkListener(listener: DeepLinkListener): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<DeepLinkEventDetail>).detail;
    if (!detail || typeof detail.url !== 'string' || detail.url.length === 0) return;
    listener(detail);
  };

  window.addEventListener(DEEP_LINK_EVENT_NAME, handler as EventListener);
  activeListeners += 1;

  const pending = pendingDeepLinks;
  pendingDeepLinks = [];
  for (const detail of pending) {
    window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT_NAME, { detail }));
  }

  return () => {
    window.removeEventListener(DEEP_LINK_EVENT_NAME, handler as EventListener);
    activeListeners = Math.max(0, activeListeners - 1);
  };
}

/** Test-only reset; production keeps the buffer scoped to the JS bootstrap. */
export function __resetDeepLinkBridgeForTests(): void {
  pendingDeepLinks = [];
  activeListeners = 0;
}
