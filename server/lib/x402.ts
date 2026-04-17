import http from 'node:http';
import { ethers } from 'ethers';
import { chainByNetwork, type ChainConfig } from './chains.js';

/**
 * x402 (HTTP 402 Payment Required) facilitator + Express-style middleware.
 *
 * Implements the "exact" scheme: the client proves a USDC payment via an
 * EIP-3009 `transferWithAuthorization` signature carried in the `X-PAYMENT`
 * request header (base64 JSON). The facilitator verifies the signature and
 * may settle it on-chain.
 *
 * Spec: https://www.x402.org/specification
 * Reference facilitator: https://github.com/coinbase/x402
 */

export type X402Scheme = 'exact';

export type X402PaymentRequirements = {
  scheme: X402Scheme;
  network: string;                // e.g. "arc-testnet", "base-sepolia"
  maxAmountRequired: string;      // atomic units of USDC (6 decimals)
  resource: string;               // the URL being paid for
  description: string;
  mimeType: string;
  payTo: string;                  // recipient address
  maxTimeoutSeconds: number;
  asset: string;                  // ERC-20 token address (USDC)
  outputSchema?: unknown;
  extra?: { name: string; version: string };
};

export type X402ExactPayload = {
  signature: string;              // 65-byte hex sig
  authorization: {
    from: string;
    to: string;
    value: string;                // atomic USDC
    validAfter: string;           // unix seconds
    validBefore: string;          // unix seconds
    nonce: string;                // 32-byte hex
  };
};

export type X402PaymentPayload = {
  x402Version: 1;
  scheme: X402Scheme;
  network: string;
  payload: X402ExactPayload;
};

export type FacilitatorVerifyResult = {
  isValid: boolean;
  invalidReason?: string;
  payer: string;
};

export type FacilitatorSettleResult = {
  success: boolean;
  errorReason?: string;
  transaction?: string;
  network: string;
  payer: string;
};

/**
 * In-process x402 facilitator. Verifies EIP-3009 signatures locally and
 * (optionally) settles by broadcasting `transferWithAuthorization` via a
 * signer. If no signer is configured, settlement is deferred and returns
 * a verification receipt that downstream settlement can replay.
 */
export class X402Facilitator {
  constructor(private signer?: ethers.Wallet) {}

  async verify(
    payment: X402PaymentPayload,
    requirements: X402PaymentRequirements,
  ): Promise<FacilitatorVerifyResult> {
    const chain = chainByNetwork(payment.network);
    if (!chain) return fail('unsupported_network', payment.payload.authorization.from);
    if (payment.scheme !== 'exact') return fail('unsupported_scheme', payment.payload.authorization.from);
    if (payment.network !== requirements.network) return fail('network_mismatch', payment.payload.authorization.from);

    const a = payment.payload.authorization;
    if (!ethers.isAddress(a.from) || !ethers.isAddress(a.to)) return fail('bad_address', a.from);
    if (a.to.toLowerCase() !== requirements.payTo.toLowerCase()) return fail('wrong_recipient', a.from);

    const now = Math.floor(Date.now() / 1000);
    if (Number(a.validAfter) > now) return fail('not_yet_valid', a.from);
    if (Number(a.validBefore) <= now) return fail('expired', a.from);
    if (BigInt(a.value) < BigInt(requirements.maxAmountRequired)) return fail('underpayment', a.from);

    const tokenName = requirements.extra?.name ?? 'USDC';
    const tokenVersion = requirements.extra?.version ?? '2';
    const domain = {
      name: tokenName,
      version: tokenVersion,
      chainId: chain.chainId,
      verifyingContract: requirements.asset,
    };
    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    };
    let recovered: string;
    try {
      recovered = ethers.verifyTypedData(domain, types, a, payment.payload.signature);
    } catch (e) {
      return fail(`bad_signature:${(e as Error).message}`, a.from);
    }
    if (recovered.toLowerCase() !== a.from.toLowerCase()) return fail('signature_mismatch', a.from);

    return { isValid: true, payer: a.from };
  }

  async settle(
    payment: X402PaymentPayload,
    requirements: X402PaymentRequirements,
  ): Promise<FacilitatorSettleResult> {
    const v = await this.verify(payment, requirements);
    if (!v.isValid) {
      return { success: false, errorReason: v.invalidReason, network: payment.network, payer: v.payer };
    }
    if (!this.signer) {
      // Verification-only mode — downstream infra (e.g. Circle DC Wallet batch
      // settlement) can replay the authorization later. We still return
      // success so the resource can be delivered; this is the pattern used
      // when the caller trusts the facilitator to settle asynchronously.
      return { success: true, network: payment.network, payer: v.payer, transaction: 'deferred' };
    }

    const a = payment.payload.authorization;
    const sig = ethers.Signature.from(payment.payload.signature);
    const erc3009Abi = [
      'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
    ];
    const token = new ethers.Contract(requirements.asset, erc3009Abi, this.signer);
    try {
      const tx = await token.transferWithAuthorization!(
        a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, sig.v, sig.r, sig.s,
      );
      const receipt = await tx.wait();
      return {
        success: true,
        network: payment.network,
        payer: v.payer,
        transaction: receipt?.hash ?? tx.hash,
      };
    } catch (e) {
      return {
        success: false,
        errorReason: `settle_failed:${(e as Error).message}`,
        network: payment.network,
        payer: v.payer,
      };
    }
  }
}

function fail(reason: string, payer: string): FacilitatorVerifyResult {
  return { isValid: false, invalidReason: reason, payer };
}

export function encodePaymentHeader(p: X402PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}

export function decodePaymentHeader(header: string | undefined): X402PaymentPayload | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, 'base64').toString('utf8');
    return JSON.parse(json) as X402PaymentPayload;
  } catch {
    return null;
  }
}

/**
 * Build an EIP-3009 TransferWithAuthorization signature for a given chain.
 * Useful for client-side / agent-side payment construction.
 */
export async function signExactPayment(args: {
  wallet: ethers.Wallet;
  chain: ChainConfig;
  usdcAddress: string;
  to: string;
  value: bigint;
  validFor?: number;           // seconds, default 120
  tokenName?: string;
  tokenVersion?: string;
}): Promise<X402PaymentPayload> {
  const validFor = args.validFor ?? 120;
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: await args.wallet.getAddress(),
    to: args.to,
    value: args.value.toString(),
    validAfter: String(now - 5),
    validBefore: String(now + validFor),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
  };
  const domain = {
    name: args.tokenName ?? 'USDC',
    version: args.tokenVersion ?? '2',
    chainId: args.chain.chainId,
    verifyingContract: args.usdcAddress,
  };
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };
  const signature = await args.wallet.signTypedData(domain, types, authorization);
  return {
    x402Version: 1,
    scheme: 'exact',
    network: args.chain.network,
    payload: { signature, authorization },
  };
}

/**
 * Middleware: gates an HTTP handler behind an x402 payment. Emits 402 with a
 * paymentRequirements body when no valid payment is present, otherwise calls
 * `next` and sets the `X-PAYMENT-RESPONSE` header with a settlement receipt.
 */
export function x402Gate(opts: {
  facilitator: X402Facilitator;
  requirements: (req: http.IncomingMessage) => X402PaymentRequirements;
  settle?: boolean;
}) {
  return async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    next: () => void | Promise<void>,
  ) => {
    const requirements = opts.requirements(req);
    const header = Array.isArray(req.headers['x-payment'])
      ? req.headers['x-payment'][0]
      : req.headers['x-payment'];
    const payment = decodePaymentHeader(header);
    if (!payment) return respond402(res, requirements, 'missing_payment_header');

    const shouldSettle = opts.settle ?? true;
    const outcome = shouldSettle
      ? await opts.facilitator.settle(payment, requirements)
      : { ...(await opts.facilitator.verify(payment, requirements)), network: payment.network };

    if (!('success' in outcome ? outcome.success : outcome.isValid)) {
      const reason = 'success' in outcome ? outcome.errorReason : outcome.invalidReason;
      return respond402(res, requirements, reason ?? 'payment_invalid');
    }

    const receipt = {
      success: true,
      payer: (outcome as FacilitatorSettleResult).payer,
      network: payment.network,
      transaction: (outcome as FacilitatorSettleResult).transaction,
    };
    res.setHeader('x-payment-response', Buffer.from(JSON.stringify(receipt)).toString('base64'));
    await next();
  };
}

function respond402(
  res: http.ServerResponse,
  requirements: X402PaymentRequirements,
  reason: string,
) {
  const body = {
    x402Version: 1,
    error: reason,
    accepts: [requirements],
  };
  res.writeHead(402, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'x-payment-response',
  });
  res.end(JSON.stringify(body));
}
