import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { chainByCircle, type ChainConfig } from './chains.js';

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

const circleBlockchain = (process.env.CIRCLE_BLOCKCHAIN ?? 'ARC-TESTNET').toUpperCase();
const chain = chainByCircle(circleBlockchain);
if (!chain) {
  throw new Error(
    `Unsupported CIRCLE_BLOCKCHAIN=${circleBlockchain}. Supported: see server/lib/chains.ts`,
  );
}

export const env = {
  circleApiKey: required('CIRCLE_API_KEY'),
  circleEntitySecret: required('CIRCLE_ENTITY_SECRET'),
  blockchain: chain.circle,
  chain,
  arcRpcUrl: process.env.ARC_RPC_URL ?? chain.rpcUrl,
  usdcAddress: process.env.USDC_ADDRESS ?? chain.usdcAddress,
  llmProvider: (process.env.LLM_PROVIDER ?? 'mistral').toLowerCase() as 'claude' | 'mistral',
  mistralModel: process.env.MISTRAL_MODEL ?? 'mistral-small-latest',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
  agentPollMs: Number(process.env.AGENT_POLL_MS ?? 1500),
  agentGasFloorUsdc: Number(process.env.AGENT_GAS_FLOOR_USDC ?? 0.1),
  x402FacilitatorUrl: process.env.X402_FACILITATOR_URL ?? '',
  x402PremiumPriceUsdc: Number(process.env.X402_PREMIUM_PRICE_USDC ?? 0.001),
};

export const chainConfig: ChainConfig = chain;

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
