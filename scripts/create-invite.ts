import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';

function hasArgument(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.slice(2).indexOf(name);
  return index === -1 ? undefined : process.argv.slice(2)[index + 1];
}

const role = argumentValue('--role');
const remote = hasArgument('--remote');
if (role !== 'owner') {
  process.stderr.write('Este comando local cria exclusivamente o convite inicial de owner.\n');
  process.exit(1);
}

const token = Buffer.from(randomBytes(32)).toString('base64url');
const tokenHash = createHash('sha256').update(token, 'utf8').digest('base64url');
const createdAt = new Date();
const expiresAt = new Date(createdAt.getTime() + 72 * 60 * 60 * 1_000);
const inviteId = randomUUID();
const sql = `INSERT INTO invites (id, token_hash, role, created_by, created_at, expires_at) VALUES ('${inviteId}', '${tokenHash}', 'owner', NULL, '${createdAt.toISOString()}', '${expiresAt.toISOString()}')`;
const wranglerPath = resolve('node_modules/wrangler/bin/wrangler.js');
const wranglerArguments = [
  wranglerPath,
  'd1',
  'execute',
  'k0nnect',
  remote ? '--remote' : '--local',
  ...(remote ? ['--env', 'production'] : []),
  '--command',
  sql,
];
const result = spawnSync(process.execPath, wranglerArguments, {
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (result.status !== 0) {
  process.stderr.write(
    'Não foi possível criar o convite. Confirme as migrations e a autenticação do Wrangler.\n',
  );
  process.exit(result.status ?? 1);
}

const appOrigin = remote ? 'https://connect.k0sec.org' : 'http://localhost:5173';
process.stdout.write(`${appOrigin}/invite#${token}\n`);
