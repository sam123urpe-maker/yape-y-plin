import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { generateVAPIDKeys } from 'web-push';

const { publicKey, privateKey } = generateVAPIDKeys();
const content = [
  'PUSH_PUBLIC_KEY=' + publicKey,
  'PUSH_PRIVATE_KEY=' + privateKey,
  'CRON_SECRET=' + randomBytes(32).toString('base64url'),
  '',
].join('\n');

try {
  await writeFile(new URL('.env.push.local', import.meta.url), content, { flag: 'wx' });
  console.log('Claves guardadas en .env.push.local. Copia las tres variables a Vercel (Production).');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Usa las claves que ya están guardadas en .env.push.local.');
}
