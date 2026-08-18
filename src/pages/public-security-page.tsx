import { PublicLayout } from '../components/public-layout';

export function PublicSecurityPage() {
  return (
    <PublicLayout>
      <article className="legal-page">
        <p className="eyebrow">Segurança por padrão</p>
        <h1>Como protegemos o k0nnect</h1>
        <p className="legal-lead">
          Convites de uso único, senhas derivadas com PBKDF2, sessões opacas e autorização no
          servidor formam a base de cada acesso.
        </p>
        <section>
          <h2>Sessões e conta</h2>
          <p>
            A sessão fica em cookie HttpOnly, nunca no armazenamento do navegador. Códigos de
            recuperação substituem a coleta obrigatória de email e são mostrados apenas uma vez.
          </p>
        </section>
        <section>
          <h2>Comunicação</h2>
          <p>
            Presença e controle trafegam em WebSocket autenticado. A mídia usa WebRTC e não passa
            pelo banco de dados nem pelo Durable Object.
          </p>
        </section>
        <section>
          <h2>Relatar uma vulnerabilidade</h2>
          <p>
            Use o Private Vulnerability Reporting do repositório no GitHub, quando disponível. Não
            publique detalhes de uma falha ainda não corrigida em uma issue pública.
          </p>
        </section>
      </article>
    </PublicLayout>
  );
}
