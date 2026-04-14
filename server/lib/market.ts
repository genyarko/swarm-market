import { ethers } from 'ethers';
import { env, loadDeployment } from './config.js';

const TASK_MARKET_ABI = [
  'function nextTaskId() view returns (uint256)',
  'function coordinator() view returns (address)',
  'function assignmentTimeout() view returns (uint64)',
  'function isSpecialist(address) view returns (bool)',
  'function getTask(uint256 id) view returns (tuple(uint256 id, address poster, address assignee, string taskType, string inputCID, string resultCID, uint256 reward, uint8 status, uint64 assignedAt))',
  'function setSpecialist(address who, bool allowed)',
  'function reclaimExpiredAssignment(uint256 id)',
  'event TaskPosted(uint256 indexed id, address indexed poster, string taskType, string inputCID, uint256 reward)',
  'event TaskAssigned(uint256 indexed id, address indexed assignee)',
  'event TaskCompleted(uint256 indexed id, string resultCID)',
  'event TaskPaid(uint256 indexed id, address indexed assignee, uint256 reward)',
  'event TaskReclaimed(uint256 indexed id, address indexed expiredAssignee)',
  'event SpecialistAuthorized(address indexed who, bool allowed)',
];

export enum TaskStatus {
  Open = 0,
  Assigned = 1,
  Completed = 2,
  Paid = 3,
  Cancelled = 4,
}

export type ChainTask = {
  id: bigint;
  poster: string;
  assignee: string;
  taskType: string;
  inputCID: string;
  resultCID: string;
  reward: bigint;
  status: TaskStatus;
  assignedAt: bigint;
};

const provider = new ethers.JsonRpcProvider(env.arcRpcUrl);
const deployment = loadDeployment();
const market = new ethers.Contract(deployment.address, TASK_MARKET_ABI, provider);

export const marketAddress = deployment.address;

export async function getNextTaskId(): Promise<bigint> {
  return (await market.nextTaskId!()) as bigint;
}

export async function getTask(id: bigint | number): Promise<ChainTask> {
  const t = await market.getTask!(id);
  return {
    id: t[0],
    poster: t[1],
    assignee: t[2],
    taskType: t[3],
    inputCID: t[4],
    resultCID: t[5],
    reward: t[6],
    status: Number(t[7]) as TaskStatus,
    assignedAt: t[8],
  };
}

export async function getAssignmentTimeout(): Promise<bigint> {
  return (await market.assignmentTimeout!()) as bigint;
}

export async function isSpecialistOnChain(address: string): Promise<boolean> {
  return (await market.isSpecialist!(address)) as boolean;
}
