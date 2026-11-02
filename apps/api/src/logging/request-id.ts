import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accept a caller-supplied request ID only if it is short and harmless. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuses a safe incoming request ID (e.g. from a load balancer) or creates a new one. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}
