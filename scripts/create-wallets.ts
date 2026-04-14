import 'dotenv/config';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import {
  initiateDeveloperControlledWalletsClient,
  type TokenBlockchain,
} from '@circle-fin/developer-controlled-wallets';

type WalletRecord = {
  role: 'coordinator' | 'specialist' | 'treasury';
  name: string;
  id: string;
  address: string;
  blockchain: string;
};

const {
  CIRCLE_API_KEY,
  CIRCLE_ENTITY_SECRET,
  CIRCLE_BLOCKCHAIN = 'ARC-TESTNET',
  SPECIALIST_COUNT = '8',
} = process.env;

if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
  console.error('Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env.');
  console.error('Run `npm run gen-entity-secret` first if you have not registered one.');
  process.exit(1);
}

const specialistCount = Number.parseInt(SPECIALIST_COUNT, 10);
const outPath = new URL('../wallets.json', import.meta.url);
const blockchain = CIRCLE_BLOCKCHAIN as TokenBlockchain;

const client = initiateDeveloperControlledWalletsClient({
  apiKey: CIRCLE_API_KEY,
  entitySecret: CIRCLE_ENTITY_SECRET,
});

async function ensureWalletSet(): Promise<string> {
  const existingId = process.env.CIRCLE_WALLET_SET_ID;
  if (existingId) {
    console.log(`Reusing wallet set ${existingId}`);
    return existingId;
  }
  const res = await client.createWalletSet({ name: 'swarm-agents' });
  const id = res.data?.walletSet?.id;
  if (!id) throw new Error('Failed to create wallet set');
  console.log(`Created wallet set ${id}`);
  console.log(`  -> add CIRCLE_WALLET_SET_ID=${id} to .env so re-runs reuse it.`);
  return id;
}

async function createBatch(walletSetId: string, count: number) {
  const res = await client.createWallets({
    walletSetId,
    blockchains: [blockchain],
    count,
    accountType: 'EOA',
  });
  return res.data?.wallets ?? [];
}

async function main() {
  if (existsSync(outPath)) {
    const existing = JSON.parse(readFileSync(outPath, 'utf8')) as WalletRecord[];
    console.log(`wallets.json already exists with ${existing.length} wallets. Delete it to recreate.`);
    return;
  }

  const walletSetId = await ensureWalletSet();

  const coordinator = await createBatch(walletSetId, 1);
  const specialists = await createBatch(walletSetId, specialistCount);

  const records: WalletRecord[] = [
    ...coordinator.map((w, i) => ({
      role: 'coordinator' as const,
      name: `coordinator-${i + 1}`,
      id: w.id,
      address: w.address,
      blockchain: w.blockchain,
    })),
    ...specialists.map((w, i) => ({
      role: 'specialist' as const,
      name: `specialist-${i + 1}`,
      id: w.id,
      address: w.address,
      blockchain: w.blockchain,
    })),
  ];

  writeFileSync(outPath, JSON.stringify(records, null, 2));
  console.log(`\nWrote ${records.length} wallets to wallets.json\n`);
  for (const r of records) {
    console.log(`  ${r.role.padEnd(11)} ${r.name.padEnd(14)} ${r.address}`);
  }

  const coordinatorAddr = records.find((r) => r.role === 'coordinator')?.address;
  console.log('\nNext:');
  console.log('  1. Fund the coordinator with Arc Testnet USDC:');
  console.log(`       https://faucet.circle.com  →  Arc Testnet  →  ${coordinatorAddr}`);
  console.log('  2. Run: npm run send-nanopayment');
}

main().catch((err: any) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
