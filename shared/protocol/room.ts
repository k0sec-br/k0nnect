import { z } from 'zod';

export const ROOM_PROTOCOL_VERSION = 2 as const;

export const MEDIA_SOURCES = ['microphone', 'camera', 'screen-video', 'screen-audio'] as const;
export const mediaSourceSchema = z.enum(MEDIA_SOURCES);
export type MediaSource = z.infer<typeof mediaSourceSchema>;

export const mediaPublicationSchema = z.object({
  publicationId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.enum(['audio', 'video']),
  source: mediaSourceSchema,
  createdAt: z.number().int().nonnegative(),
});

export type MediaPublication = z.infer<typeof mediaPublicationSchema>;

export const roomParticipantSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(40),
  muted: z.boolean(),
  deafened: z.boolean(),
  speaking: z.boolean(),
});

export type RoomParticipant = z.infer<typeof roomParticipantSchema>;

export const clientRoomMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(ROOM_PROTOCOL_VERSION),
    type: z.literal('member.updated'),
    payload: z.object({ muted: z.boolean(), deafened: z.boolean() }).strict(),
  }),
  z.object({
    v: z.literal(ROOM_PROTOCOL_VERSION),
    type: z.literal('voice.speaking'),
    payload: z.object({ speaking: z.boolean() }).strict(),
  }),
  z.object({
    v: z.literal(ROOM_PROTOCOL_VERSION),
    type: z.literal('heartbeat'),
    payload: z.object({}).strict(),
  }),
]);

export type ClientRoomMessage = z.infer<typeof clientRoomMessageSchema>;

const serverEnvelope = { v: z.literal(ROOM_PROTOCOL_VERSION) };

export const serverRoomMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...serverEnvelope,
    type: z.literal('room.ready'),
    payload: z.object({
      connectionId: z.string().uuid(),
      participants: z.array(roomParticipantSchema),
      publications: z.array(mediaPublicationSchema),
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.enum(['member.joined', 'member.updated']),
    payload: roomParticipantSchema,
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('member.left'),
    payload: z.object({ userId: z.string().uuid() }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.enum(['voice.speaking', 'voice.stopped']),
    payload: z.object({ userId: z.string().uuid() }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('media.published'),
    payload: mediaPublicationSchema,
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('media.unpublished'),
    payload: z.object({ publicationId: z.string().uuid(), userId: z.string().uuid() }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('connection.restored'),
    payload: z.object({}).strict(),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('error'),
    payload: z.object({ message: z.string().min(1).max(160) }),
  }),
]);

export type ServerRoomMessage = z.infer<typeof serverRoomMessageSchema>;
