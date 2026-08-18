import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { constants, writeFile } from 'node:fs/promises';

const secret = Buffer.from(randomBytes(48)).toString('base64url');
const contents = [
  `PASSWORD_PEPPER=${secret}`,
  'TURNSTILE_SECRET=local-disabled',
  'REALTIME_APP_ID=local-disabled',
  'REALTIME_APP_SECRET=local-disabled',
  'TURN_KEY_ID=local-disabled',
  'TURN_KEY_API_TOKEN=local-disabled',
  '',
].join('\n');

try {
  await writeFile('.dev.vars', contents, {
    encoding: 'utf8',
    flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
  });
  process.stdout.write('Configuração local criada em .dev.vars (arquivo ignorado pelo Git).\n');
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
    process.stdout.write('.dev.vars já existe; nenhum valor foi alterado.\n');
  } else {
    throw error;
  }
}

try {
  await writeFile('.dev.vars.production', '# Intencionalmente vazio. Use secrets remotos.\n', {
    encoding: 'utf8',
    flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
  });
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
}
