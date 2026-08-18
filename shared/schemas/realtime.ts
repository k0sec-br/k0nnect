import { z } from 'zod';

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
const transceiverMidSchema = z.string().min(1).max(32);
const sdpSchema = z.string().min(1).max(524_288);

export const realtimeSessionRequestSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('create'), roomId: roomIdSchema, connectionId: connectionIdSchema })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      roomId: roomIdSchema,
      connectionId: connectionIdSchema,
      sessionId: realtimeIdentifierSchema,
      mid: transceiverMidSchema.optional(),
      sessionDescription: z.object({ type: z.literal('offer'), sdp: sdpSchema }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('subscribe'),
      roomId: roomIdSchema,
      connectionId: connectionIdSchema,
      sessionId: realtimeIdentifierSchema,
      remoteSessionId: realtimeIdentifierSchema,
      remoteTrackName: realtimeIdentifierSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('renegotiate'),
      roomId: roomIdSchema,
      connectionId: connectionIdSchema,
      sessionId: realtimeIdentifierSchema,
      sessionDescription: z.object({ type: z.literal('answer'), sdp: sdpSchema }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('close'),
      roomId: roomIdSchema,
      connectionId: connectionIdSchema,
      sessionId: realtimeIdentifierSchema,
      trackName: realtimeIdentifierSchema,
    })
    .strict(),
  z
    .object({ action: z.literal('turn'), roomId: roomIdSchema, connectionId: connectionIdSchema })
    .strict(),
]);

export type RealtimeSessionRequest = z.infer<typeof realtimeSessionRequestSchema>;
