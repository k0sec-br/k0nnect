import { z } from 'zod';

import { mediaEndReasonSchema, mediaSourceSchema } from '../protocol/room';

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
      tracks: z
        .array(z.object({ source: mediaSourceSchema, mid: transceiverMidSchema }).strict())
        .min(1)
        .max(4),
      sessionDescription: offerSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('subscribe'),
      ...sessionOwnerFields,
      publicationIds: z.array(publicationIdSchema).min(1).max(32),
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
      reason: mediaEndReasonSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('unsubscribe'),
      ...sessionOwnerFields,
      publicationId: publicationIdSchema,
    })
    .strict(),
]);

export type RealtimeSessionRequest = z.infer<typeof realtimeSessionRequestSchema>;
