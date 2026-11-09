import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function findLocalCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.VERCEL) return;
  const directory = new URL('../', import.meta.url);
  const candidates = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    const file = new URL(encodeURIComponent(entry.name), directory);
    try {
      const key = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
      if (key.type === 'service_account' && key.client_email && key.private_key) candidates.push(file);
    } catch {
      // Other JSON files in the project are irrelevant to authentication.
    }
  }
  if (candidates.length === 1) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = fileURLToPath(candidates[0]);
  } else if (candidates.length > 1) {
    throw new Error('Hay varios JSON de servicio. Indica cuál usar con GOOGLE_APPLICATION_CREDENTIALS.');
  }
}
