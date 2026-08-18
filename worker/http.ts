import type { Context } from 'hono';
import type { z } from 'zod';

import { MAX_JSON_BODY_BYTES } from '../shared/constants/security';
import type { ApiFailure, ApiSuccess } from '../shared/types/api';
import type { AppBindings } from './app-types';
import { AppError } from './errors/app-error';

export function success<T>(context: Context<AppBindings>, data: T, status: 200 | 201 = 200) {
  const body: ApiSuccess<T> = { ok: true, data, requestId: context.get('requestId') };
  return context.json(body, status);
}

export function failure(context: Context<AppBindings>, error: AppError) {
  const body: ApiFailure = {
    ok: false,
    error: { code: error.code, message: error.userMessage },
    requestId: context.get('requestId'),
  };
  if (error.retryAfter) context.header('Retry-After', String(error.retryAfter));
  return context.json(body, error.status as 400);
}

export async function parseJson<TSchema extends z.ZodType>(
  context: Context<AppBindings>,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const contentLength = Number(context.req.header('Content-Length') ?? '0');
  if (contentLength > MAX_JSON_BODY_BYTES) throw new AppError('VALIDATION_ERROR', 413);
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError('VALIDATION_ERROR', 400);
  return result.data;
}
