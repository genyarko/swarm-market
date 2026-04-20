# Circle Product Feedback

Submission field required by the hackathon. Eligible for the $500 USDC
"Product Feedback Incentive" prize.

## 1. Which Circle products we used

| Product | Package / Path | Where in the repo |
|---|---|---|
| **Arc (L1 settlement)** | chainId 28882, USDC-native gas | `server/lib/chains.ts:31` |
| **USDC** | native gas + value on Arc | Everywhere — `TaskMarket.sol` escrows in USDC |
| **Circle Nanopayments** | `@circle-fin/x402-batching` (buyer `GatewayClient`, seller `createGatewayMiddleware`) | `server/dashboard/nano-seller.ts`, `scripts/nano-buyer.ts` |
| **Circle Wallets (Developer-Controlled)** | `@circle-fin/developer-controlled-wallets` | `server/lib/circle.ts`, `scripts/create-wallets.ts` |
| **Circle Smart Contract Platform** | `@circle-fin/smart-contract-platform` | `scripts/deploy-taskmarket.ts`, `scripts/deploy-registry.ts` |
| **Circle TS SDK (umbrella)** | `@circle-fin/circle-sdk` (`Circle`, `circle.balances.*`, `circle.paymentIntents.*`) | documented but not wired — see §5 |
| **x402 standard** | custom in-proc facilitator for EIP-3009 "exact" + Circle Gateway middleware | `server/lib/x402.ts`, `server/dashboard/nano-seller.ts` |

## 2. Why we chose these products

- **Arc + USDC-as-gas** — the core business case (see `MARGIN.md`). Per-action
  rewards of $0.002–$0.004 only make sense when gas is a rounding error
  denominated in the same unit as the reward. Arc is the only L1 where that
  is structurally true today.
- **Nanopayments (x402-batching)** — we needed a standards-based way to gate
  marketplace data behind per-request USDC payments. The Gateway middleware
  pattern let us add payment gating to a route with one line, and batching
  made $0.001/request economically viable.
- **Developer-Controlled Wallets** — 9 wallets (1 coordinator + 8 specialists)
  with programmatic key management and MPC security. Faster to ship than
  BYO-keys for an agent swarm.
- **Smart Contract Platform** — transaction submission via Circle's API meant
  we could sign on-chain calls from wallet IDs without touching private keys.
- **ERC-8004 trust layer** — added on top for agent identity + reputation,
  which the `TaskMarket` enforces when a registry is wired
  (`contracts/contracts/TaskMarket.sol:108`).

## 3. What worked well

- **Arc explorer + faucet** — one-click funding and clean tx verification.
  Block times felt sub-second in practice.
- **DC Wallets API** — creating 9 wallets and a wallet set took ~10 lines.
  Entity-secret-based key management out of the box was a big de-risk.
- **x402 "exact" scheme** — the spec is tight and the signature recovery
  path in ethers worked the first time. Having a dedicated SDK for the
  batching + Gateway unified-balance piece (`@circle-fin/x402-batching`)
  meant we didn't need to implement our own batch settlement — Gateway
  does it for us and the seller sees a single balance.
- **Arc docs at `https://developers.circle.com/llms.txt`** — the `llms.txt`
  discovery pattern was a real productivity multiplier. We pointed Claude
  Code at that URL and it found the right product page (Gateway →
  Nanopayments → seller quickstart) in one fetch.

## 4. What could be improved

- **Nanopayments SDK discoverability** — `@circle-fin/x402-batching` is the
  right package, but the name doesn't mention "Nanopayments". Searching npm
  for "circle nanopayments" returns nothing useful. Consider a meta-package
  `@circle-fin/nanopayments` that re-exports from `x402-batching` so the
  package name matches the marketing term in the hackathon prompt.
- **SDK surface area split across packages** — in one project we installed:
  `@circle-fin/developer-controlled-wallets`,
  `@circle-fin/smart-contract-platform`,
  `@circle-fin/x402-batching`,
  and we considered `@circle-fin/circle-sdk`. A single monorepo
  `@circle-fin/sdk` with sub-paths (`/wallets`, `/scp`, `/x402`, `/payments`)
  would cut install churn and type-import confusion.
- **Arc-specific chain ID constants** — `chain: "arcTestnet"` in the
  `GatewayClient` constructor is a magic string. Publishing a
  `CircleChains.arcTestnet` enum (like `CircleEnvironments.sandbox` in
  `@circle-fin/circle-sdk`) would be nicer DX.
- **USDC EIP-712 domain on Arc** — the domain name/version (`"USDC" / "2"`)
  isn't trivial to find and is required for signing `transferWithAuthorization`.
  A canonical "Arc USDC metadata" doc page would save an hour of tinkering.
- **Faucet rate limits during demo rehearsal** — testing the 50-tx threshold
  burned through the faucet quota a couple of times. A per-hackathon faucet
  bypass for known participant addresses would help.
- **Entity-secret onboarding** — having to manually back up
  `recovery_file_*.dat` is correct-by-design but intimidating for
  first-timers. A one-liner that prompts "paste this into your password
  manager now, then type 'done'" inline in the CLI would reduce
  foot-gun risk.

## 5. Recommendations

1. **Unify the "paying a per-action price" story.** Today we have three
   adjacent things — `transferWithAuthorization` via raw EIP-3009, x402
   facilitator, Nanopayments/Gateway. Developers don't know which to reach
   for. A decision matrix on the Nanopayments landing page —
   *"pay-per-request HTTP → Nanopayments; on-chain rails only → EIP-3009
   direct"* — would eliminate hours of investigation.

2. **Ship a Circle reference seller + buyer template.** The quickstarts
   are good but stop at 5 lines. A "dogfood" repo that shows a production-
   shape app (Express seller with auth, buyer with error handling and retries,
   dashboard reading Gateway balances) would lift the quality floor for
   everyone.

3. **Add `circle.paymentIntents.createPaymentIntent` examples targeting
   Arc.** The TS SDK examples we were pointed at use `chain: "ETH"`. Making
   Arc a first-class chain in that SDK (so fiat-settled crypto payments
   can land on Arc USDC) would complete the product story.

4. **Explicit tx-count endpoint.** The hackathon asks for "50+ on-chain
   txs in the demo." We wrote our own `scripts/tx-report.ts`. A Circle-
   hosted block-explorer JSON endpoint (`GET /contract/{addr}/tx-count`)
   would remove a dozen lines of custom code per hackathon team.

5. **First-class Vyper + Titanoboa support on Arc.** The Circle-titanoboa-
   sdk and vyper-agentic-payments repos are great reference material but
   we hit some rough edges on dependency resolution. A pinned Vyper
   version matrix for Arc, and a CI badge that says "Vyper x.y.z ✓ on Arc",
   would remove anxiety about writing production contracts in Vyper on Arc.

## 6. Evidence

- Seller wired with the official SDK: `server/dashboard/nano-seller.ts`
- Buyer wired with the official SDK: `scripts/nano-buyer.ts`
- Margin math (≤ $0.01 per action): `MARGIN.md`
- 50+ on-chain tx proof: `npm run tx-report` → `tx-report.md` / `tx-report.csv`
  - Latest online-run artifact: **155 unique on-chain txs** (contract `0x821c0ee80e6cdcd09dc2719d25fce426db634de5`, Arc testnet; meets the ≥50 rule with wide margin).
- Live comparison counter: `server/dashboard/server.ts:27`
  (`TRAD_GAS_PER_TX_USDC`)
