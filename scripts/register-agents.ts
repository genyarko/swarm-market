import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { env, loadWallets, type WalletRecord } from '../server/lib/config.js';
import { execContract } from '../server/lib/circle.js';
import { loadRegistry, registryContract } from '../server/lib/registry.js';
import { SPECIALIST_ASSIGNMENTS } from '../server/agents/assignments.js';

/**
 * One-time onboarding: registers every specialist wallet with the ERC-8004
 * AgentRegistry, and (optionally) wires the registry into the TaskMarket
 * contract so future bids are gated by registered identity.
 *
 * Usage:
 *   npm run register-agents
 */

async function main() {
  const registry = loadRegistry();
  if (!registry) {
    console.error('No AgentRegistry deployment found. Run `npm run deploy-registry` first.');
    process.exit(1);
  }
  const wallets = loadWallets();
  const specialists = wallets.filter((w) => w.role === 'specialist');
  const coordinator = wallets.find((w) => w.role === 'coordinator')!;

  console.log(`Registering ${specialists.length} specialists with AgentRegistry @ ${registry.address}`);

  const provider = new ethers.JsonRpcProvider(env.arcRpcUrl);
  const reg = registryContract(provider);

  for (const [i, spec] of specialists.entries()) {
    process.stdout.write(`  ${spec.name.padEnd(14)} ${spec.address}  `);
    if (reg) {
      const existing: bigint = await reg.agentIdOf(spec.address);
      if (existing > 0n) {
        console.log(`↷ already registered (agentId ${existing})`);
        continue;
      }
    }
    const caps = (SPECIALIST_ASSIGNMENTS[i] ?? ['summarize']).join(',');
    const domain = `${spec.name.toLowerCase()}.agents.swarm-market.local`;
    const metadataURI = `data:application/json,${encodeURIComponent(
      JSON.stringify({
        name: spec.name,
        role: 'specialist',
        capabilities: caps.split(','),
        wallet: spec.address,
        network: env.chain.network,
        a2a: { version: '0.2', protocols: ['task-market'] },
      }),
    )}`;
    const res = await execContract({
      walletId: spec.id,
      contractAddress: registry.address,
      abiFunctionSignature: 'registerAgent(string,string)',
      abiParameters: [domain, metadataURI],
    });
    console.log(res.state === 'COMPLETE' ? `✓ ${res.txHash}` : `✗ ${res.state} ${res.errorReason ?? ''}`);
  }

  const marketPath = new URL('../deployments.json', import.meta.url);
  if (existsSync(marketPath)) {
    const market = JSON.parse(readFileSync(marketPath, 'utf8')) as { address: string };
    console.log(`\nLinking registry to TaskMarket @ ${market.address}`);
    const res = await execContract({
      walletId: coordinator.id,
      contractAddress: market.address,
      abiFunctionSignature: 'setAgentRegistry(address)',
      abiParameters: [registry.address],
    });
    console.log(
      `  setAgentRegistry  ${res.state === 'COMPLETE' ? `✓ ${res.txHash}` : `✗ ${res.state} ${res.errorReason ?? ''}`}`,
    );
  }

  console.log('\n✅ All specialists registered');
}

main().catch((err: any) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
