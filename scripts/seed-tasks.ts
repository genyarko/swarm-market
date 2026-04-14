import 'dotenv/config';
import { execContract } from '../server/lib/circle.js';
import { env, loadDeployment, loadWallets } from '../server/lib/config.js';

type Seed = { taskType: string; input: string; rewardUsdc: number };

const SEEDS: Seed[] = [
  {
    taskType: 'summarize',
    input:
      'Arc is a new Layer 1 blockchain by Circle, designed with USDC as the native gas token. It targets sub-cent settlement latency and gasless UX for end users while preserving programmability via full EVM compatibility. Nanopayments are a first-class primitive aimed at machine-to-machine economics and streaming micro-transactions.',
    rewardUsdc: 0.003,
  },
  {
    taskType: 'classify',
    input:
      'The Federal Reserve signaled it may hold rates steady through mid-year as inflation data comes in slightly hotter than expected, while unemployment remains near historic lows.',
    rewardUsdc: 0.002,
  },
  {
    taskType: 'translate',
    input: 'Good morning. Where is the nearest coffee shop? I need a strong espresso before my meeting.',
    rewardUsdc: 0.004,
  },
  {
    taskType: 'sentiment',
    input:
      'The new update completely broke my workflow. Every single button now takes three clicks to do what used to take one. Absolutely infuriating.',
    rewardUsdc: 0.002,
  },
  {
    taskType: 'extract',
    input:
      'On April 20, 2026, OpenAI announced that Sam Altman would visit Tokyo to meet with SoftBank CEO Masayoshi Son regarding a $100 billion AI chip initiative. The meeting is scheduled at the Roppongi headquarters.',
    rewardUsdc: 0.003,
  },
];

function usdcToUnits(usdc: number): string {
  return Math.round(usdc * 1_000_000).toString();
}

async function main() {
  const coordinator = loadWallets().find((w) => w.role === 'coordinator')!;
  const deployment = loadDeployment();

  console.log(`Market: ${deployment.address}`);
  console.log(`Coordinator ${coordinator.address}\n`);

  // Bulk allowance: sum + a little slack.
  const totalUnits = SEEDS.reduce((sum, s) => sum + Math.round(s.rewardUsdc * 1_000_000), 0);
  const allowance = (totalUnits * 2).toString();
  console.log(`Approving TaskMarket to pull ${allowance} USDC units...`);
  const apr = await execContract({
    walletId: coordinator.id,
    contractAddress: env.usdcAddress,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [deployment.address, allowance],
  });
  if (apr.state !== 'COMPLETE') throw new Error(`approve ${apr.state}`);
  console.log(`  ✓ approve ${apr.txHash}\n`);

  for (const [i, seed] of SEEDS.entries()) {
    console.log(`Posting ${seed.taskType} (reward ${seed.rewardUsdc} USDC)...`);
    const res = await execContract({
      walletId: coordinator.id,
      contractAddress: deployment.address,
      abiFunctionSignature: 'postTask(string,string,uint256)',
      abiParameters: [seed.taskType, seed.input, usdcToUnits(seed.rewardUsdc)],
    });
    if (res.state !== 'COMPLETE') {
      console.error(`  ✗ post #${i + 1} ${res.state} ${res.errorReason ?? ''}`);
      continue;
    }
    console.log(`  ✓ post #${i + 1}  ${res.txHash}`);
  }

  console.log('\nSeeded. Now run: npm run run-agents');
}

main().catch((err: any) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
