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
            O endereço IP é usado transitoriamente contra abuso. Informações técnicas de conexão e o
            áudio WebRTC passam pela infraestrutura Cloudflare. O Turnstile é usado apenas quando
            uma verificação adaptativa for necessária.
          </p>
        </section>
        <section>
          <h2>O que não coletamos</h2>
          <p>
            Não coletamos localização precisa, contatos, dados para publicidade, tracking entre
            sites, fingerprinting de marketing, gravações, transcrições ou conteúdo das conversas.
          </p>
        </section>
        <section>
          <h2>Áudio em tempo real</h2>
          <p>
            O áudio é transportado em tempo real e não é gravado, armazenado, transcrito ou enviado
            para sistemas de inteligência artificial pelo k0nnect.
          </p>
        </section>
      </article>
    </PublicLayout>
  );
}
