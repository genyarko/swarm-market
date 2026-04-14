import 'dotenv/config';
import { readFileSync } from 'node:fs';
import {
  initiateDeveloperControlledWalletsClient,
  type TokenBlockchain,
} from '@circle-fin/developer-controlled-wallets';

type WalletRecord = { role: string; name: string; id: string; address: string; blockchain: string };

const {
  CIRCLE_API_KEY,
  CIRCLE_ENTITY_SECRET,
  CIRCLE_BLOCKCHAIN = 'ARC-TESTNET',
} = process.env;

if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
  console.error('Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env');
  process.exit(1);
}

const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';
const REWARD_USDC = '0.003';
const REWARD_UNITS = 3000n; // 6 decimals

const client = initiateDeveloperControlledWalletsClient({
  apiKey: CIRCLE_API_KEY!,
  entitySecret: CIRCLE_ENTITY_SECRET!,
});

function loadWallets(): WalletRecord[] {
  return JSON.parse(readFileSync(new URL('../wallets.json', import.meta.url), 'utf8'));
}

function loadDeployment() {
  try {
    return JSON.parse(readFileSync(new URL('../deployments.json', import.meta.url), 'utf8'));
  } catch {
    console.error('deployments.json not found. Run `npm run deploy-taskmarket` first.');
    process.exit(1);
  }
}

async function pollTx(txId: string, label: string): Promise<string> {
  const terminal = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);
  while (true) {
    const res = await client.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    if (terminal.has(state)) {
      if (state !== 'COMPLETE') {
        console.error(`  ✗ ${label} → ${state}`);
        console.error(`    errorReason:     ${(tx as any)?.errorReason}`);
        console.error(`    errorDetails:    ${(tx as any)?.errorDetails}`);
        console.error(`    abortReason:     ${(tx as any)?.abortReason}`);
        console.error(`    txHash:          ${tx?.txHash}`);
        console.error(`    transactionId:   ${txId}`);
        throw new Error(`${label} ended in ${state}`);
      }
      const hash = tx?.txHash ?? '';
      console.log(`  ✓ ${label}  ${hash}`);
      return hash;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

async function exec(args: {
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: (string | number | boolean | string[])[];
  label: string;
}): Promise<string> {
  const res = await client.createContractExecutionTransaction({
    walletId: args.walletId,
    contractAddress: args.contractAddress,
    abiFunctionSignature: args.abiFunctionSignature,
    abiParameters: args.abiParameters,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = (res.data as any)?.id;
  if (!txId) throw new Error(`No tx id for ${args.label}`);
  return pollTx(txId, args.label);
}

async function getUsdcBalance(walletId: string): Promise<string> {
  const res = await client.getWalletTokenBalance({ id: walletId });
  const usdc = res.data?.tokenBalances?.find((b) => b.token?.symbol === 'USDC');
  return usdc?.amount ?? '0';
}

async function main() {
  const wallets = loadWallets();
  const coordinator = wallets.find((w) => w.role === 'coordinator')!;
  const specialist = wallets.find((w) => w.role === 'specialist')!;
  const deployment = loadDeployment();
  const market = deployment.address as string;

  console.log(`Market:     ${market}`);
  console.log(`Coordinator ${coordinator.address}`);
  console.log(`Specialist  ${specialist.address}`);
  console.log(`Reward:     ${REWARD_USDC} USDC\n`);

  const coordBefore = await getUsdcBalance(coordinator.id);
  const specBefore = await getUsdcBalance(specialist.id);
  console.log(`Balances before:  coord=${coordBefore}  spec=${specBefore}\n`);

  // On Arc, gas is paid in USDC. Specialist needs enough to cover bidOnTask + submitResult.
  const SPECIALIST_GAS_FLOOR = 0.1;
  if (Number(specBefore) < SPECIALIST_GAS_FLOOR) {
    console.log(`Topping up specialist with 0.2 USDC for gas...`);
    const res = await client.createTransaction({
      blockchain: CIRCLE_BLOCKCHAIN as TokenBlockchain,
      walletId: coordinator.id,
      destinationAddress: specialist.address,
      amount: ['0.2'],
      tokenAddress: ARC_TESTNET_USDC,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    await pollTx((res.data as any)?.id, 'topup-specialist');
    console.log();
  }

  console.log('Step 1: approve TaskMarket to pull USDC from coordinator');
  await exec({
    walletId: coordinator.id,
    contractAddress: ARC_TESTNET_USDC,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [market, REWARD_UNITS.toString()],
    label: 'approve',
  });

  console.log('\nStep 2: postTask (coordinator)');
  await exec({
    walletId: coordinator.id,
    contractAddress: market,
    abiFunctionSignature: 'postTask(string,string,uint256)',
    abiParameters: ['summarize', 'demo://input-1', REWARD_UNITS.toString()],
    label: 'postTask',
  });

  console.log('\nStep 3: bidOnTask (specialist)');
  await exec({
    walletId: specialist.id,
    contractAddress: market,
    abiFunctionSignature: 'bidOnTask(uint256)',
    abiParameters: ['1'],
    label: 'bidOnTask',
  });

  console.log('\nStep 4: submitResult (specialist)');
  await exec({
    walletId: specialist.id,
    contractAddress: market,
    abiFunctionSignature: 'submitResult(uint256,string)',
    abiParameters: ['1', 'demo://result-1'],
    label: 'submitResult',
  });

  console.log('\nStep 5: approveAndPay (coordinator)');
  await exec({
    walletId: coordinator.id,
    contractAddress: market,
    abiFunctionSignature: 'approveAndPay(uint256)',
    abiParameters: ['1'],
    label: 'approveAndPay',
  });

  const coordAfter = await getUsdcBalance(coordinator.id);
  const specAfter = await getUsdcBalance(specialist.id);
  console.log(`\nBalances after:   coord=${coordAfter}  spec=${specAfter}`);
  console.log(`Specialist delta: ${Number(specAfter) - Number(specBefore)} USDC (expected ${REWARD_USDC})`);
}

main().catch((err: any) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
