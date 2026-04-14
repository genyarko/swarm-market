import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execContract } from '../lib/circle.js';
import { env, loadDeployment, type WalletRecord } from '../lib/config.js';
import { getNextTaskId, getTask, TaskStatus } from '../lib/market.js';
import type { Capability } from './prompts.js';

export type SeedItem = {
  id: string;
  lang?: string;
  source?: string;
  text: string;
};

export type PlannedTask = {
  itemId: string;
  taskType: Capability;
  input: string;
  rewardUsdc: number;
};

export type PostedTask = PlannedTask & { onChainId: bigint; postedAt: number };

export type CoordinatorEvent =
  | { type: 'plan'; totalItems: number; totalTasks: number; totalBudgetUsdc: number }
  | { type: 'approve'; allowanceUnits: string; txHash?: string; state: string }
  | { type: 'posted'; task: PostedTask; index: number; total: number }
  | { type: 'post-failed'; plan: PlannedTask; state: string; reason?: string }
  | { type: 'paid'; onChainId: bigint; assignee: string; rewardUsdc: number; result: string }
  | { type: 'cancelled'; onChainId: bigint }
  | { type: 'done'; paid: number; unresolved: number; totalSpentUsdc: number };

export const REWARDS: Record<Capability, number> = {
  summarize: 0.003,
  classify: 0.002,
  translate: 0.004,
  sentiment: 0.002,
  extract: 0.003,
};

export function planTasksForItem(item: SeedItem): PlannedTask[] {
  const lang = (item.lang ?? 'en').toLowerCase();
  const len = item.text.length;
  const plan: Capability[] = [];

  if (lang !== 'en') {
    plan.push('translate', 'summarize');
  } else if (len >= 400) {
    plan.push('summarize', 'extract', 'sentiment');
  } else if (len >= 150) {
    plan.push('classify', 'sentiment');
  } else {
    plan.push('classify', 'sentiment');
  }

  return plan.map((taskType) => ({
    itemId: item.id,
    taskType,
    input: item.text,
    rewardUsdc: REWARDS[taskType],
  }));
}

export function buildPlan(items: SeedItem[]): PlannedTask[] {
  return items.flatMap(planTasksForItem);
}

function usdcToUnits(usdc: number): string {
  return Math.round(usdc * 1_000_000).toString();
}

export type CoordinatorOptions = {
  coordinator: WalletRecord;
  items: SeedItem[];
  paceMs?: number;
  batchSize?: number;
  itemLimit?: number;
  budgetUsdc?: number;
  completionTimeoutMs?: number;
  outputPath?: string;
  onEvent?: (ev: CoordinatorEvent) => void;
};

export class CoordinatorAgent {
  private readonly coordinator: WalletRecord;
  private readonly items: SeedItem[];
  private readonly paceMs: number;
  private readonly batchSize: number;
  private readonly itemLimit: number;
  private readonly budgetUsdc: number;
  private readonly completionTimeoutMs: number;
  private readonly outputPath?: string;
  private readonly onEvent: (ev: CoordinatorEvent) => void;
  private readonly deployment = loadDeployment();
  private readonly posted: PostedTask[] = [];
  private readonly aggregated = new Map<string, Record<string, { result: string; assignee: string }>>();
  private spentUsdc = 0;
  private paidCount = 0;

  constructor(opts: CoordinatorOptions) {
    this.coordinator = opts.coordinator;
    this.items = opts.items;
    this.paceMs = opts.paceMs ?? 2500;
    this.batchSize = opts.batchSize ?? 10;
    this.itemLimit = opts.itemLimit ?? opts.items.length;
    this.budgetUsdc = opts.budgetUsdc ?? Infinity;
    this.completionTimeoutMs = opts.completionTimeoutMs ?? 5 * 60_000;
    this.outputPath = opts.outputPath;
    this.onEvent = opts.onEvent ?? (() => {});
  }

  async run(): Promise<void> {
    const scoped = this.items.slice(0, this.itemLimit);
    const full = buildPlan(scoped);
    const plan = this.clampToBudget(full);

    const totalBudget = plan.reduce((s, p) => s + p.rewardUsdc, 0);
    this.onEvent({
      type: 'plan',
      totalItems: scoped.length,
      totalTasks: plan.length,
      totalBudgetUsdc: totalBudget,
    });

    if (plan.length === 0) return;

    await this.approveAllowance(totalBudget);
    await this.postAll(plan);
    await this.awaitCompletion();
    this.writeOutput();
    this.onEvent({
      type: 'done',
      paid: this.paidCount,
      unresolved: this.posted.length - this.paidCount,
      totalSpentUsdc: this.spentUsdc,
    });
  }

  private clampToBudget(plan: PlannedTask[]): PlannedTask[] {
    if (!isFinite(this.budgetUsdc)) return plan;
    const out: PlannedTask[] = [];
    let running = 0;
    for (const p of plan) {
      if (running + p.rewardUsdc > this.budgetUsdc) break;
      out.push(p);
      running += p.rewardUsdc;
    }
    return out;
  }

  private async approveAllowance(totalUsdc: number): Promise<void> {
    const units = usdcToUnits(totalUsdc * 2 + 0.1);
    const res = await execContract({
      walletId: this.coordinator.id,
      contractAddress: env.usdcAddress,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [this.deployment.address, units],
    });
    this.onEvent({ type: 'approve', allowanceUnits: units, txHash: res.txHash, state: res.state });
    if (res.state !== 'COMPLETE') {
      throw new Error(`approve failed: ${res.state} ${res.errorReason ?? ''}`);
    }
  }

  private async postAll(plan: PlannedTask[]): Promise<void> {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i]!;
      const res = await execContract({
        walletId: this.coordinator.id,
        contractAddress: this.deployment.address,
        abiFunctionSignature: 'postTask(string,string,uint256)',
        abiParameters: [p.taskType, p.input, usdcToUnits(p.rewardUsdc)],
      });
      if (res.state !== 'COMPLETE') {
        this.onEvent({ type: 'post-failed', plan: p, state: res.state, reason: res.errorReason });
        continue;
      }
      const onChainId = await this.latestTaskIdForPoster();
      const posted: PostedTask = { ...p, onChainId, postedAt: Date.now() };
      this.posted.push(posted);
      this.spentUsdc += p.rewardUsdc;
      this.onEvent({ type: 'posted', task: posted, index: i + 1, total: plan.length });

      // Pace control: pause between tasks; longer pause at batch boundary.
      const atBatchEnd = (i + 1) % this.batchSize === 0;
      const delay = atBatchEnd ? this.paceMs * 2 : this.paceMs;
      if (i + 1 < plan.length) await sleep(delay);
    }
  }

  private async latestTaskIdForPoster(): Promise<bigint> {
    // nextTaskId() - 1 is the most recently minted id. Coordinator is the only poster in-demo,
    // so this is safe. If other posters existed we'd need to read the TaskPosted event.
    const next = await getNextTaskId();
    return next - 1n;
  }

  private async awaitCompletion(): Promise<void> {
    const deadline = Date.now() + this.completionTimeoutMs;
    const settled = new Set<string>();

    while (Date.now() < deadline) {
      let remaining = 0;
      for (const p of this.posted) {
        const key = p.onChainId.toString();
        if (settled.has(key)) continue;
        const t = await getTask(p.onChainId);
        if (t.status === TaskStatus.Paid) {
          settled.add(key);
          this.paidCount++;
          this.aggregated.set(p.itemId, {
            ...(this.aggregated.get(p.itemId) ?? {}),
            [p.taskType]: { result: t.resultCID, assignee: t.assignee },
          });
          this.onEvent({
            type: 'paid',
            onChainId: p.onChainId,
            assignee: t.assignee,
            rewardUsdc: p.rewardUsdc,
            result: t.resultCID,
          });
        } else if (t.status === TaskStatus.Cancelled) {
          settled.add(key);
          this.onEvent({ type: 'cancelled', onChainId: p.onChainId });
        } else {
          remaining++;
        }
      }
      if (remaining === 0) return;
      await sleep(3000);
    }
  }

  private writeOutput(): void {
    if (!this.outputPath) return;
    mkdirSync(dirname(this.outputPath), { recursive: true });
    const processed = this.items
      .filter((item) => this.aggregated.has(item.id))
      .map((item) => ({
        id: item.id,
        lang: item.lang ?? 'en',
        source: item.source,
        text: item.text,
        results: this.aggregated.get(item.id) ?? {},
      }));
    writeFileSync(
      this.outputPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          coordinator: this.coordinator.address,
          market: this.deployment.address,
          totalItems: processed.length,
          totalTasks: this.posted.length,
          totalSpentUsdc: this.spentUsdc,
          processed,
        },
        null,
        2,
      ),
    );
  }
}

export function loadSeedDataset(path: string): SeedItem[] {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Expected JSON array in ${path}`);
  return parsed as SeedItem[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
