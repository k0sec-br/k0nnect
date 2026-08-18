import { PublicLayout } from '../components/public-layout';

export function PrivacyPage() {
  return (
    <PublicLayout>
      <article className="legal-page">
        <p className="eyebrow">Transparência</p>
        <h1>Privacidade no k0nnect</h1>
        <p className="legal-lead">
          Coletamos o mínimo necessário para sua conta funcionar e para manter a comunidade segura.
        </p>
        <section>
          <h2>Dados armazenados</h2>
          <p>
            Usuário, nome de exibição, hash e parâmetros da senha, datas básicas da conta, hashes de
            códigos de recuperação e convites, sessões, salas e eventos mínimos de segurança.
          </p>
        </section>
        <section>
          <h2>Dados processados por pouco tempo</h2>
          <p>
            O endereço IP é usado transitoriamente contra abuso. Informações técnicas de conexão,
            microfone, câmera, tela e áudio da tela escolhido pelo usuário passam transitoriamente
            pela infraestrutura Cloudflare. O Turnstile é usado apenas quando uma verificação
            adaptativa for necessária.
          </p>
        </section>
        <section>
          <h2>O que não coletamos</h2>
          <p>
            Não coletamos localização precisa, contatos, dados para publicidade, tracking entre
            sites, fingerprinting de marketing, gravações, snapshots, miniaturas, transcrições ou
            conteúdo das conversas. Mídia não é enviada para inteligência artificial.
          </p>
        </section>
        <section>
          <h2>Mídia em tempo real</h2>
          <p>
            Áudio, vídeo e tela são transportados durante a chamada e não são gravados, armazenados
            ou transcritos pelo k0nnect. A arquitetura usa WebRTC e Cloudflare Realtime e não
            declara criptografia ponta a ponta.
          </p>
        </section>
      </article>
    </PublicLayout>
  );
}
