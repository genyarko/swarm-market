import 'dotenv/config';
import { ethers } from 'ethers';
import { env, loadDeployment } from '../server/lib/config.js';
import { loadRegistry } from '../server/lib/registry.js';

const provider = new ethers.JsonRpcProvider(env.arcRpcUrl);
const d = loadDeployment();
const r = loadRegistry();
const abi = [
  'function usdc() view returns (address)',
  'function coordinator() view returns (address)',
  'function assignmentTimeout() view returns (uint64)',
  'function nextTaskId() view returns (uint256)',
  'function agentRegistry() view returns (address)',
];
const m = new ethers.Contract(d.address, abi, provider);
const [usdc, coord, to, next, reg] = await Promise.all([
  m.usdc(),
  m.coordinator(),
  m.assignmentTimeout(),
  m.nextTaskId(),
  m.agentRegistry(),
]);
console.log('TaskMarket       :', d.address);
console.log('  usdc           :', usdc);
console.log('  coordinator    :', coord);
console.log('  assignmentTO   :', to.toString(), 's');
console.log('  nextTaskId     :', next.toString());
console.log('  agentRegistry  :', reg);
console.log('expected registry:', r?.address);
console.log('match            :', reg.toLowerCase() === r?.address.toLowerCase() ? '✓' : '✗');
