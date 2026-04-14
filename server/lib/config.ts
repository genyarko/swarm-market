import 'dotenv/config';
import { readFileSync } from 'node:fs';

export type WalletRecord = {
  role: 'coordinator' | 'specialist' | 'treasury';
  name: string;
  id: string;
  address: string;
  blockchain: string;
};

export type Deployment = {
  contractName: string;
  address: string;
  blockchain: string;
  usdc: string;
  deployer: string;
  txHash: string;
};

export const env = {
  circleApiKey: required('CIRCLE_API_KEY'),
  circleEntitySecret: required('CIRCLE_ENTITY_SECRET'),
  blockchain: process.env.CIRCLE_BLOCKCHAIN ?? 'ARC-TESTNET',
  arcRpcUrl: process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  mistralApiKey: process.env.MISTRAL_API_KEY ?? '',
  mistralModel: process.env.MISTRAL_MODEL ?? 'mistral-small-latest',
  agentPollMs: Number(process.env.AGENT_POLL_MS ?? 1500),
  agentGasFloorUsdc: Number(process.env.AGENT_GAS_FLOOR_USDC ?? 0.1),
};

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function loadWallets(): WalletRecord[] {
  if (process.env.WALLETS_JSON) return JSON.parse(process.env.WALLETS_JSON);
  return JSON.parse(readFileSync(new URL('../../wallets.json', import.meta.url), 'utf8'));
}

export function loadDeployment(): Deployment {
  if (process.env.DEPLOYMENT_JSON) return JSON.parse(process.env.DEPLOYMENT_JSON);
  return JSON.parse(readFileSync(new URL('../../deployments.json', import.meta.url), 'utf8'));
}
