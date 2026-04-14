import 'dotenv/config';
import { env, loadWallets, type WalletRecord } from '../server/lib/config.js';
import { SpecialistAgent, type AgentEvent } from '../server/agents/agent.js';
import { SPECIALIST_ASSIGNMENTS } from '../server/agents/assignments.js';
import { execContract, getUsdcBalance, transferUsdc } from '../server/lib/circle.js';
import { getNextTaskId, getTask, marketAddress, TaskStatus } from '../server/lib/market.js';
import { Mutex } from '../server/lib/mutex.js';

const APPROVAL_POLL_MS = 4000;

function log(ev: AgentEvent) {
  const tag = `[${new Date().toISOString().slice(11, 19)}] ${ev.agent.padEnd(26)}`;
  switch (ev.type) {
    case 'saw':
      console.log(`${tag} 👀 saw #${ev.taskId} (${ev.taskType})`);
      break;
    case 'bid':
      console.log(`${tag} ${ev.won ? '🎯 won' : '❌ lost'} bid on #${ev.taskId} ${ev.txHash ?? ''}`);
      break;
    case 'result':
      console.log(`${tag} ✅ submitted #${ev.taskId}: ${ev.result.slice(0, 70).replace(/\n/g, ' ')}...`);
      break;
    case 'topup':
      console.log(`${tag} ⛽ topping up ${ev.amount} USDC`);
      break;
    case 'error':
      console.log(`${tag} ⚠️  ${ev.taskId ? `#${ev.taskId} ` : ''}${ev.message}`);
      break;
    case 'idle':
      break;
  }
}

async function batchTopup(coordinator: WalletRecord, specialists: WalletRecord[]) {
  console.log('Pre-funding specialists serially (coordinator can only sign one tx at a time)...');
  const floor = env.agentGasFloorUsdc;
  for (const spec of specialists) {
    const bal = await getUsdcBalance(spec.id);
    if (bal >= floor) {
      console.log(`  ${spec.name.padEnd(14)} ${bal.toFixed(4)} USDC  ✓ already funded`);
      continue;
    }
    const amount = (floor * 2).toFixed(3);
    process.stdout.write(`  ${spec.name.padEnd(14)} ${bal.toFixed(4)} → +${amount}  `);
    const res = await transferUsdc({
      fromWalletId: coordinator.id,
      fromAddress: coordinator.address,
      toAddress: spec.address,
      amount,
    });
    console.log(res.state === 'COMPLETE' ? '✓' : `✗ ${res.state}`);
  }
  console.log();
}

async function autoApprover(coordinator: WalletRecord, lock: Mutex) {
  const paid = new Set<string>();
  while (true) {
    try {
      const next = await getNextTaskId();
      for (let id = 1n; id < next; id++) {
        if (paid.has(id.toString())) continue;
        const t = await getTask(id);
        if (t.status !== TaskStatus.Completed) continue;
        console.log(`[coordinator] 💰 approveAndPay #${id} → ${t.assignee.slice(0, 10)}…`);
        const res = await lock.run(() =>
          execContract({
            walletId: coordinator.id,
            contractAddress: marketAddress,
            abiFunctionSignature: 'approveAndPay(uint256)',
            abiParameters: [id.toString()],
          }),
        );
        if (res.state === 'COMPLETE') {
          paid.add(id.toString());
          console.log(`[coordinator]    paid #${id} ${res.txHash}`);
        } else {
          console.log(`[coordinator]    ✗ #${id} ${res.state} ${res.errorReason ?? ''}`);
        }
      }
    } catch (e: any) {
      console.log(`[coordinator]    error ${e?.message ?? e}`);
    }
    await new Promise((r) => setTimeout(r, APPROVAL_POLL_MS));
  }
}

async function main() {
  const wallets = loadWallets();
  const coordinator = wallets.find((w) => w.role === 'coordinator')!;
  const specialists = wallets.filter((w) => w.role === 'specialist');

  await batchTopup(coordinator, specialists);

  const funderLock = new Mutex();
  const agents: SpecialistAgent[] = [];
  for (const [i, wallet] of specialists.entries()) {
    const caps = SPECIALIST_ASSIGNMENTS[i] ?? ['summarize'];
    const agent = new SpecialistAgent({
      wallet,
      capabilities: caps,
      funder: coordinator,
      funderLock,
      onEvent: log,
      startupDelayMs: i * 300, // stagger first-tick requests
    });
    agents.push(agent);
    console.log(`spawned ${agent.name.padEnd(26)} (${wallet.address})`);
  }
  console.log(`\n${agents.length} agents online. Polling market ${marketAddress}.\n`);

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    agents.forEach((a) => a.stop());
    console.log('\n--- Final stats ---');
    for (const a of agents) {
      console.log(`${a.stats.name.padEnd(26)} completed=${a.stats.completed}`);
    }
    process.exit(0);
  });

  autoApprover(coordinator, funderLock);
  await Promise.all(agents.map((a) => a.start()));
}

main().catch((err: any) => {
  console.error(err);
  process.exit(1);
});
