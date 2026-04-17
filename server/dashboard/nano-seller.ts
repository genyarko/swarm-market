import 'dotenv/config';
import { env, loadWallets, type WalletRecord } from '../lib/config.js';
import { getNextTaskId, getTask, marketAddress, TaskStatus } from '../lib/market.js';

/**
 * Nanopayments seller.
 *
 * Exposes the same marketplace data exposed by the main dashboard's
 * custom x402 gate, but protected by **Circle's official Nanopayments
 * SDK** (`@circle-fin/x402-batching`). Runs on a separate port so the
 * main dashboard keeps working if the SDK isn't installed locally.
 *
 * Docs: https://developers.circle.com/gateway/nanopayments/quickstarts/seller
 *
 * Flow when a buyer hits `/premium-data`:
 *   1. First request: responds 402 with paymentRequirements
 *   2. Buyer signs an EIP-3009 authorization offchain
 *   3. Buyer retries with X-PAYMENT header
 *   4. Circle Gateway middleware verifies + batches settlement
 *   5. Handler runs; seller receives USDC in the Gateway unified balance
 *
 * Sub-cent pricing is economically viable because Gateway batches many
 * signed authorizations into a single on-chain settlement.
 */

type GatewayMiddlewareFactory = (opts: {
  sellerAddress: `0x${string}`;
  chain?: string;
}) => {
  require: (price: string) => (req: unknown, res: unknown, next: () => void) => void;
};

async function loadGatewaySdk(): Promise<GatewayMiddlewareFactory | null> {
  // Dynamic specifier via variable so typecheck doesn't require the optional
  // package to be installed. Runtime `import()` resolves normally.
  const spec = '@circle-fin/x402-batching/server';
  try {
    const mod = (await import(spec)) as { createGatewayMiddleware?: GatewayMiddlewareFactory };
    return mod.createGatewayMiddleware ?? null;
  } catch {
    return null;
  }
}

async function loadExpress(): Promise<((..._args: unknown[]) => any) | null> {
  const spec = 'express';
  try {
    const mod = (await import(spec)) as { default?: unknown };
    return (mod.default ?? (mod as unknown)) as (..._args: unknown[]) => any;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const PORT = Number(process.env.NANO_SELLER_PORT ?? 8788);
  const PRICE = `$${(Number(process.env.NANO_PRICE_USDC ?? env.x402PremiumPriceUsdc)).toFixed(3)}`;

  const wallets = loadWallets();
  const coordinator: WalletRecord | undefined = wallets.find((w) => w.role === 'coordinator');
  if (!coordinator) throw new Error('No coordinator wallet found in wallets.json');

  const createGatewayMiddleware = await loadGatewaySdk();
  const express = await loadExpress();
  if (!createGatewayMiddleware || !express) {
    console.error(
      'Nanopayments SDK not installed.\n' +
        '  npm install @circle-fin/x402-batching @x402/core @x402/evm express viem\n',
    );
    process.exit(1);
  }

  const app = express();

  const gateway = createGatewayMiddleware({
    sellerAddress: coordinator.address as `0x${string}`,
    chain: env.chain.circle === 'ARC-TESTNET' ? 'arcTestnet' : 'arc',
  });

  app.get('/nano/info', (_req: unknown, res: any) => {
    res.json({
      sdk: '@circle-fin/x402-batching',
      chain: env.chain.network,
      sellerAddress: coordinator.address,
      pricePerRequest: PRICE,
      endpoints: ['/premium-data', '/premium-snapshot', '/premium-stats'],
    });
  });

  app.get('/premium-data', gateway.require(PRICE), async (_req: any, res: any) => {
    const next = await getNextTaskId();
    const highest = Number(next - 1n);
    res.json({
      market: marketAddress,
      highestTaskId: highest,
      paidBy: _req.payment?.payer,
      note: 'Delivered via Circle Nanopayments (Gateway batched settlement).',
    });
  });

  app.get('/premium-snapshot', gateway.require(PRICE), async (_req: any, res: any) => {
    const next = await getNextTaskId();
    const highest = Number(next - 1n);
    const tasks = [];
    for (let id = Math.max(1, highest - 49); id <= highest; id++) {
      const t = await getTask(BigInt(id));
      tasks.push({
        id,
        taskType: t.taskType,
        status: TaskStatus[t.status],
        assignee: t.assignee,
        rewardUsdc: Number(t.reward) / 1_000_000,
      });
    }
    res.json({ market: marketAddress, tasks });
  });

  app.get('/premium-stats', gateway.require(PRICE), async (_req: any, res: any) => {
    const next = await getNextTaskId();
    res.json({ market: marketAddress, totalTasks: Number(next - 1n) });
  });

  app.listen(PORT, () => {
    console.log(`=== Nanopayments seller ===`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  chain   : ${env.chain.network}`);
    console.log(`  seller  : ${coordinator.address}`);
    console.log(`  price   : ${PRICE} per request`);
    console.log(`  SDK     : @circle-fin/x402-batching/server`);
    console.log('');
    console.log('  GET /nano/info            (unpaid)');
    console.log('  GET /premium-data         (Nanopayment-gated)');
    console.log('  GET /premium-snapshot     (Nanopayment-gated)');
    console.log('  GET /premium-stats        (Nanopayment-gated)');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
