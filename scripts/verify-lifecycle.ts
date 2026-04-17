import 'dotenv/config';
import { ethers } from 'ethers';
import { env, loadDeployment, loadWallets } from '../server/lib/config.js';
import { loadRegistry } from '../server/lib/registry.js';

const provider = new ethers.JsonRpcProvider(env.arcRpcUrl);
const market = loadDeployment().address as string;
const registry = loadRegistry()!.address;
const specialist1 = loadWallets().find((w) => w.role === 'specialist' && w.name === 'specialist-1')!;

const m = new ethers.Contract(
  market,
  [
    'function nextTaskId() view returns (uint256)',
    'function getTask(uint256) view returns (tuple(uint256 id, address poster, address assignee, string taskType, string inputCID, string resultCID, uint256 reward, uint8 status, uint64 assignedAt))',
  ],
  provider,
);
const r = new ethers.Contract(
  registry,
  [
    'function agentIdOf(address) view returns (uint256)',
    'function feedbackCount(uint256) view returns (uint256)',
    'function scoreSum(uint256) view returns (uint256)',
    'function averageScore(uint256) view returns (uint256)',
  ],
  provider,
);

const next = await m.nextTaskId();
console.log(`TaskMarket @ ${market}`);
console.log(`  nextTaskId: ${next}`);
const STATUS = ['Open', 'Assigned', 'Completed', 'Paid', 'Cancelled'];
for (let id = 1n; id < next; id++) {
  const t = await m.getTask(id);
  console.log(
    `  task #${t[0]}  status=${STATUS[Number(t[7])]}  type=${t[3]}  reward=${t[6]}  assignee=${t[2]}`,
  );
}

const agentId = await r.agentIdOf(specialist1.address);
const fb = await r.feedbackCount(agentId);
const sum = await r.scoreSum(agentId);
const avg = await r.averageScore(agentId);
console.log(`\nAgentRegistry @ ${registry}`);
console.log(`  specialist-1 agentId=${agentId}  feedbackCount=${fb}  scoreSum=${sum}  avgScore=${avg}`);
