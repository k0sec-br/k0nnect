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
  const contentType = context.req.header('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new AppError('VALIDATION_ERROR', 415);

  const contentLengthHeader = context.req.header('Content-Length');
  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new AppError('VALIDATION_ERROR', 400);
    }
    if (contentLength > MAX_JSON_BODY_BYTES) throw new AppError('VALIDATION_ERROR', 413);
  }

  const reader = context.req.raw.body?.getReader();
  if (!reader) throw new AppError('VALIDATION_ERROR', 400);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new AppError('VALIDATION_ERROR', 413);
    }
    chunks.push(chunk.value);
  }

  const encodedBody = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    encodedBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encodedBody));
  } catch {
    throw new AppError('VALIDATION_ERROR', 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError('VALIDATION_ERROR', 400);
  return result.data;
}
