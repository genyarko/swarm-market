import 'dotenv/config';
import { ethers } from 'ethers';
import { env, loadWallets, loadDeployment } from '../server/lib/config.js';
import { execContract } from '../server/lib/circle.js';

const wallets = loadWallets();
const coordinator = wallets.find((w) => w.role === 'coordinator')!;
const specialists = wallets.filter((w) => w.role === 'specialist');
const market = loadDeployment().address as string;

const provider = new ethers.JsonRpcProvider(env.arcRpcUrl);
const reader = new ethers.Contract(
  market,
  ['function isSpecialist(address) view returns (bool)'],
  provider,
);

console.log(`Whitelisting ${specialists.length} specialists on TaskMarket @ ${market}`);
for (const spec of specialists) {
  process.stdout.write(`  ${spec.name.padEnd(14)} ${spec.address}  `);
  const already: boolean = await reader.isSpecialist(spec.address);
  if (already) {
    console.log('↷ already whitelisted');
    continue;
  }
  const res = await execContract({
    walletId: coordinator.id,
    contractAddress: market,
    abiFunctionSignature: 'setSpecialist(address,bool)',
    abiParameters: [spec.address, true],
  });
  console.log(
    res.state === 'COMPLETE' ? `✓ ${res.txHash}` : `✗ ${res.state} ${res.errorReason ?? ''}`,
  );
}
console.log('\n✅ Whitelist done');
