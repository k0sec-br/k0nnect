import type {
  ChatMessageView,
  ConversationSummary,
  SocialUserView,
} from '../../../shared/types/api';

interface ChatAuthorInput {
  message: ChatMessageView;
  currentUserId: string;
  currentUsername: string;
  conversation: ConversationSummary | null;
  recipient: SocialUserView | null;
}

export function chatAuthorUsername({
  message,
  currentUserId,
  currentUsername,
  conversation,
  recipient,
}: ChatAuthorInput): string {
  if (message.senderId === currentUserId) return `@${currentUsername}`;

  const member = conversation?.members.find((item) => item.id === message.senderId);
  const author = member ?? recipient;
  return author ? `@${author.username}` : '@unknown';
}
