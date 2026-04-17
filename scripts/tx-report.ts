import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { env, loadDeployment } from '../server/lib/config.js';
import { chainConfig } from '../server/lib/config.js';
import { explorerTxUrl } from '../server/lib/chains.js';

/**
 * Transaction report.
 *
 * Scans the TaskMarket contract logs and emits:
 *   - MARKDOWN table of every tx hash with explorer links
 *   - CSV of the same
 *   - Total counts by event, used as proof of the hackathon's "50+ onchain
 *     transactions in demo" requirement.
 *
 * Usage:
 *   npm run tx-report                 # default: last 50_000 blocks
 *   npm run tx-report -- --from=0     # full history (slow)
 *   npm run tx-report -- --out=./tx-report.md
 */

const ABI = [
  'event TaskPosted(uint256 indexed id, address indexed poster, string taskType, string inputCID, uint256 reward)',
  'event TaskAssigned(uint256 indexed id, address indexed assignee)',
  'event TaskCompleted(uint256 indexed id, string resultCID)',
  'event TaskPaid(uint256 indexed id, address indexed assignee, uint256 reward)',
  'event TaskReclaimed(uint256 indexed id, address indexed expiredAssignee)',
  'event SpecialistAuthorized(address indexed who, bool allowed)',
];

type Args = { fromBlock?: number; toBlock?: number | 'latest'; out: string; csv: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { out: './tx-report.md', csv: './tx-report.csv', toBlock: 'latest' };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const k = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const v = eq === -1 ? '' : raw.slice(eq + 1);
    switch (k) {
      case 'from':
        args.fromBlock = Number(v);
        break;
      case 'to':
        args.toBlock = v === 'latest' ? 'latest' : Number(v);
        break;
      case 'out':
        args.out = v;
        break;
      case 'csv':
        args.csv = v;
        break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deployment = loadDeployment();
  const provider = new ethers.JsonRpcProvider(env.arcRpcUrl);
  const market = new ethers.Contract(deployment.address, ABI, provider);

  const tip = await provider.getBlockNumber();
  const fromBlock = args.fromBlock ?? Math.max(0, tip - 50_000);
  const toBlock = args.toBlock === 'latest' ? tip : args.toBlock;

  console.log(`Scanning ${deployment.address} on ${chainConfig.network}`);
  console.log(`  blocks ${fromBlock} → ${toBlock}`);

  const filter = { address: deployment.address, fromBlock, toBlock };
  const logs = await provider.getLogs(filter);
  const iface = new ethers.Interface(ABI);

  type Row = {
    block: number;
    txHash: string;
    event: string;
    taskId?: string;
    extra?: string;
  };
  const rows: Row[] = [];
  const counts: Record<string, number> = {};

  for (const log of logs) {
    let parsed;
    try {
      parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
    } catch {
      continue;
    }
    if (!parsed) continue;
    counts[parsed.name] = (counts[parsed.name] ?? 0) + 1;

    const taskId = parsed.args[0]?.toString?.();
    let extra = '';
    switch (parsed.name) {
      case 'TaskPosted':
        extra = `${parsed.args[2]} reward=${(Number(parsed.args[4]) / 1e6).toFixed(3)} USDC`;
        break;
      case 'TaskAssigned':
        extra = `assignee=${parsed.args[1]}`;
        break;
      case 'TaskCompleted':
        extra = `resultCID="${String(parsed.args[1]).slice(0, 40)}…"`;
        break;
      case 'TaskPaid':
        extra = `paid=${(Number(parsed.args[2]) / 1e6).toFixed(3)} USDC → ${parsed.args[1]}`;
        break;
      case 'TaskReclaimed':
        extra = `expired=${parsed.args[1]}`;
        break;
    }
    rows.push({ block: log.blockNumber, txHash: log.transactionHash, event: parsed.name, taskId, extra });
  }

  const uniqueTxCount = new Set(rows.map((r) => r.txHash)).size;
  const summary = {
    market: deployment.address,
    chain: chainConfig.network,
    scannedFromBlock: fromBlock,
    scannedToBlock: toBlock,
    totalEvents: rows.length,
    uniqueOnchainTxs: uniqueTxCount,
    counts,
  };

  let md = `# TaskMarket on-chain tx report\n\n`;
  md += `- **Contract:** \`${deployment.address}\`\n`;
  md += `- **Chain:** ${chainConfig.network}\n`;
  md += `- **Blocks scanned:** ${fromBlock} → ${toBlock}\n`;
  md += `- **Unique on-chain txs:** **${uniqueTxCount}** ` +
    (uniqueTxCount >= 50 ? '✅ (≥50, meets hackathon requirement)' : '⚠️ (<50)') +
    `\n`;
  md += `- **Events observed:**\n`;
  for (const [k, v] of Object.entries(counts)) md += `  - ${k}: ${v}\n`;
  md += `\n| # | Block | Event | Task | Details | Tx |\n|---|---|---|---|---|---|\n`;
  rows.forEach((r, i) => {
    md += `| ${i + 1} | ${r.block} | ${r.event} | ${r.taskId ?? ''} | ${r.extra ?? ''} | [${r.txHash.slice(0, 10)}…](${explorerTxUrl(chainConfig, r.txHash)}) |\n`;
  });

  writeFileSync(args.out, md);

  const csv = [
    'index,block,event,taskId,details,txHash,explorer',
    ...rows.map((r, i) =>
      [i + 1, r.block, r.event, r.taskId ?? '', (r.extra ?? '').replace(/,/g, ';'), r.txHash, explorerTxUrl(chainConfig, r.txHash)].join(','),
    ),
  ].join('\n');
  writeFileSync(args.csv, csv);

  console.log('\n--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote:`);
  console.log(`  ${args.out}`);
  console.log(`  ${args.csv}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
