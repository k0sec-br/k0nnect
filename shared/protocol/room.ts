import { z } from 'zod';

export const REALTIME_PROTOCOL_VERSION = 5 as const;

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
const conversationIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9_-]+$/u);
const messageContentSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((content) => content.trim().length > 0);
const socialUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(24),
  displayName: z.string().min(1).max(40),
});
const socialStateSchema = z.object({
  friends: z.array(socialUserSchema.extend({ since: z.string() })),
  friendRequests: z.array(
    socialUserSchema.extend({
      direction: z.enum(['incoming', 'outgoing']),
      createdAt: z.string(),
    }),
  ),
  conversations: z.array(
    z.object({
      id: conversationIdSchema,
      kind: z.enum(['dm', 'group']),
      name: z.string().min(1).max(40),
      ownerUserId: z.string().uuid().nullable(),
      callRoomId: channelIdSchema.nullable(),
      isDefault: z.boolean(),
      members: z.array(socialUserSchema),
      lastMessage: z
        .object({
          id: z.number().int().positive(),
          senderId: z.string().uuid(),
          createdAt: z.string(),
          deleted: z.boolean(),
        })
        .nullable(),
    }),
  ),
});

export const clientRoomMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal('chat.send'),
    payload: z
      .object({
        conversationId: conversationIdSchema.optional(),
        recipientUserId: z.string().uuid().optional(),
        clientMessageId: z.string().uuid(),
        content: messageContentSchema,
      })
      .strict()
      .refine((value) => Boolean(value.conversationId) !== Boolean(value.recipientUserId)),
  }),
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
      username: z.string().min(3).max(24),
      displayName: z.string().min(1).max(40),
      role: z.enum(['owner', 'admin', 'member']),
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('chat.message'),
    payload: z.object({
      id: z.number().int().positive(),
      conversationId: conversationIdSchema,
      senderId: z.string().uuid(),
      clientMessageId: z.string().uuid(),
      content: z.string().min(1).max(2000),
      createdAt: z.string(),
      editedAt: z.null(),
      deletedAt: z.null(),
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('chat.updated'),
    payload: z.object({
      id: z.number().int().positive(),
      conversationId: conversationIdSchema,
      senderId: z.string().uuid(),
      content: z.string().min(1).max(2000),
      editedAt: z.string(),
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('chat.deleted'),
    payload: z.object({
      id: z.number().int().positive(),
      conversationId: conversationIdSchema,
      senderId: z.string().uuid(),
      deletedAt: z.string(),
    }),
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('social.changed'),
    payload: z.object({
      userId: z.string().uuid(),
      reason: z.enum(['friends', 'groups', 'conversations']),
      ...socialStateSchema.shape,
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
