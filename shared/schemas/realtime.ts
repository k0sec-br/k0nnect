import { z } from 'zod';

import { mediaSourceSchema } from '../protocol/room';

const roomIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);
const connectionIdSchema = z.string().uuid();
const realtimeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const publicationIdSchema = z.string().uuid();
const transceiverMidSchema = z.string().min(1).max(32);
const sdpSchema = z.string().min(1).max(524_288);
const offerSchema = z.object({ type: z.literal('offer'), sdp: sdpSchema }).strict();
const answerSchema = z.object({ type: z.literal('answer'), sdp: sdpSchema }).strict();

const sessionOwnerFields = {
  roomId: roomIdSchema,
  connectionId: connectionIdSchema,
  sessionId: realtimeIdentifierSchema,
};

export const realtimeSessionRequestSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('create'), roomId: roomIdSchema, connectionId: connectionIdSchema })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      ...sessionOwnerFields,
      source: mediaSourceSchema,
      mid: transceiverMidSchema,
      sessionDescription: offerSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('subscribe'),
      ...sessionOwnerFields,
      publicationId: publicationIdSchema,
      preferredRid: z.enum(['a', 'b', 'c']).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('renegotiate'),
      ...sessionOwnerFields,
      sessionDescription: answerSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('close'),
      ...sessionOwnerFields,
      publicationId: publicationIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('unsubscribe'),
      ...sessionOwnerFields,
      publicationId: publicationIdSchema,
    })
    .strict(),
  z
    .object({ action: z.literal('turn'), roomId: roomIdSchema, connectionId: connectionIdSchema })
    .strict(),
]);

export type RealtimeSessionRequest = z.infer<typeof realtimeSessionRequestSchema>;
