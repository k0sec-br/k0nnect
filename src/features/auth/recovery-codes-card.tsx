import { useState } from 'react';

import { FormMessage } from '../../components/form-message';
import { CheckIcon, CopyIcon, DownloadIcon } from '../../components/icons';

export function RecoveryCodesCard({ codes, onContinue }: { codes: string[]; onContinue(): void }) {
  const [message, setMessage] = useState('');
  const contents = `k0nnect — códigos de recuperação\n\n${codes.join('\n')}\n\nCada código pode ser usado uma única vez.`;

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(contents);
      setMessage('Códigos copiados. Guarde-os em um local seguro.');
    } catch {
      setMessage(
        'Não foi possível copiar automaticamente. Selecione os códigos e copie manualmente.',
      );
    }
  };

  const downloadCodes = () => {
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'k0nnect-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
    setMessage('Arquivo preparado. Mantenha-o protegido.');
  };

  return (
    <section className="recovery-card" aria-labelledby="recovery-title">
      <div className="success-mark" aria-hidden="true">
        <CheckIcon />
      </div>
      <p className="eyebrow">Conta protegida</p>
      <h1 id="recovery-title">Salve seus códigos de recuperação</h1>
      <p>
        Eles são a única forma de recuperar sua conta sem email. Cada código funciona uma vez e não
        poderá ser exibido novamente.
      </p>
      <div className="recovery-grid" aria-label="Códigos de recuperação">
        {codes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
      {message && <FormMessage message={message} tone="success" />}
      <div className="button-row">
        <button className="button secondary" type="button" onClick={() => void copyCodes()}>
          <CopyIcon aria-hidden="true" /> Copiar códigos
        </button>
        <button className="button secondary" type="button" onClick={downloadCodes}>
          <DownloadIcon aria-hidden="true" /> Baixar .txt
        </button>
      </div>
      <button className="button primary full" type="button" onClick={onContinue}>
        Já guardei em segurança
      </button>
    </section>
  );
}
