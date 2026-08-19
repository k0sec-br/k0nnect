import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';

import type {
  ChatMessageView,
  ConversationSummary,
  FriendView,
  SocialStateView,
  SocialUserView,
} from '../../../shared/types/api';
import { Avatar } from '../../components/avatar';
import { FormMessage } from '../../components/form-message';
import { MenuIcon, UsersIcon, VolumeIcon } from '../../components/icons';
import { apiClient } from '../../lib/api-client';
import { GroupManagementDialog } from './group-management-dialog';

interface ChatViewProps {
  conversation: ConversationSummary | null;
  recipient: SocialUserView | null;
  currentUserId: string;
  getMessages(conversationId: string | null): ChatMessageView[];
  isHistoryLoaded(conversationId: string | null): boolean;
  subscribeChat(conversationId: string | null, listener: () => void): () => void;
  canJoinCall: boolean;
  canSend: boolean;
  friends: FriendView[];
  onOpenChannels(): void;
  onOpenMembers(): void;
  onMessagesLoaded(messages: ChatMessageView[]): void;
  onSend(
    target: { conversationId: string } | { recipientUserId: string },
    content: string,
    retryClientMessageId?: string,
  ): Promise<string>;
  onUseGroupCall(): void;
  onSocialChanged(state: SocialStateView): void;
  onGroupLeft(): void;
}

export function ChatView(props: ChatViewProps) {
  const [content, setContent] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(Boolean(props.conversation));
  const [managingGroup, setManagingGroup] = useState(false);
  const [canLoadOlder, setCanLoadOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newMessageAvailable, setNewMessageAvailable] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nearEndRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const preserveScrollHeightRef = useRef<number | null>(null);
  const onMessagesLoadedRef = useRef(props.onMessagesLoaded);
  onMessagesLoadedRef.current = props.onMessagesLoaded;
  const title = props.conversation?.name ?? props.recipient?.displayName ?? 'Conversa';
  const conversationId = props.conversation?.id;
  const cacheId = conversationId ?? (props.recipient ? `pending_${props.recipient.id}` : null);
  const getMessages = props.getMessages;
  const subscribeChat = props.subscribeChat;
  const subscribe = useCallback(
    (listener: () => void) => subscribeChat(cacheId, listener),
    [cacheId, subscribeChat],
  );
  const getSnapshot = useCallback(() => getMessages(cacheId), [cacheId, getMessages]);
  const messages = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const historyCached = props.isHistoryLoaded(cacheId);

  useEffect(() => {
    if (!conversationId || historyCached) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    apiClient
      .get<{ messages: ChatMessageView[] }>(
        `/api/social/conversations/${conversationId}/messages?limit=50`,
      )
      .then((result) => {
        if (active) {
          setCanLoadOlder(result.messages.length === 50);
          onMessagesLoadedRef.current(result.messages);
        }
      })
      .catch((error: unknown) => {
        if (active) setFeedback(error instanceof Error ? error.message : 'Histórico indisponível.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId, historyCached]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (preserveScrollHeightRef.current !== null) {
      list.scrollTop += list.scrollHeight - preserveScrollHeightRef.current;
      preserveScrollHeightRef.current = null;
      return;
    }
    if (nearEndRef.current) {
      endRef.current?.scrollIntoView({ block: 'nearest' });
      setNewMessageAvailable(false);
    } else if (messages.length > previousMessageCountRef.current) {
      setNewMessageAvailable(true);
    }
    previousMessageCountRef.current = messages.length;
  }, [messages]);

  async function loadOlder() {
    if (!conversationId || loadingOlder) return;
    const oldest = messages.find((message) => message.id > 0);
    if (!oldest) return;
    setLoadingOlder(true);
    setFeedback('');
    try {
      const result = await apiClient.get<{ messages: ChatMessageView[] }>(
        `/api/social/conversations/${conversationId}/messages?before=${oldest.id}&limit=50`,
      );
      preserveScrollHeightRef.current = listRef.current?.scrollHeight ?? null;
      setCanLoadOlder(result.messages.length === 50);
      onMessagesLoadedRef.current([...result.messages, ...messages]);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Histórico indisponível.');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = content;
    if (!message.trim() || (!props.conversation && !props.recipient)) return;
    setContent('');
    setFeedback('');
    try {
      await props.onSend(
        props.conversation
          ? { conversationId: props.conversation.id }
          : { recipientUserId: props.recipient!.id },
        message,
      );
    } catch (error) {
      setContent(message);
      setFeedback(error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.');
    }
  }

  function messageTarget() {
    return props.conversation
      ? ({ conversationId: props.conversation.id } as const)
      : ({ recipientUserId: props.recipient!.id } as const);
  }

  function senderName(message: ChatMessageView): string {
    if (message.senderId === props.currentUserId) return 'Você';
    return (
      props.conversation?.members.find((member) => member.id === message.senderId)?.displayName ??
      props.recipient?.displayName ??
      'Membro'
    );
  }

  async function edit(message: ChatMessageView) {
    const nextContent = window.prompt('Editar mensagem', message.content ?? '');
    if (!nextContent?.trim() || nextContent === message.content) return;
    try {
      await apiClient.post(`/api/social/messages/${message.id}`, { content: nextContent });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível editar a mensagem.');
    }
  }

  async function remove(message: ChatMessageView) {
    if (!window.confirm('Apagar esta mensagem?')) return;
    try {
      await apiClient.delete(`/api/social/messages/${message.id}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível apagar a mensagem.');
    }
  }

  return (
    <section className="chat-view" aria-labelledby="chat-title">
      <header className="main-header chat-header">
        <button
          className="icon-button mobile-menu-button"
          type="button"
          aria-label="Mostrar navegação"
          onClick={props.onOpenChannels}
        >
          <MenuIcon aria-hidden="true" />
        </button>
        <div className="main-header-title">
          <span aria-hidden="true">#</span>
          <h1 id="chat-title">{title}</h1>
        </div>
        {props.conversation?.callRoomId && (
          <div className="chat-header-actions">
            {!props.conversation.isDefault && (
              <button className="button ghost" type="button" onClick={() => setManagingGroup(true)}>
                Configurar grupo
              </button>
            )}
            <button
              className="button ghost chat-call-button"
              type="button"
              onClick={props.onUseGroupCall}
              disabled={!props.canJoinCall}
            >
              <VolumeIcon aria-hidden="true" /> Usar chamada do grupo
            </button>
          </div>
        )}
        <button
          className="icon-button members-toggle"
          type="button"
          aria-label="Mostrar membros"
          onClick={props.onOpenMembers}
        >
          <UsersIcon aria-hidden="true" />
        </button>
      </header>
      <div
        className="message-list"
        aria-live="polite"
        ref={listRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          nearEndRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
          if (nearEndRef.current) setNewMessageAvailable(false);
        }}
      >
        {canLoadOlder && (
          <button
            className="load-older-button"
            type="button"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        {loading ? <span className="spinner" aria-label="Carregando mensagens" /> : null}
        {!loading && messages.length === 0 && (
          <div className="chat-empty">
            <Avatar displayName={title} />
            <h2>{title}</h2>
            <p>Este é o início desta conversa.</p>
          </div>
        )}
        {messages.map((message) => (
          <article
            className={`chat-message ${message.deliveryState === 'sending' ? 'is-pending' : ''} ${message.deliveryState === 'failed' ? 'is-failed' : ''}`}
            key={`${message.clientMessageId}-${message.id}`}
          >
            <Avatar displayName={senderName(message)} size="small" />
            <div>
              <header>
                <strong>{senderName(message)}</strong>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {message.editedAt && <small>(editada)</small>}
              </header>
              <p>{message.deletedAt ? <em>Mensagem apagada</em> : message.content}</p>
              {message.deliveryState === 'failed' && (
                <div className="message-failure" role="status">
                  Não foi possível enviar.
                  <button
                    type="button"
                    onClick={() =>
                      void props.onSend(
                        messageTarget(),
                        message.content ?? '',
                        message.clientMessageId,
                      )
                    }
                  >
                    Tentar novamente
                  </button>
                </div>
              )}
            </div>
            {message.senderId === props.currentUserId && message.id > 0 && !message.deletedAt && (
              <div className="message-actions">
                <button type="button" onClick={() => void edit(message)}>
                  Editar
                </button>
                <button type="button" onClick={() => void remove(message)}>
                  Apagar
                </button>
              </div>
            )}
          </article>
        ))}
        <div ref={endRef} />
      </div>
      {newMessageAvailable && (
        <button
          className="new-message-button"
          type="button"
          onClick={() => {
            nearEndRef.current = true;
            endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setNewMessageAvailable(false);
          }}
        >
          Nova mensagem
        </button>
      )}
      {feedback && <FormMessage message={feedback} />}
      {!props.canSend && (
        <p className="chat-send-restriction" role="status">
          Vocês precisam ser amigos para enviar novas mensagens.
        </p>
      )}
      <form className="message-composer" onSubmit={send}>
        <label className="sr-only" htmlFor="message-content">
          Mensagem para {title}
        </label>
        <textarea
          id="message-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={`Mensagem para ${title}`}
          maxLength={2000}
          rows={1}
          disabled={!props.canSend}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {content.length >= 1600 && <span>{content.length}/2000</span>}
        <button
          className="button primary"
          type="submit"
          disabled={!props.canSend || !content.trim()}
        >
          Enviar
        </button>
      </form>
      {managingGroup && props.conversation?.kind === 'group' && (
        <GroupManagementDialog
          conversation={props.conversation}
          currentUserId={props.currentUserId}
          friends={props.friends}
          onClose={() => setManagingGroup(false)}
          onChanged={props.onSocialChanged}
          onLeft={props.onGroupLeft}
        />
      )}
    </section>
  );
}
