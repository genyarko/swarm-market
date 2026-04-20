import { env, type WalletRecord } from '../lib/config.js';
import { execContract, getUsdcBalance, transferUsdc } from '../lib/circle.js';
import { getNextTaskId, getTask, marketAddress, TaskStatus } from '../lib/market.js';
import { PROMPTS, type Capability } from './prompts.js';
import { complete } from '../lib/llm.js';
import { Mutex } from '../lib/mutex.js';

export type AgentOptions = {
  wallet: WalletRecord;
  capabilities: Capability[];
  funder?: WalletRecord;
  funderLock?: Mutex; // shared across agents to serialize coordinator txs
  onEvent?: (ev: AgentEvent) => void;
  startupDelayMs?: number;
};

export type AgentEvent =
  | { type: 'idle'; agent: string }
  | { type: 'saw'; agent: string; taskId: bigint; taskType: string }
  | { type: 'bid'; agent: string; taskId: bigint; won: boolean; txHash?: string }
  | { type: 'result'; agent: string; taskId: bigint; result: string; txHash?: string }
  | { type: 'error'; agent: string; taskId?: bigint; message: string }
  | { type: 'topup'; agent: string; amount: string };

const STARTUP_LOOKBACK_TASKS = Number(process.env.AGENT_STARTUP_LOOKBACK_TASKS ?? 25);

export class SpecialistAgent {
  readonly name: string;
  readonly wallet: WalletRecord;
  readonly capabilities: Set<Capability>;
  private funder?: WalletRecord;
  private funderLock?: Mutex;
  private onEvent: (ev: AgentEvent) => void;
  private startupDelayMs: number;
  private lastSeenId = 0n;
  private running = false;
  private completed = 0;

  constructor(opts: AgentOptions) {
    this.wallet = opts.wallet;
    this.name = `${[...opts.capabilities].join('+')}-${opts.wallet.name}`;
    this.capabilities = new Set(opts.capabilities);
    this.funder = opts.funder;
    this.funderLock = opts.funderLock;
    this.onEvent = opts.onEvent ?? (() => {});
    this.startupDelayMs = opts.startupDelayMs ?? 0;
  }

  get stats() {
    return { name: this.name, address: this.wallet.address, completed: this.completed };
  }

  async start(): Promise<void> {
    await sleep(this.startupDelayMs);
    this.running = true;
    let backoff = 0;
    while (this.running) {
      try {
        await this.tick();
        backoff = 0;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        this.onEvent({ type: 'error', agent: this.name, message: msg });
        backoff = Math.min(20000, backoff ? backoff * 2 : 2000);
      }
      await sleep(env.agentPollMs + Math.floor(Math.random() * 500) + backoff);
    }
  }

  stop() {
    this.running = false;
  }

  private async tick(): Promise<void> {
    await this.ensureGas();

    const next = await getNextTaskId();
    const highest = next - 1n;
    if (highest < 1n) {
      this.onEvent({ type: 'idle', agent: this.name });
      return;
    }
    const startId =
      this.lastSeenId > 0n
        ? this.lastSeenId + 1n
        : highest > BigInt(STARTUP_LOOKBACK_TASKS)
          ? highest - BigInt(STARTUP_LOOKBACK_TASKS) + 1n
          : 1n;

    for (let id = startId; id <= highest; id++) {
      const task = await getTask(id);
      this.lastSeenId = id;

      if (task.status !== TaskStatus.Open) continue;
      if (!this.capabilities.has(task.taskType as Capability)) continue;

      this.onEvent({ type: 'saw', agent: this.name, taskId: id, taskType: task.taskType });
      const won = await this.tryClaim(id);
      if (!won) continue;

      await this.executeAndSubmit(id, task.taskType as Capability, task.inputCID);
      return; // one task per tick
    }
  }

  private async tryClaim(id: bigint): Promise<boolean> {
    const res = await execContract({
      walletId: this.wallet.id,
      contractAddress: marketAddress,
      abiFunctionSignature: 'bidOnTask(uint256)',
      abiParameters: [id.toString()],
    });
    const won = res.state === 'COMPLETE';
    this.onEvent({ type: 'bid', agent: this.name, taskId: id, won, txHash: res.txHash });
    return won;
  }

  private async executeAndSubmit(id: bigint, cap: Capability, input: string): Promise<void> {
    let result: string;
    try {
      const prompt = PROMPTS[cap](input);
      result = await complete(prompt);
      if (!result) result = '[empty]';
    } catch (e: any) {
      this.onEvent({
        type: 'error',
        agent: this.name,
        taskId: id,
        message: `llm failed: ${e?.message ?? e}`,
      });
      return;
    }

    const trimmed = result.length > 900 ? result.slice(0, 900) + '…' : result;
    const res = await execContract({
      walletId: this.wallet.id,
      contractAddress: marketAddress,
      abiFunctionSignature: 'submitResult(uint256,string)',
      abiParameters: [id.toString(), trimmed],
    });
    if (res.state !== 'COMPLETE') {
      this.onEvent({
        type: 'error',
        agent: this.name,
        taskId: id,
        message: `submitResult ${res.state} ${res.errorReason ?? ''}`,
      });
      return;
    }
    this.completed++;
    this.onEvent({ type: 'result', agent: this.name, taskId: id, result: trimmed, txHash: res.txHash });
  }

  private async ensureGas(): Promise<void> {
    if (!this.funder || !this.funderLock) return;
    const bal = await getUsdcBalance(this.wallet.id);
    if (bal >= env.agentGasFloorUsdc) return;

    await this.funderLock.run(async () => {
      // Re-check once we own the lock (another agent may have just topped us up indirectly).
      const latest = await getUsdcBalance(this.wallet.id);
      if (latest >= env.agentGasFloorUsdc) return;
      const topup = (env.agentGasFloorUsdc * 2).toFixed(3);
      this.onEvent({ type: 'topup', agent: this.name, amount: topup });
      await transferUsdc({
        fromWalletId: this.funder!.id,
        fromAddress: this.funder!.address,
        toAddress: this.wallet.address,
        amount: topup,
      });
    });
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
