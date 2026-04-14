import {
  initiateDeveloperControlledWalletsClient,
  type TokenBlockchain,
} from '@circle-fin/developer-controlled-wallets';
import { env } from './config.js';

export const circle = initiateDeveloperControlledWalletsClient({
  apiKey: env.circleApiKey,
  entitySecret: env.circleEntitySecret,
});

function unwrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: any) => {
    const data = err?.response?.data;
    if (data) {
      const detail = data.errors ? `${data.message}: ${JSON.stringify(data.errors)}` : data.message;
      throw new Error(`Circle API ${err.response.status}: ${detail}`);
    }
    throw err;
  });
}

const TERMINAL = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);

export type TxResult = { state: string; txHash?: string; errorReason?: string };

export async function pollTx(txId: string, pollMs = 2500): Promise<TxResult> {
  while (true) {
    const res = await unwrap(circle.getTransaction({ id: txId }));
    const tx = res.data?.transaction as any;
    const state = tx?.state ?? 'UNKNOWN';
    if (TERMINAL.has(state)) {
      return { state, txHash: tx?.txHash, errorReason: tx?.errorReason };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function execContract(args: {
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: (string | number | boolean | string[])[];
}): Promise<TxResult> {
  const res = await unwrap(
    circle.createContractExecutionTransaction({
      walletId: args.walletId,
      contractAddress: args.contractAddress,
      abiFunctionSignature: args.abiFunctionSignature,
      abiParameters: args.abiParameters,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    }),
  );
  const txId = (res.data as any)?.id;
  if (!txId) throw new Error(`No tx id for ${args.abiFunctionSignature}`);
  return pollTx(txId);
}

export async function transferUsdc(args: {
  fromWalletId: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
}): Promise<TxResult> {
  const res = await unwrap(
    circle.createTransaction({
      walletId: args.fromWalletId,
      destinationAddress: args.toAddress,
      amount: [args.amount],
      // ARC-TESTNET uses USDC as the native gas token; for native transfers
      // Circle expects an empty tokenAddress paired with the blockchain.
      tokenAddress: '',
      blockchain: env.blockchain as TokenBlockchain,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    }),
  );
  const txId = (res.data as any)?.id;
  if (!txId) throw new Error('No tx id for transfer');
  return pollTx(txId);
}

export async function getUsdcBalance(walletId: string): Promise<number> {
  const res = await unwrap(circle.getWalletTokenBalance({ id: walletId }));
  const usdc = res.data?.tokenBalances?.find((b) => b.token?.symbol === 'USDC');
  return Number(usdc?.amount ?? '0');
}
