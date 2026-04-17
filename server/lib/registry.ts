import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';
import { env } from './config.js';

/**
 * Thin read/write helper around the ERC-8004 AgentRegistry contract.
 * Address is read from `registry.json` at repo root, or from
 * `AGENT_REGISTRY_ADDRESS` in env.
 */

const AGENT_REGISTRY_ABI = [
  'function nextAgentId() view returns (uint256)',
  'function agentIdOf(address) view returns (uint256)',
  'function getAgent(uint256 id) view returns (tuple(uint256 id, address owner, string domain, string metadataURI, uint64 registeredAt, bool active))',
  'function getAgentByAddress(address owner) view returns (tuple(uint256 id, address owner, string domain, string metadataURI, uint64 registeredAt, bool active))',
  'function averageScore(uint256 agentId) view returns (uint256)',
  'function feedbackCount(uint256 agentId) view returns (uint256)',
  'function scoreSum(uint256 agentId) view returns (uint256)',
  'function registerAgent(string domain, string metadataURI) returns (uint256)',
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 interactionId, string uri)',
  'function requestValidation(uint256 agentId, bytes32 dataHash, string uri) returns (uint256)',
  'function resolveValidation(uint256 validationId, bool approved, string verdictURI)',
  'event AgentRegistered(uint256 indexed agentId, address indexed owner, string domain, string metadataURI)',
  'event FeedbackGiven(uint256 indexed agentId, address indexed rater, uint8 score, bytes32 indexed interactionId, string uri)',
  'event ValidationRequested(uint256 indexed validationId, uint256 indexed agentId, address indexed requester, bytes32 dataHash, string uri)',
  'event ValidationResolved(uint256 indexed validationId, address indexed validator, uint8 state, string verdictURI)',
];

export type RegistryDeployment = {
  contractName: string;
  address: string;
  blockchain: string;
  deployer: string;
  txHash: string;
};

export function loadRegistry(): RegistryDeployment | null {
  if (process.env.REGISTRY_JSON) return JSON.parse(process.env.REGISTRY_JSON);
  if (process.env.AGENT_REGISTRY_ADDRESS) {
    return {
      contractName: 'AgentRegistry',
      address: process.env.AGENT_REGISTRY_ADDRESS,
      blockchain: env.blockchain,
      deployer: '',
      txHash: '',
    };
  }
  const url = new URL('../../registry.json', import.meta.url);
  if (!existsSync(url)) return null;
  return JSON.parse(readFileSync(url, 'utf8'));
}

export function registryContract(providerOrSigner: ethers.ContractRunner): ethers.Contract | null {
  const d = loadRegistry();
  if (!d) return null;
  return new ethers.Contract(d.address, AGENT_REGISTRY_ABI, providerOrSigner);
}

export const AGENT_REGISTRY_ABI_JSON = AGENT_REGISTRY_ABI;
