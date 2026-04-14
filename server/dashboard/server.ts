import 'dotenv/config';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNextTaskId, getTask, marketAddress, TaskStatus } from '../lib/market.js';
import { loadWallets, type WalletRecord } from '../lib/config.js';

/**
 * Lightweight dashboard server:
 *  - Polls the TaskMarket contract via ethers (no Circle API required for reads).
 *  - Maintains an in-memory projection of task + agent state.
 *  - Emits SSE events to any connected dashboard client.
 *  - Serves the static dashboard HTML from /dashboard.
 *
 * This is intentionally dependency-free (pure Node http) so `npm run dashboard`
 * starts with no extra install step.
 */

const PORT = Number(process.env.DASHBOARD_PORT ?? 8787);
const POLL_MS = Number(process.env.DASHBOARD_POLL_MS ?? 2000);
const TRAD_GAS_PER_TX_USDC = Number(process.env.TRAD_GAS_PER_TX_USDC ?? 0.05);
const DASHBOARD_DIR = fileURLToPath(new URL('../../dashboard/', import.meta.url));

type StoredTask = {
  id: string;
  taskType: string;
  poster: string;
  assignee: string;
  reward: number;
  status: number;
  resultCID: string;
  postedAt: number;
  assignedAt?: number;
  completedAt?: number;
  paidAt?: number;
};

type AgentInfo = {
  name: string;
  address: string;
  capability?: string;
  status: 'idle' | 'working';
  completed: number;
  earnedUsdc: number;
  currentTaskId?: string;
};

type FeedEntry = { t: number; kind: string; text: string; taskId?: string };

const wallets = loadWallets();
const coordinator: WalletRecord | undefined = wallets.find((w) => w.role === 'coordinator');
const agentsByAddr = new Map<string, AgentInfo>();

// Match the capability assignments used in scripts/run-agents.ts.
const CAP_ORDER = ['summarize', 'summarize', 'classify', 'classify', 'translate', 'translate', 'sentiment', 'extract'];
let specialistIdx = 0;
for (const w of wallets) {
  if (w.role !== 'specialist') continue;
  agentsByAddr.set(w.address.toLowerCase(), {
    name: w.name,
    address: w.address,
    capability: CAP_ORDER[specialistIdx],
    status: 'idle',
    completed: 0,
    earnedUsdc: 0,
  });
  specialistIdx++;
}

const tasks = new Map<string, StoredTask>();
const feed: FeedEntry[] = [];

type Client = { res: http.ServerResponse };
const clients = new Set<Client>();

function jsonReplacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v;
}

function pushFeed(kind: string, text: string, taskId?: string) {
  feed.push({ t: Date.now(), kind, text, taskId });
  if (feed.length > 300) feed.shift();
}

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data, jsonReplacer)}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(payload);
    } catch {
      // client disconnected; reaper on 'close' will remove it
    }
  }
}

function shortAddr(addr: string) {
  if (!addr || /^0x0+$/.test(addr)) return '-';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function computeStats() {
  const allTasks = Array.from(tasks.values());
  const posted = allTasks.length;
  const completed = allTasks.filter((t) => t.status >= TaskStatus.Completed && t.status !== TaskStatus.Cancelled).length;
  const paid = allTasks.filter((t) => t.status === TaskStatus.Paid).length;
  const totalSpent = allTasks
    .filter((t) => t.status === TaskStatus.Paid)
    .reduce((s, t) => s + t.reward, 0);
  const paidDurations = allTasks
    .filter((t) => t.paidAt && t.postedAt)
    .map((t) => (t.paidAt! - t.postedAt) / 1000);
  const avgCompletion = paidDurations.length
    ? paidDurations.reduce((a, b) => a + b, 0) / paidDurations.length
    : 0;
  const avgCost = paid ? totalSpent / paid : 0;
  const windowMs = 30_000;
  const now = Date.now();
  const recentPaid = allTasks.filter((t) => t.paidAt && now - t.paidAt < windowMs).length;
  const throughput = recentPaid / (windowMs / 1000);
  return {
    posted,
    completed,
    paid,
    totalSpentUsdc: totalSpent,
    avgCompletionSec: avgCompletion,
    avgCostUsdc: avgCost,
    throughputTasksPerSec: throughput,
    tradGasUsdc: posted * TRAD_GAS_PER_TX_USDC,
    arcGasUsdc: 0,
  };
}

function snapshot() {
  const allTasks = Array.from(tasks.values()).sort((a, b) => Number(b.id) - Number(a.id));
  return {
    market: marketAddress,
    coordinator: coordinator?.address ?? '',
    agents: Array.from(agentsByAddr.values()),
    tasks: allTasks.slice(0, 100),
    feed: feed.slice().reverse().slice(0, 100),
    stats: computeStats(),
  };
}

async function poll() {
  try {
    const next = await getNextTaskId();
    const highest = Number(next - 1n);
    for (let id = 1; id <= highest; id++) {
      const idStr = String(id);
      const prev = tasks.get(idStr);
      if (prev && (prev.status === TaskStatus.Paid || prev.status === TaskStatus.Cancelled)) continue;

      const t = await getTask(BigInt(id));
      const reward = Number(t.reward) / 1_000_000;
      const now = Date.now();

      if (!prev) {
        const stored: StoredTask = {
          id: idStr,
          taskType: t.taskType,
          poster: t.poster,
          assignee: t.assignee,
          reward,
          status: t.status,
          resultCID: t.resultCID,
          postedAt: now,
        };
        tasks.set(idStr, stored);
        pushFeed(
          'posted',
          `Task #${id} ${t.taskType} posted — reward ${reward.toFixed(3)} USDC`,
          idStr,
        );
        broadcast('task', { kind: 'posted', task: stored });

        // If we discovered a task that has already progressed past Open,
        // walk the state transitions so downstream consumers see full history.
        if (t.status >= TaskStatus.Assigned) applyTransition(stored, TaskStatus.Assigned, t.assignee, reward, now);
        if (t.status >= TaskStatus.Completed) applyTransition(stored, TaskStatus.Completed, t.assignee, reward, now);
        if (t.status === TaskStatus.Paid) applyTransition(stored, TaskStatus.Paid, t.assignee, reward, now);
        if (t.status === TaskStatus.Cancelled) applyTransition(stored, TaskStatus.Cancelled, t.assignee, reward, now);
        stored.status = t.status;
        stored.resultCID = t.resultCID;
        stored.assignee = t.assignee;
        continue;
      }

      if (t.status !== prev.status) {
        prev.assignee = t.assignee;
        prev.resultCID = t.resultCID;
        // Walk any skipped transitions so the UI stays consistent.
        if (prev.status < TaskStatus.Assigned && t.status >= TaskStatus.Assigned)
          applyTransition(prev, TaskStatus.Assigned, t.assignee, reward, now);
        if (prev.status < TaskStatus.Completed && t.status >= TaskStatus.Completed && t.status !== TaskStatus.Cancelled)
          applyTransition(prev, TaskStatus.Completed, t.assignee, reward, now);
        if (prev.status < TaskStatus.Paid && t.status === TaskStatus.Paid)
          applyTransition(prev, TaskStatus.Paid, t.assignee, reward, now);
        if (t.status === TaskStatus.Cancelled && prev.status !== TaskStatus.Cancelled)
          applyTransition(prev, TaskStatus.Cancelled, t.assignee, reward, now);
        prev.status = t.status;
      }
    }
    broadcast('stats', computeStats());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[poll] ${msg}`);
  }
}

function applyTransition(
  task: StoredTask,
  to: TaskStatus,
  assignee: string,
  reward: number,
  now: number,
) {
  if (to === TaskStatus.Assigned) {
    task.assignedAt = now;
    const ag = agentsByAddr.get(assignee.toLowerCase());
    if (ag) {
      ag.status = 'working';
      ag.currentTaskId = task.id;
      broadcast('agent', ag);
    }
    pushFeed('assigned', `Task #${task.id} → ${ag?.name ?? shortAddr(assignee)}`, task.id);
    broadcast('task', { kind: 'assigned', task, agent: ag?.name });
  } else if (to === TaskStatus.Completed) {
    task.completedAt = now;
    pushFeed('completed', `Task #${task.id} result submitted`, task.id);
    broadcast('task', { kind: 'completed', task });
  } else if (to === TaskStatus.Paid) {
    task.paidAt = now;
    const ag = agentsByAddr.get(assignee.toLowerCase());
    if (ag) {
      ag.completed++;
      ag.earnedUsdc += reward;
      ag.status = 'idle';
      ag.currentTaskId = undefined;
      broadcast('agent', ag);
    }
    pushFeed(
      'paid',
      `${reward.toFixed(3)} USDC → ${ag?.name ?? shortAddr(assignee)} (#${task.id})`,
      task.id,
    );
    broadcast('task', { kind: 'paid', task, agent: ag?.name });
  } else if (to === TaskStatus.Cancelled) {
    pushFeed('cancelled', `Task #${task.id} cancelled`, task.id);
    broadcast('task', { kind: 'cancelled', task });
  }
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
  const fileName = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const safe = fileName.replace(/\.\.+/g, '.'); // no traversal
  const full = join(DASHBOARD_DIR, safe);
  if (!full.startsWith(DASHBOARD_DIR) || !existsSync(full)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = extname(full).toLowerCase();
  const type =
    ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : ext === '.json' ? 'application/json; charset=utf-8'
    : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(readFileSync(full));
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';

  if (url === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write(`retry: 2000\n\n`);
    res.write(`event: init\ndata: ${JSON.stringify(snapshot(), jsonReplacer)}\n\n`);
    const client: Client = { res };
    clients.add(client);
    const keepalive = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* ignored */
      }
    }, 15_000);
    req.on('close', () => {
      clearInterval(keepalive);
      clients.delete(client);
    });
    return;
  }

  if (url === '/snapshot') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(snapshot(), jsonReplacer));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`=== Dashboard server ===`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  polling ${marketAddress} every ${POLL_MS}ms`);
  console.log(`  coordinator: ${coordinator?.address ?? '(none)'}`);
  console.log(`  specialists: ${agentsByAddr.size}`);
  console.log('');
});

void poll();
setInterval(() => void poll(), POLL_MS);
