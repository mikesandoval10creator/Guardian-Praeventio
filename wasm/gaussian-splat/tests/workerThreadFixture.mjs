import { parentPort } from 'node:worker_threads';

globalThis.addEventListener = (type, listener, options) => {
  if (type !== 'message' || !options?.once) throw new Error('Expected one message per worker');
  parentPort.once('message', (data) => listener({ data }));
};
globalThis.postMessage = (result, options) => parentPort.postMessage(result, options?.transfer);
await import('../validationWorker.ts');
