import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { loadWallets } from '../server/lib/config.js';
import {
  CoordinatorAgent,
  loadSeedDataset,
  type CoordinatorEvent,
} from '../server/agents/coordinator.js';

type Args = {
  dataset: string;
  output: string;
  paceMs: number;
  batchSize: number;
  itemLimit?: number;
  budgetUsdc?: number;
  completionTimeoutMs: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dataset: fileURLToPath(new URL('../data/seed-dataset.json', import.meta.url)),
    output: fileURLToPath(new URL('../output/processed-dataset.json', import.meta.url)),
    paceMs: 2500,
    batchSize: 10,
    completionTimeoutMs: 10 * 60_000,
  };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const k = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const v = eq === -1 ? '' : raw.slice(eq + 1);
    switch (k) {
      case 'dataset':
        if (v) args.dataset = v;
        break;
      case 'output':
        if (v) args.output = v;
        break;
      case 'pace':
        args.paceMs = Number(v);
        break;
      case 'batch':
        args.batchSize = Number(v);
        break;
      case 'limit':
        args.itemLimit = Number(v);
        break;
      case 'budget':
        args.budgetUsdc = Number(v);
        break;
      case 'timeout':
        args.completionTimeoutMs = Number(v);
        break;
    }
  }
  return args;
}

function format(ev: CoordinatorEvent): string {
  const ts = new Date().toISOString().slice(11, 19);
  switch (ev.type) {
    case 'plan':
      return `[${ts}] 📋 plan: ${ev.totalItems} items → ${ev.totalTasks} tasks, budget ${ev.totalBudgetUsdc.toFixed(4)} USDC`;
    case 'approve':
      return `[${ts}] 🔐 approve ${ev.state} allowance=${ev.allowanceUnits} ${ev.txHash ?? ''}`;
    case 'posted': {
      const t = ev.task;
      return `[${ts}] 📤 posted #${t.onChainId} ${t.taskType.padEnd(9)} item=${t.itemId} reward=${t.rewardUsdc.toFixed(3)} (${ev.index}/${ev.total})`;
    }
    case 'post-failed':
      return `[${ts}] ✗  post-failed item=${ev.plan.itemId} type=${ev.plan.taskType} ${ev.state} ${ev.reason ?? ''}`;
    case 'paid':
      return `[${ts}] 💰 paid #${ev.onChainId} → ${ev.assignee.slice(0, 10)}… (${ev.rewardUsdc.toFixed(3)} USDC) "${ev.result.slice(0, 60).replace(/\n/g, ' ')}"`;
    case 'cancelled':
      return `[${ts}] ⚠  cancelled #${ev.onChainId}`;
    case 'done':
      return `[${ts}] 🏁 done. paid=${ev.paid} unresolved=${ev.unresolved} spent=${ev.totalSpentUsdc.toFixed(4)} USDC`;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const coordinator = loadWallets().find((w) => w.role === 'coordinator');
  if (!coordinator) throw new Error('No wallet with role=coordinator in wallets.json');

  const items = loadSeedDataset(args.dataset);

  console.log('=== Coordinator Agent ===');
  console.log(`  dataset : ${args.dataset}  (${items.length} items)`);
  console.log(`  output  : ${args.output}`);
  console.log(`  pace    : ${args.paceMs}ms  batch=${args.batchSize}`);
  if (args.itemLimit) console.log(`  limit   : ${args.itemLimit} items`);
  if (args.budgetUsdc) console.log(`  budget  : ${args.budgetUsdc} USDC`);
  console.log('');

  const agent = new CoordinatorAgent({
    coordinator,
    items,
    paceMs: args.paceMs,
    batchSize: args.batchSize,
    itemLimit: args.itemLimit,
    budgetUsdc: args.budgetUsdc,
    completionTimeoutMs: args.completionTimeoutMs,
    outputPath: args.output,
    onEvent: (ev) => console.log(format(ev)),
  });

  await agent.run();
  console.log(`\nProcessed dataset written to ${args.output}`);
}

main().catch((err: any) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
