export function NativeSessionExpiredDialog({ onContinue }: { onContinue(): void }) {
  return (
    <div className="modal-backdrop native-session-backdrop" role="presentation">
      <section
        className="social-dialog native-session-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-description"
      >
        <div>
          <span className="eyebrow">SESSÃO</span>
          <h2 id="session-expired-title">Sua sessão expirou</h2>
          <p id="session-expired-description">Entre novamente para continuar.</p>
        </div>
        <button className="button primary full" type="button" autoFocus onClick={onContinue}>
          Entrar novamente
        </button>
      </section>
    </div>
  );
}
