import { AsyncLocalStorage } from 'node:async_hooks';

/** Request-scoped values propagated to the logger and interceptors. */
export type RequestContext = {
  requestId: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the given request context (set by `RequestIdMiddleware`). */
export function runWithRequestId(
  context: RequestContext,
  fn: () => void,
): void {
  storage.run(context, fn);
}

/** Current request id, or `undefined` outside a request scope. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
