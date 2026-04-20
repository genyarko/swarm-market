import 'dotenv/config';
import { env, loadWallets, type WalletRecord } from '../server/lib/config.js';
import { SpecialistAgent, type AgentEvent } from '../server/agents/agent.js';
import { SPECIALIST_ASSIGNMENTS } from '../server/agents/assignments.js';
import { execContract, getUsdcBalance, transferUsdc } from '../server/lib/circle.js';
import {
  getAssignmentTimeout,
  getNextTaskId,
  getTask,
  marketAddress,
  TaskStatus,
} from '../server/lib/market.js';
import { Mutex } from '../server/lib/mutex.js';
import { gradeResult } from '../server/agents/grader.js';

const APPROVAL_POLL_MS = 4000;
const AUTO_APPROVER_INCLUDE_HISTORY = (process.env.AUTO_APPROVER_INCLUDE_HISTORY ?? '').toLowerCase() === 'true';

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

async function authorizeSpecialists(coordinator: WalletRecord, specialists: WalletRecord[], lock: Mutex) {
  console.log('Authorizing specialists on-chain (one-time per wallet)...');
  for (const spec of specialists) {
    const res = await lock.run(() =>
      execContract({
        walletId: coordinator.id,
        contractAddress: marketAddress,
        abiFunctionSignature: 'setSpecialist(address,bool)',
        abiParameters: [spec.address, true],
      }),
    );
    console.log(
      `  ${spec.name.padEnd(14)} ${spec.address}  ${res.state === 'COMPLETE' ? '✓' : `✗ ${res.state}`}`,
    );
  }
  console.log();
}

async function autoApprover(coordinator: WalletRecord, lock: Mutex) {
  const paid = new Set<string>();
  const rejected = new Set<string>();
  const reclaimed = new Set<string>();
  const assignmentTimeoutSec = Number(await getAssignmentTimeout());
  const baselineNext = await getNextTaskId();
  const minTaskId = AUTO_APPROVER_INCLUDE_HISTORY ? 1n : baselineNext;
  const mode = AUTO_APPROVER_INCLUDE_HISTORY ? 'including history' : `new tasks only (id >= ${minTaskId})`;
  console.log(`[coordinator] grader + reclaim active (timeout ${assignmentTimeoutSec}s, ${mode})`);

  while (true) {
    try {
      const next = await getNextTaskId();
      const nowSec = Math.floor(Date.now() / 1000);

      for (let id = minTaskId; id < next; id++) {
        const idStr = id.toString();
        if (paid.has(idStr) || rejected.has(idStr) || reclaimed.has(idStr)) continue;
        const t = await getTask(id);

        // Stalled assignee — reclaim the escrow.
        if (t.status === TaskStatus.Assigned) {
          const assignedAt = Number(t.assignedAt);
          if (assignedAt > 0 && nowSec - assignedAt > assignmentTimeoutSec) {
            console.log(`[coordinator] ⏱  reclaim #${id} (stalled ${nowSec - assignedAt}s)`);
            const rec = await lock.run(() =>
              execContract({
                walletId: coordinator.id,
                contractAddress: marketAddress,
                abiFunctionSignature: 'reclaimExpiredAssignment(uint256)',
                abiParameters: [idStr],
              }),
            );
            if (rec.state === 'COMPLETE') {
              reclaimed.add(idStr);
              console.log(`[coordinator]    reclaimed #${id} ${rec.txHash}`);
            } else {
              console.log(`[coordinator]    ✗ reclaim #${id} ${rec.state} ${rec.errorReason ?? ''}`);
            }
          }
          continue;
        }

        if (t.status !== TaskStatus.Completed) continue;

        // Grade the result before paying.
        let verdict;
        try {
          verdict = await gradeResult(t.taskType, t.inputCID, t.resultCID);
        } catch (e: any) {
          console.log(`[coordinator] ⚠ grader error on #${id}: ${e?.message ?? e} — skipping`);
          continue;
        }

        if (!verdict.pass) {
          rejected.add(idStr);
          console.log(
            `[coordinator] ✗ reject #${id} score=${verdict.score}/10 — ${verdict.reason}`,
          );
          // Escrow stays until reclaim timeout elapses, then refunded to poster.
          continue;
        }

        console.log(
          `[coordinator] 💰 approveAndPay #${id} → ${t.assignee.slice(0, 10)}… (score=${verdict.score})`,
        );
        const res = await lock.run(() =>
          execContract({
            walletId: coordinator.id,
            contractAddress: marketAddress,
            abiFunctionSignature: 'approveAndPay(uint256)',
            abiParameters: [idStr],
          }),
        );
        if (res.state === 'COMPLETE') {
          paid.add(idStr);
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

  const funderLock = new Mutex();
  await batchTopup(coordinator, specialists);
  await authorizeSpecialists(coordinator, specialists, funderLock);

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
