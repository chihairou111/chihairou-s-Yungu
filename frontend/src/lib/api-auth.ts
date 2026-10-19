import { NextResponse } from 'next/server';
import { getSession } from './auth';
import { AssignmentNotFound, ServiceError, SessionEnded } from './data/errors';
import { endSession } from './session-cookie';

/** Route Handlers are not covered by the proxy, so each one calls this first. Returns the 401 response, or null when signed in. */
export async function requireSession(): Promise<Response | null> {
  const session = await getSession();
  return session ? null : NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
}

export const NOT_FOUND_ASSIGNMENT = 'Assignment not found';

/**
 * The answer to a failed data-layer call: 401 with the service's message (and our session cleared, the
 * reason kept for the sign-in page), 404 for an assignment the service does not know, otherwise the
 * service's status and message (502 when Yungu is down, 413 for a file over the limit). Anything that is
 * not a service error is rethrown.
 */
export function serviceErrorResponse(error: unknown, request: Request): Response {
  if (error instanceof SessionEnded) {
    const response = NextResponse.json({ error: error.message }, { status: 401 });
    endSession(response, request, error.message);
    return response;
  }
  if (error instanceof AssignmentNotFound) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 404 });
  if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
}

/** Wraps a Route Handler so the data layer's errors become responses (see `serviceErrorResponse`). */
export function withServiceErrors<R extends Request, A extends unknown[]>(
  handler: (request: R, ...rest: A) => Promise<Response>,
): (request: R, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    try {
      return await handler(request, ...rest);
    } catch (error) {
      return serviceErrorResponse(error, request);
    }
  };
}

/** Parses a positive integer route id; null when it is not one. */
export function parseId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A string[] of file ids from an untrusted body value, or null. */
export function toFileIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}
