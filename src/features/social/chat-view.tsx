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
import { IconButton } from '../../components/icon-button';
import {
  MenuIcon,
  MoreIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  PhoneIcon,
  TrashIcon,
} from '../../components/icons';
import { apiClient } from '../../lib/api-client';
import { chatAuthorUsername } from './chat-author';
import { GroupManagementDialog } from './group-management-dialog';

interface ChatViewProps {
  conversation: ConversationSummary | null;
  recipient: SocialUserView | null;
  currentUserId: string;
  currentUsername: string;
  getMessages(conversationId: string | null): ChatMessageView[];
  isHistoryLoaded(conversationId: string | null): boolean;
  subscribeChat(conversationId: string | null, listener: () => void): () => void;
  canJoinCall: boolean;
  callActive: boolean;
  callParticipants: SocialUserView[];
  canSend: boolean;
  friends: FriendView[];
  onOpenChannels(): void;
  membersSidebarOpen: boolean;
  onToggleMembers(): void;
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

function MessageActions({
  mobileMenuOpen,
  onDelete,
  onEdit,
  onMobileMenuToggle,
}: {
  mobileMenuOpen: boolean;
  onDelete(): void;
  onEdit(): void;
  onMobileMenuToggle(): void;
}) {
  return (
    <>
      <div className="message-actions" aria-label="Ações da mensagem">
        <IconButton label="Editar mensagem" onClick={onEdit}>
          <PencilIcon aria-hidden="true" />
        </IconButton>
        <IconButton label="Excluir mensagem" onClick={onDelete}>
          <TrashIcon aria-hidden="true" />
        </IconButton>
      </div>
      <div className="mobile-message-actions">
        <IconButton
          label="Abrir ações da mensagem"
          aria-expanded={mobileMenuOpen}
          onClick={onMobileMenuToggle}
        >
          <MoreIcon aria-hidden="true" />
        </IconButton>
        {mobileMenuOpen && (
          <div className="mobile-message-menu" role="menu" aria-label="Ações da mensagem">
            <button type="button" role="menuitem" onClick={onEdit}>
              <PencilIcon aria-hidden="true" /> Editar
            </button>
            <button type="button" role="menuitem" className="danger-text" onClick={onDelete}>
              <TrashIcon aria-hidden="true" /> Excluir
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function ChatView(props: ChatViewProps) {
  const [content, setContent] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(Boolean(props.conversation));
  const [managingGroup, setManagingGroup] = useState(false);
  const [canLoadOlder, setCanLoadOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newMessageAvailable, setNewMessageAvailable] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<number | null>(null);
  const [mobileMenuMessageId, setMobileMenuMessageId] = useState<number | null>(null);
  const [ignoredCallRoomId, setIgnoredCallRoomId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nearEndRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const preserveScrollHeightRef = useRef<number | null>(null);
  const onMessagesLoadedRef = useRef(props.onMessagesLoaded);
  onMessagesLoadedRef.current = props.onMessagesLoaded;
  const peer = props.conversation?.members.find((member) => member.id !== props.currentUserId);
  const title =
    props.conversation?.kind === 'dm'
      ? `@${peer?.username ?? 'unknown'}`
      : (props.conversation?.name ??
        (props.recipient ? `@${props.recipient.username}` : 'Conversa'));
  const communityConversation = props.conversation?.spaceKind === 'community';
  const privateCallAvailable = Boolean(props.conversation?.callRoomId && !communityConversation);
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

  useEffect(() => {
    if (editingMessageId === null) return;
    const input = editInputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [editingMessageId]);

  useEffect(() => {
    if (props.callParticipants.length === 0) setIgnoredCallRoomId(null);
  }, [props.callParticipants.length]);

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

  function startEdit(message: ChatMessageView) {
    setEditingMessageId(message.id);
    setEditingContent(message.content ?? '');
    setDeleteConfirmationId(null);
    setMobileMenuMessageId(null);
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setEditingContent('');
  }

  async function saveEdit(message: ChatMessageView) {
    const nextContent = editingContent.trim();
    if (!nextContent || nextContent === message.content) {
      cancelEdit();
      return;
    }
    try {
      await apiClient.post(`/api/social/messages/${message.id}`, { content: nextContent });
      cancelEdit();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível editar a mensagem.');
    }
  }

  async function remove(message: ChatMessageView) {
    try {
      await apiClient.delete(`/api/social/messages/${message.id}`);
      setDeleteConfirmationId(null);
      setMobileMenuMessageId(null);
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
          {communityConversation && <span aria-hidden="true">#</span>}
          <h1 id="chat-title">{title}</h1>
        </div>
        {props.conversation?.callRoomId && (
          <div className="chat-header-actions">
            {props.conversation.spaceKind === 'group' && (
              <button className="button ghost" type="button" onClick={() => setManagingGroup(true)}>
                Configurar grupo
              </button>
            )}
            {privateCallAvailable && (
              <IconButton
                label={props.callActive ? 'Mostrar chamada' : 'Iniciar ou entrar na chamada'}
                className="chat-call-button"
                onClick={props.onUseGroupCall}
                disabled={!props.canJoinCall}
              >
                <PhoneIcon aria-hidden="true" />
              </IconButton>
            )}
          </div>
        )}
        <button
          className="icon-button members-toggle"
          type="button"
          aria-label={props.membersSidebarOpen ? 'Ocultar membros' : 'Exibir membros'}
          aria-expanded={props.membersSidebarOpen}
          onClick={props.onToggleMembers}
        >
          {props.membersSidebarOpen ? (
            <PanelRightCloseIcon aria-hidden="true" />
          ) : (
            <PanelRightOpenIcon aria-hidden="true" />
          )}
        </button>
      </header>
      {privateCallAvailable &&
        !props.callActive &&
        props.callParticipants.length > 0 &&
        ignoredCallRoomId !== props.conversation?.callRoomId && (
          <section className="ephemeral-call-banner" aria-label="Chamada em andamento">
            <div>
              <strong>Chamada em andamento</strong>
              <span>
                {props.callParticipants.map((participant) => participant.displayName).join(', ')}
              </span>
            </div>
            <button
              className="button primary"
              type="button"
              disabled={!props.canJoinCall}
              onClick={props.onUseGroupCall}
            >
              Entrar
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => setIgnoredCallRoomId(props.conversation?.callRoomId ?? null)}
            >
              Ignorar
            </button>
          </section>
        )}
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
        {messages.map((message) => {
          const author = chatAuthorUsername({
            message,
            currentUserId: props.currentUserId,
            currentUsername: props.currentUsername,
            conversation: props.conversation,
            recipient: props.recipient,
          });
          return (
            <article
              className={`chat-message ${message.deliveryState === 'sending' ? 'is-pending' : ''} ${message.deliveryState === 'failed' ? 'is-failed' : ''}`}
              key={`${message.clientMessageId}-${message.id}`}
            >
              <Avatar displayName={author.slice(1)} size="small" />
              <div>
                <header>
                  <strong>{author}</strong>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {message.editedAt && <small>(editada)</small>}
                </header>
                {editingMessageId === message.id ? (
                  <form
                    className="message-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdit(message);
                    }}
                  >
                    <textarea
                      ref={editInputRef}
                      value={editingContent}
                      onChange={(event) => setEditingContent(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelEdit();
                        }
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      maxLength={2000}
                      rows={1}
                    />
                    <small>
                      Enter para salvar · Shift+Enter para nova linha · Esc para cancelar
                    </small>
                  </form>
                ) : (
                  <p>{message.deletedAt ? <em>Mensagem apagada</em> : message.content}</p>
                )}
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
              {deleteConfirmationId === message.id && (
                <div
                  className="message-delete-confirm"
                  role="alertdialog"
                  aria-label="Excluir mensagem"
                >
                  <span>Excluir esta mensagem? Esta ação não pode ser desfeita.</span>
                  <div>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => setDeleteConfirmationId(null)}
                    >
                      Cancelar
                    </button>
                    <button
                      className="button danger-outline"
                      type="button"
                      onClick={() => void remove(message)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )}
              {message.senderId === props.currentUserId &&
                message.id > 0 &&
                !message.deletedAt &&
                editingMessageId !== message.id &&
                deleteConfirmationId !== message.id && (
                  <MessageActions
                    mobileMenuOpen={mobileMenuMessageId === message.id}
                    onEdit={() => startEdit(message)}
                    onDelete={() => {
                      setDeleteConfirmationId(message.id);
                      setMobileMenuMessageId(null);
                    }}
                    onMobileMenuToggle={() =>
                      setMobileMenuMessageId((current) =>
                        current === message.id ? null : message.id,
                      )
                    }
                  />
                )}
            </article>
          );
        })}
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
