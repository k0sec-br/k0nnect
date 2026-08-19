import { z } from 'zod';

export const REALTIME_PROTOCOL_VERSION = 4 as const;

export const MEDIA_SOURCES = ['microphone', 'camera', 'screen-video', 'screen-audio'] as const;
export const mediaSourceSchema = z.enum(MEDIA_SOURCES);
export type MediaSource = z.infer<typeof mediaSourceSchema>;

export const MEDIA_END_REASONS = [
  'user_stop',
  'track_ended',
  'device_removed',
  'network_failure',
  'publisher_left',
  'publication_replaced',
  'session_rebuilt',
  'error',
] as const;
export const mediaEndReasonSchema = z.enum(MEDIA_END_REASONS);
export type MediaEndReason = z.infer<typeof mediaEndReasonSchema>;

export const mediaPublicationSchema = z.object({
  publicationId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: z.enum(['audio', 'video']),
  source: mediaSourceSchema,
  createdAt: z.number().int().nonnegative(),
});

export type MediaPublication = z.infer<typeof mediaPublicationSchema>;

export const callParticipantSchema = z.object({
  userId: z.string().uuid(),
  channelId: z.string().min(1).max(64),
  muted: z.boolean(),
  deafened: z.boolean(),
  speaking: z.boolean(),
});

export type CallParticipant = z.infer<typeof callParticipantSchema>;
export type RoomParticipant = CallParticipant & { displayName: string };

const requestIdSchema = z.string().uuid();
const channelIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/u);

export const clientRoomMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal('call.join'),
    payload: z.object({ channelId: channelIdSchema, requestId: requestIdSchema }).strict(),
  }),
  z.object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal('call.takeover'),
    payload: z.object({ channelId: channelIdSchema, requestId: requestIdSchema }).strict(),
  }),
  z.object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal('call.leave'),
    payload: z.object({ requestId: requestIdSchema }).strict(),
  }),
  z.object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal('member.updated'),
    payload: z.object({ muted: z.boolean(), deafened: z.boolean() }).strict(),
  }),
  z.object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal('voice.speaking'),
    payload: z.object({ speaking: z.boolean() }).strict(),
  }),
  z.object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal('state.resync'),
    payload: z.object({}).strict(),
  }),
]);

export type ClientRoomMessage = z.infer<typeof clientRoomMessageSchema>;

const serverEnvelope = { v: z.literal(REALTIME_PROTOCOL_VERSION) };

const ephemeralSnapshotSchema = z.object({
  onlineUserIds: z.array(z.string().uuid()),
  participants: z.array(callParticipantSchema),
  publications: z.array(mediaPublicationSchema),
});

export const serverRoomMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...serverEnvelope,
    type: z.literal('server.ready'),
    payload: ephemeralSnapshotSchema.extend({
      connectionId: z.string().uuid(),
      connectionEpoch: z.number().int().positive(),
      resumed: z.boolean(),
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('state.snapshot'),
    payload: ephemeralSnapshotSchema,
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('presence.changed'),
    payload: z.object({ userId: z.string().uuid(), online: z.boolean() }).strict(),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('call.joined'),
    payload: ephemeralSnapshotSchema.pick({ participants: true, publications: true }).extend({
      channelId: channelIdSchema,
      requestId: requestIdSchema,
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('call.conflict'),
    payload: z.object({ channelId: channelIdSchema, requestId: requestIdSchema }).strict(),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('call.replaced'),
    payload: z.object({ channelId: channelIdSchema }).strict(),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('call.left'),
    payload: z.object({ requestId: requestIdSchema }).strict(),
  }),
  z.object({
    ...serverEnvelope,
    type: z.enum(['call.member.joined', 'call.member.updated']),
    payload: callParticipantSchema,
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('call.member.left'),
    payload: z.object({
      userId: z.string().uuid(),
      channelId: channelIdSchema,
      requestId: requestIdSchema.optional(),
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.enum(['member.added', 'member.updated', 'member.removed']),
    payload: z.object({
      id: z.string().uuid(),
      displayName: z.string().min(1).max(40),
      role: z.enum(['owner', 'admin', 'member']),
    }),
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
    payload: z.object({
      publicationId: z.string().uuid(),
      userId: z.string().uuid(),
      source: mediaSourceSchema,
      reason: mediaEndReasonSchema,
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('error'),
    payload: z.object({
      message: z.string().min(1).max(160),
      requestId: requestIdSchema.optional(),
    }),
  }),
]);

export type ServerRoomMessage = z.infer<typeof serverRoomMessageSchema>;
