import { useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export function useToast(durationMs = 3000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = globalThis.crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    timers.current[id] = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      delete timers.current[id];
    }, durationMs);
    return id;
  }, [durationMs]);

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, show, dismiss };
}
