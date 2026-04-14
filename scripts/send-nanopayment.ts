import 'dotenv/config';
import { readFileSync } from 'node:fs';
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
} = process.env;

if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
  console.error('Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env');
  process.exit(1);
}

const AMOUNT_USDC = '0.001';
const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';

const client = initiateDeveloperControlledWalletsClient({
  apiKey: CIRCLE_API_KEY,
  entitySecret: CIRCLE_ENTITY_SECRET,
});

function loadWallets(): WalletRecord[] {
  try {
    return JSON.parse(readFileSync(new URL('../wallets.json', import.meta.url), 'utf8'));
  } catch {
    console.error('wallets.json not found. Run `npm run create-wallets` first.');
    process.exit(1);
  }
}

async function pollUntilTerminal(txId: string): Promise<{ state: string; txHash?: string }> {
  const terminal = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);
  while (true) {
    const res = await client.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    console.log(`  state: ${state}`);
    if (terminal.has(state)) return { state, txHash: tx?.txHash };
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  const wallets = loadWallets();
  const coordinator = wallets.find((w) => w.role === 'coordinator');
  const specialist = wallets.find((w) => w.role === 'specialist');
  if (!coordinator || !specialist) {
    throw new Error('wallets.json must have a coordinator and at least one specialist');
  }

  console.log(`From coordinator ${coordinator.address}`);
  console.log(`To   specialist ${specialist.address}`);
  console.log(`Amount: ${AMOUNT_USDC} USDC on ${CIRCLE_BLOCKCHAIN}\n`);

  const res = await client.createTransaction({
    blockchain: CIRCLE_BLOCKCHAIN as TokenBlockchain,
    walletId: coordinator.id,
    destinationAddress: specialist.address,
    amount: [AMOUNT_USDC],
    tokenAddress: ARC_TESTNET_USDC,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const txId = res.data?.id;
  if (!txId) throw new Error('No transaction id in Circle response');
  console.log(`Submitted tx ${txId}. Polling...`);

  const { state, txHash } = await pollUntilTerminal(txId);

  if (state !== 'COMPLETE') {
    console.error(`\n❌ Transaction ended in state: ${state}`);
    process.exit(1);
  }

  console.log(`\n✅ Settled on Arc Testnet`);
  console.log(`   tx hash: ${txHash}`);
  if (txHash) console.log(`   explorer: https://testnet.arcscan.app/tx/${txHash}`);
}

main().catch((err: any) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
