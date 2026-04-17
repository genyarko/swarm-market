/**
 * Chain registry for multi-chain Circle Developer-Controlled Wallet support.
 *
 * Circle's DC Wallets expose a `TokenBlockchain` enum; x402 uses its own
 * `network` slug; EVM clients need `chainId` + RPC URL. This table maps all
 * four together so the rest of the system can pick a chain from any axis.
 */

export type ChainConfig = {
  /** Circle DC Wallets blockchain identifier */
  circle: string;
  /** x402 / human-friendly network slug */
  network: string;
  /** EIP-155 chain id */
  chainId: number;
  /** Default public RPC */
  rpcUrl: string;
  /** Canonical USDC address on this chain */
  usdcAddress: string;
  /** USDC EIP-712 domain name (used for EIP-3009) */
  usdcName: string;
  /** USDC EIP-712 domain version */
  usdcVersion: string;
  /** Explorer URL template (use {tx}) */
  explorerTx: string;
  /** True if USDC is the native gas token */
  usdcIsGas: boolean;
};

export const CHAINS: Record<string, ChainConfig> = {
  'ARC-TESTNET': {
    circle: 'ARC-TESTNET',
    network: 'arc-testnet',
    chainId: 28882,
    rpcUrl: 'https://rpc.testnet.arc.network',
    usdcAddress: '0x3600000000000000000000000000000000000000',
    usdcName: 'USDC',
    usdcVersion: '2',
    explorerTx: 'https://explorer.testnet.arc.network/tx/{tx}',
    usdcIsGas: true,
  },
  ARC: {
    circle: 'ARC',
    network: 'arc',
    chainId: 28881,
    rpcUrl: 'https://rpc.arc.network',
    usdcAddress: '0x3600000000000000000000000000000000000000',
    usdcName: 'USDC',
    usdcVersion: '2',
    explorerTx: 'https://explorer.arc.network/tx/{tx}',
    usdcIsGas: true,
  },
  'ETH-SEPOLIA': {
    circle: 'ETH-SEPOLIA',
    network: 'ethereum-sepolia',
    chainId: 11155111,
    rpcUrl: 'https://sepolia.drpc.org',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    usdcName: 'USDC',
    usdcVersion: '2',
    explorerTx: 'https://sepolia.etherscan.io/tx/{tx}',
    usdcIsGas: false,
  },
  'BASE-SEPOLIA': {
    circle: 'BASE-SEPOLIA',
    network: 'base-sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcName: 'USDC',
    usdcVersion: '2',
    explorerTx: 'https://sepolia.basescan.org/tx/{tx}',
    usdcIsGas: false,
  },
  BASE: {
    circle: 'BASE',
    network: 'base',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcName: 'USD Coin',
    usdcVersion: '2',
    explorerTx: 'https://basescan.org/tx/{tx}',
    usdcIsGas: false,
  },
  'MATIC-AMOY': {
    circle: 'MATIC-AMOY',
    network: 'polygon-amoy',
    chainId: 80002,
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    usdcAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    usdcName: 'USDC',
    usdcVersion: '2',
    explorerTx: 'https://amoy.polygonscan.com/tx/{tx}',
    usdcIsGas: false,
  },
  'AVAX-FUJI': {
    circle: 'AVAX-FUJI',
    network: 'avalanche-fuji',
    chainId: 43113,
    rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    usdcAddress: '0x5425890298aed601595a70AB815c96711a31Bc65',
    usdcName: 'USD Coin',
    usdcVersion: '2',
    explorerTx: 'https://testnet.snowtrace.io/tx/{tx}',
    usdcIsGas: false,
  },
};

export function chainByCircle(id: string): ChainConfig | undefined {
  return CHAINS[id.toUpperCase()];
}

export function chainByNetwork(slug: string): ChainConfig | undefined {
  const lower = slug.toLowerCase();
  for (const cfg of Object.values(CHAINS)) {
    if (cfg.network === lower) return cfg;
  }
  return undefined;
}

export function chainByChainId(id: number): ChainConfig | undefined {
  for (const cfg of Object.values(CHAINS)) {
    if (cfg.chainId === id) return cfg;
  }
  return undefined;
}

export function explorerTxUrl(chain: ChainConfig, tx: string): string {
  return chain.explorerTx.replace('{tx}', tx);
}

export function listSupportedChains(): string[] {
  return Object.keys(CHAINS);
}
