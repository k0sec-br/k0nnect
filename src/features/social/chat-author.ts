import type {
  ChatMessageView,
  ConversationSummary,
  SocialUserView,
} from '../../../shared/types/api';

interface ChatAuthorInput {
  message: ChatMessageView;
  currentDisplayName: string;
  currentUserId: string;
  conversation: ConversationSummary | null;
  recipient: SocialUserView | null;
}

export function chatAuthorDisplayName({
  message,
  currentDisplayName,
  currentUserId,
  conversation,
  recipient,
}: ChatAuthorInput): string {
  if (message.senderId === currentUserId) return currentDisplayName;

  const member = conversation?.members.find((item) => item.id === message.senderId);
  const author = member ?? recipient;
  return author?.displayName ?? 'Participante';
}
