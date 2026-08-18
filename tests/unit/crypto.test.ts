import { describe, expect, it } from 'vitest';

import { PASSWORD_ITERATIONS } from '../../shared/constants/security';
import { hashPassword, verifyPassword } from '../../worker/crypto/password';
import { generateOpaqueToken, generateRecoveryCodes, sha256 } from '../../worker/crypto/tokens';

describe('criptografia de credenciais', () => {
  it('gera tokens opacos com 256 bits e hashes estáveis', async () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(await sha256(first)).toBe(await sha256(first));
    expect(await sha256(second)).not.toBe(await sha256(first));
  });

  it('deriva e verifica senha com PBKDF2 sem aceitar senha incorreta', async () => {
    const record = await hashPassword('uma-senha-muito-segura', 'pepper-de-teste');
    expect(record.iterations).toBe(PASSWORD_ITERATIONS);
    expect(await verifyPassword('uma-senha-muito-segura', 'pepper-de-teste', record)).toBe(true);
    expect(await verifyPassword('uma-senha-incorreta', 'pepper-de-teste', record)).toBe(false);
  });

  it('gera dez recovery codes únicos e legíveis', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){7}$/u.test(code))).toBe(true);
  });
});
