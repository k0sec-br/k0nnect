import type { RoomParticipant } from '../../shared/protocol/room';
import { Avatar, participantState } from './avatar';
import { HeadphonesOffIcon, MicOffIcon, VolumeIcon } from './icons';

export function AudioOnlyView({
  participants,
  userId,
}: {
  participants: RoomParticipant[];
  userId: string;
}) {
  return (
    <section className="audio-only-view" aria-labelledby="participants-title">
      <div className="content-section-heading">
        <div>
          <span className="technical-label">Sala de voz</span>
          <p className="content-room-title" id="participants-title">
            Geral
          </p>
        </div>
        <span>
          {participants.length} {participants.length === 1 ? 'participante' : 'participantes'}
        </span>
      </div>
      {participants.length > 0 ? (
        <div className="voice-participant-list">
          {participants.map((participant) => {
            const state = participantState(participant);
            return (
              <article
                className={`voice-participant ${participant.speaking ? 'is-speaking' : ''}`}
                key={participant.userId}
              >
                <Avatar displayName={participant.displayName} state={state} size="large" />
                <div className="voice-participant-copy">
                  <strong>
                    {participant.displayName}
                    {participant.userId === userId ? ' (você)' : ''}
                  </strong>
                  <span>
                    {state === 'speaking'
                      ? 'Falando agora'
                      : state === 'muted'
                        ? 'Microfone desativado'
                        : state === 'deafened'
                          ? 'Áudio desativado'
                          : 'Conectado'}
                  </span>
                </div>
                <div className="voice-participant-state">
                  {participant.deafened ? (
                    <HeadphonesOffIcon aria-label="Áudio desativado" />
                  ) : participant.muted ? (
                    <MicOffIcon aria-label="Microfone desativado" />
                  ) : participant.speaking ? (
                    <span className="activity-bars" aria-label="Falando agora">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <VolumeIcon aria-hidden="true" />
          <strong>A sala está vazia</strong>
          <span>Entre na voz para iniciar a conversa.</span>
        </div>
      )}
    </section>
  );
}
