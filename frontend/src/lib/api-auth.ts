import { NextResponse } from 'next/server';
import { getSession } from './auth';

/** Route Handlers are not covered by the proxy, so each one calls this first. Returns the 401 response, or null when signed in. */
export async function requireSession(): Promise<Response | null> {
  const session = await getSession();
  return session ? null : NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
}

export const NOT_FOUND_ASSIGNMENT = 'Assignment not found';

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
