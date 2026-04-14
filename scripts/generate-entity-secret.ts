import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets';

const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET } = process.env;
if (!CIRCLE_API_KEY) {
  console.error('Set CIRCLE_API_KEY in .env first.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const entitySecret =
    CIRCLE_ENTITY_SECRET && CIRCLE_ENTITY_SECRET.length === 64
      ? CIRCLE_ENTITY_SECRET
      : randomBytes(32).toString('hex');

  if (!CIRCLE_ENTITY_SECRET) {
    console.log('Generated entity secret — paste into .env as CIRCLE_ENTITY_SECRET:');
    console.log('  ' + entitySecret + '\n');
  } else {
    console.log('Reusing CIRCLE_ENTITY_SECRET from .env\n');
  }

  console.log('Registering ciphertext with Circle...');
  await registerEntitySecretCiphertext({
    apiKey: CIRCLE_API_KEY!,
    entitySecret,
    recoveryFileDownloadPath: OUTPUT_DIR,
  });

  console.log('\n✅ Registered.');
  console.log(`   Recovery file saved under ./output/ — back it up (password manager).`);
  console.log('\nNext: ensure CIRCLE_ENTITY_SECRET is in .env, then run `npm run create-wallets`.');
}

main().catch((e: any) => {
  console.error('\nRegistration failed:', e?.response?.data ?? e?.message ?? e);
  process.exit(1);
});
