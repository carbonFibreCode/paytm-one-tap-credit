/**
 * Route plumbing.
 *
 * Every JSON endpoint did the same nine lines: read the body, fail on bad
 * JSON, run Zod, render the first issue. That is here once now, so a route is
 * its schema plus its handler and nothing else.
 *
 * The wire format for a failure stays `{ error: string }` — the shape the n8n
 * code nodes and `lib/client/api.ts` already parse. Consistency comes from
 * every route going through this helper, not from changing the contract.
 */

import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { errorInfo, requestLog } from '../log';
import { firstIssue } from '../schemas';

export type Json = Record<string, unknown>;

/** A failure, in the one shape every caller already understands. */
export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Thrown by a handler to answer with a specific status instead of a 500. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** `404 Unknown userId \`u_x\`` and friends, phrased identically everywhere. */
export function unknown(kind: string, value: string): ApiError {
  return new ApiError(`Unknown ${kind} \`${value}\``, 404);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('Request body is not valid JSON', 400);
  }
}

function toResponse(error: unknown, request: Request): NextResponse {
  if (error instanceof ApiError) return apiError(error.message, error.status);
  // An unexpected throw is a bad gateway from the caller's point of view: the
  // route itself is fine, something it depends on is not.
  requestLog(request).error({
    event: 'route.failed',
    path: new URL(request.url).pathname,
    ...errorInfo(error),
  });
  return apiError(error instanceof Error ? error.message : String(error), 502);
}

/**
 * Wrap a POST/PATCH handler: parse, validate, run, and turn any throw into the
 * standard error envelope. `context` carries Next's route params.
 */
export function jsonRoute<Schema extends z.ZodTypeAny, Context = unknown>(
  schema: Schema,
  handler: (
    input: z.output<Schema>,
    context: Context,
    request: Request,
  ) => Promise<NextResponse> | NextResponse,
) {
  return async (request: Request, context: Context): Promise<NextResponse> => {
    try {
      const parsed = schema.safeParse(await readJson(request));
      if (!parsed.success) return apiError(firstIssue(parsed.error), 400);
      return await handler(parsed.data, context, request);
    } catch (error) {
      return toResponse(error, request);
    }
  };
}

/** The same wrapper for a GET, which has no body to parse. */
export function getRoute<Context = unknown>(
  handler: (request: Request, context: Context) => Promise<NextResponse> | NextResponse,
) {
  return async (request: Request, context: Context): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toResponse(error, request);
    }
  };
}
