import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

type WalletRecord = { role: string; name: string; id: string; address: string; blockchain: string };

const {
  CIRCLE_API_KEY,
  CIRCLE_ENTITY_SECRET,
  CIRCLE_BLOCKCHAIN = 'ARC-TESTNET',
} = process.env;

if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
  console.error('Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env');
  process.exit(1);
}

const ARTIFACT_PATH = new URL(
  '../contracts/artifacts/contracts/AgentRegistry.sol/AgentRegistry.json',
  import.meta.url,
);
const REGISTRY_PATH = new URL('../registry.json', import.meta.url);

function loadArtifact() {
  if (!existsSync(ARTIFACT_PATH)) {
    console.error('Artifact not found. Run: npm run compile-contracts');
    process.exit(1);
  }
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8'));
  return { abi: artifact.abi, bytecode: artifact.bytecode as string };
}

function loadCoordinator(): WalletRecord {
  const wallets: WalletRecord[] = JSON.parse(
    readFileSync(new URL('../wallets.json', import.meta.url), 'utf8'),
  );
  const c = wallets.find((w) => w.role === 'coordinator');
  if (!c) throw new Error('coordinator not found in wallets.json');
  return c;
}

async function waitForContractAddress(
  wallets: ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  txId: string,
): Promise<{ contractAddress: string; txHash: string }> {
  const terminal = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);
  while (true) {
    const res = await wallets.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    console.log(`  state: ${state}`);
    if (terminal.has(state)) {
      if (state !== 'COMPLETE') throw new Error(`Deployment ended in state ${state}`);
      const contractAddress = (tx as any)?.contractAddress ?? (tx as any)?.destinationAddress;
      if (!contractAddress) throw new Error('No contract address in transaction');
      return { contractAddress, txHash: tx?.txHash ?? '' };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  const coordinator = loadCoordinator();
  const { abi, bytecode } = loadArtifact();

  console.log(`Deploying AgentRegistry (ERC-8004) on ${CIRCLE_BLOCKCHAIN}`);
  console.log(`  from coordinator ${coordinator.address} (walletId ${coordinator.id})\n`);

  const scp = initiateSmartContractPlatformClient({
    apiKey: CIRCLE_API_KEY!,
    entitySecret: CIRCLE_ENTITY_SECRET!,
  });
  const wallets = initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY!,
    entitySecret: CIRCLE_ENTITY_SECRET!,
  });

  const res = await scp.deployContract({
    name: 'AgentRegistry',
    description: 'ERC8004AgentTrustRegistry',
    blockchain: CIRCLE_BLOCKCHAIN as any,
    walletId: coordinator.id,
    abiJson: JSON.stringify(abi),
    bytecode,
    constructorParameters: [],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const txId = (res.data as any)?.transactionId ?? (res.data as any)?.id;
  const contractId = (res.data as any)?.contractId;
  if (!txId) throw new Error(`No transactionId in response: ${JSON.stringify(res.data)}`);
  console.log(`Submitted deploy tx ${txId} (contractId ${contractId})\nPolling...`);

  const { contractAddress, txHash } = await waitForContractAddress(wallets, txId);

  const deployment = {
    contractName: 'AgentRegistry',
    contractId,
    address: contractAddress,
    blockchain: CIRCLE_BLOCKCHAIN,
    deployer: coordinator.address,
    txHash,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(REGISTRY_PATH, JSON.stringify(deployment, null, 2));

  console.log(`\n✅ AgentRegistry deployed`);
  console.log(`   address: ${contractAddress}`);
  console.log(`   saved → registry.json`);
  console.log(`\nNext: wire it into TaskMarket by calling setAgentRegistry(<address>) from the coordinator.`);
}

main().catch((err: any) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
