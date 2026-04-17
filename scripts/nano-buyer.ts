import 'dotenv/config';

/**
 * Nanopayments buyer.
 *
 * Uses Circle's official Nanopayments buyer SDK (`@circle-fin/x402-batching`)
 * to deposit USDC into the Gateway unified balance once, then pay per-call
 * for N requests against the seller started by `npm run nano-seller`.
 *
 * Docs: https://developers.circle.com/gateway/nanopayments/quickstarts/buyer
 *
 * Env:
 *   NANO_BUYER_PRIVATE_KEY   0x-prefixed EVM private key (buyer wallet)
 *   NANO_SELLER_URL          http://localhost:8788 (default)
 *   NANO_DEPOSIT_USDC        1 (default, one-time)
 *   NANO_REQUESTS            60 (default; 50+ proves the hackathon threshold)
 *   NANO_PATH                /premium-data (default)
 */

type GatewayClientCtor = new (opts: {
  chain: string;
  privateKey: `0x${string}`;
}) => {
  deposit: (usdc: string) => Promise<unknown>;
  pay: (url: string) => Promise<{ data: unknown; status: number }>;
  getBalances: () => Promise<{
    gateway: { formattedAvailable: string };
    onchain?: { formattedAvailable: string };
  }>;
};

async function loadGatewayClient(): Promise<GatewayClientCtor | null> {
  // Dynamic specifier via variable so typecheck doesn't require the optional
  // package to be installed. Runtime `import()` resolves normally.
  const spec = '@circle-fin/x402-batching/client';
  try {
    const mod = (await import(spec)) as {
      GatewayClient?: GatewayClientCtor;
      default?: GatewayClientCtor;
    };
    return (mod.GatewayClient ?? mod.default) ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const pk = process.env.NANO_BUYER_PRIVATE_KEY;
  if (!pk || !pk.startsWith('0x')) {
    throw new Error(
      'Set NANO_BUYER_PRIVATE_KEY in .env (a 0x-prefixed funded Arc testnet key).',
    );
  }

  const sellerUrl = process.env.NANO_SELLER_URL ?? 'http://localhost:8788';
  const deposit = process.env.NANO_DEPOSIT_USDC ?? '1';
  const requests = Number(process.env.NANO_REQUESTS ?? 60);
  const path = process.env.NANO_PATH ?? '/premium-data';
  const chain = process.env.NANO_CHAIN ?? 'arcTestnet';

  const GatewayClient = await loadGatewayClient();
  if (!GatewayClient) {
    console.error(
      'Install the Nanopayments SDK first:\n' +
        '  npm install @circle-fin/x402-batching viem\n',
    );
    process.exit(1);
  }

  const client = new GatewayClient({ chain, privateKey: pk as `0x${string}` });

  console.log('=== Nanopayments buyer ===');
  console.log(`  seller   : ${sellerUrl}${path}`);
  console.log(`  chain    : ${chain}`);
  console.log(`  deposit  : ${deposit} USDC (one-time)`);
  console.log(`  requests : ${requests}`);
  console.log('');

  console.log('Depositing to Gateway...');
  await client.deposit(deposit);
  const before = await client.getBalances();
  console.log(`  gateway balance: ${before.gateway.formattedAvailable} USDC\n`);

  const started = Date.now();
  let ok = 0;
  let fail = 0;
  const samples: unknown[] = [];
  for (let i = 1; i <= requests; i++) {
    try {
      const { data, status } = await client.pay(`${sellerUrl}${path}`);
      ok++;
      if (i <= 3 || i === requests) samples.push({ i, status, data });
      if (i % 10 === 0) console.log(`  ${i}/${requests} paid calls ok`);
    } catch (e) {
      fail++;
      console.error(`  #${i} failed: ${(e as Error).message}`);
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  const after = await client.getBalances();
  console.log('\n--- Summary ---');
  console.log(`  ok=${ok} fail=${fail} elapsed=${elapsed.toFixed(1)}s`);
  console.log(`  throughput=${(ok / elapsed).toFixed(2)} req/s`);
  console.log(`  gateway balance after: ${after.gateway.formattedAvailable} USDC`);
  console.log(`  total spent          : ${(Number(before.gateway.formattedAvailable) - Number(after.gateway.formattedAvailable)).toFixed(4)} USDC`);
  console.log('\nSample responses:');
  for (const s of samples) console.log(' ', JSON.stringify(s));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
