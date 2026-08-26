import { Brand } from '../../components/brand';

export function NativeConnectionScreen({
  retrying,
  onRetry,
}: {
  retrying: boolean;
  onRetry(): void;
}) {
  return (
    <main className="native-connection-screen">
      <Brand />
      <div className="native-connection-copy">
        <p className="eyebrow">Sem conexão</p>
        <h1>Não conseguimos conectar ao k0nnect</h1>
        <p>Verifique sua conexão com a internet e tente novamente.</p>
      </div>
      <button className="button primary" type="button" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Tentando...' : 'Tentar novamente'}
      </button>
    </main>
  );
}
