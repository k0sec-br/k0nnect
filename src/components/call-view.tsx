import type { MediaPublication, RoomParticipant } from '../../shared/protocol/room';
import { CallStage, type CallStageControls } from './call-stage';
import { MenuIcon, PanelRightCloseIcon, PanelRightOpenIcon, VolumeIcon } from './icons';

export function CallView({
  title,
  contextLabel,
  participants,
  currentUserId,
  publications,
  active,
  canJoin,
  statusLabel,
  membersSidebarOpen,
  controls,
  onActivate,
  onBackToChat,
  onOpenChannels,
  onToggleMembers,
  onWatchPublication,
}: {
  title: string;
  contextLabel: string;
  participants: RoomParticipant[];
  currentUserId: string;
  publications: MediaPublication[];
  active: boolean;
  canJoin: boolean;
  statusLabel: string;
  membersSidebarOpen: boolean;
  controls: CallStageControls;
  onActivate(): void;
  onBackToChat(): void;
  onOpenChannels(): void;
  onToggleMembers(): void;
  onWatchPublication(publication: MediaPublication): void;
}) {
  return (
    <section className="call-view" aria-labelledby="call-view-title">
      <header className="main-header call-view-header">
        <button
          className="icon-button mobile-menu-button"
          type="button"
          aria-label="Mostrar navegação"
          onClick={onOpenChannels}
        >
          <MenuIcon aria-hidden="true" />
        </button>
        <div className="main-header-title">
          <VolumeIcon aria-hidden="true" />
          <h1 id="call-view-title">{title}</h1>
          <span>{contextLabel}</span>
        </div>
        <button className="button ghost call-view-chat-button" type="button" onClick={onBackToChat}>
          Voltar ao chat
        </button>
        <button
          className="icon-button members-toggle"
          type="button"
          aria-label={membersSidebarOpen ? 'Ocultar membros' : 'Exibir membros'}
          aria-expanded={membersSidebarOpen}
          onClick={onToggleMembers}
        >
          {membersSidebarOpen ? (
            <PanelRightCloseIcon aria-hidden="true" />
          ) : (
            <PanelRightOpenIcon aria-hidden="true" />
          )}
        </button>
      </header>
      <CallStage
        title={title}
        contextLabel={contextLabel}
        participants={participants}
        currentUserId={currentUserId}
        publications={publications}
        active={active}
        canJoin={canJoin}
        statusLabel={statusLabel}
        variant="full"
        controls={controls}
        onActivate={onActivate}
        onWatchPublication={onWatchPublication}
      />
    </section>
  );
}
