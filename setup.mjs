import { prepareSheets } from './lib/sheets.mjs';
import { findLocalCredentials } from './lib/local-credentials.mjs';

try {
  await findLocalCredentials();
  await prepareSheets();
  console.log('Google Sheets respondió. Pestañas App - Ventas, App - Publicidad y App - Avisos listas.');
} catch (error) {
  const reasons = error.response?.data?.error?.details?.map(detail => detail.reason).filter(Boolean) || [];
  console.error('No se pudo preparar la hoja:', error.response?.status || error.code || error.name,
    error.response?.data?.error?.status || '', reasons.join(', '));
  if (!error.response) console.error(error.message);
  process.exitCode = 1;
}
