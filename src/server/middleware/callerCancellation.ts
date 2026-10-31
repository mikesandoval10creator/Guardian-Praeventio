interface RequestSource {
  readonly aborted?: boolean;
  once(event: 'aborted', listener: () => void): unknown;
  off(event: 'aborted', listener: () => void): unknown;
}
interface ResponseSource {
  readonly destroyed?: boolean;
  readonly writableEnded: boolean;
  once(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
}
/** Incoming req.close also means normal body completion: it is NOT cancellation. */
export function bindCallerCancellation(req: RequestSource, res: ResponseSource) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort);
  res.once('close', close);
  if (req.aborted || res.destroyed || res.writableEnded) abort();
  return {
    signal: controller.signal,
    dispose() { req.off('aborted', abort); res.off('close', close); },
  };
}
