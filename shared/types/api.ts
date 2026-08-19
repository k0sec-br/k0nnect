export type UserRole = 'owner' | 'admin' | 'member';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface SessionView {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface RoomView {
  id: string;
  slug: string;
  name: string;
  kind: 'voice';
  position: number;
}

export interface ServerView {
  id: string;
  name: string;
}

export interface MemberView {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface SocialUserView {
  id: string;
  username: string;
  displayName: string;
}

export interface FriendView extends SocialUserView {
  since: string;
}

export interface FriendRequestView extends SocialUserView {
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  kind: 'dm' | 'group';
  name: string;
  ownerUserId: string | null;
  callRoomId: string | null;
  isDefault: boolean;
  members: SocialUserView[];
  lastMessage: {
    id: number;
    senderId: string;
    createdAt: string;
    deleted: boolean;
  } | null;
}

export interface ChatMessageView {
  id: number;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  content: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deliveryState?: 'sending' | 'sent' | 'failed';
}

export interface SocialStateView {
  friends: FriendView[];
  friendRequests: FriendRequestView[];
  conversations: ConversationSummary[];
}

export interface PublicConfig {
  registrationMode: 'disabled' | 'invite' | 'public';
  realtimeEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
}

export type BootstrapView =
  | {
      authenticated: false;
      config: PublicConfig;
    }
  | {
      authenticated: true;
      config: PublicConfig;
      user: SessionUser;
      csrfToken: string;
      server: ServerView;
      channels: RoomView[];
      members: MemberView[];
      friends: FriendView[];
      friendRequests: FriendRequestView[];
      conversations: ConversationSummary[];
      capabilities: {
        manageInvites: boolean;
      };
    };

export interface InviteView {
  id: string;
  role: Exclude<UserRole, 'owner'>;
  createdAt: string;
  expiresAt: string;
  status: 'available' | 'used' | 'revoked' | 'expired';
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
