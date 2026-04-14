import 'dotenv/config';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET } = process.env;
const client = initiateDeveloperControlledWalletsClient({
  apiKey: CIRCLE_API_KEY!,
  entitySecret: CIRCLE_ENTITY_SECRET!,
});

const txId = process.argv[2];
if (!txId) {
  console.error('Usage: tsx scripts/inspect-tx.ts <transactionId>');
  process.exit(1);
}

const res = await client.getTransaction({ id: txId });
console.log(JSON.stringify(res.data, null, 2));
