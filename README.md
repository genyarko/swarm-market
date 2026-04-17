# Agent Swarm Task Market

Decentralized micro-task marketplace: a Coordinator Agent decomposes work into atomic tasks; Specialist Agents bid, do the work via a pluggable LLM (Mistral by default, Claude switchable via `LLM_PROVIDER=claude`), and receive per-completion USDC payments settled on Arc via Circle Nanopayments.

See [IMPLEMENTATION.md](./IMPLEMENTATION.md) for the full plan.

## Phase 0 — Environment & Accounts

Goal: wallets exist, funded, and a $0.001 USDC transfer settles on Arc Testnet.

### 1. Install dependencies

Requires Node.js 22+.

```bash
npm install
```

### 2. Get a Circle API key

1. Create a developer account at <https://console.circle.com>.
2. Create an API key for developer-controlled wallets.
3. Put it in `.env` as `CIRCLE_API_KEY`.

### 3. Generate + register entity secret

```bash
npm run gen-entity-secret
```

This generates a 32-byte entity secret, registers the ciphertext with Circle via the SDK, and writes the recovery file to `./output/`. Paste the printed secret into `.env` as `CIRCLE_ENTITY_SECRET`.

**Back up `./output/recovery_file_*.dat`** (password manager / encrypted storage). Losing it = losing access to wallets created with this secret.

### 4. Create wallets

```bash
npm run create-wallets
```

Creates 1 Coordinator + 8 Specialist wallets on `ARC-TESTNET`, writes them to `wallets.json`. On first run it also creates a wallet set — copy the printed `CIRCLE_WALLET_SET_ID` into `.env`.

### 5. Fund the Coordinator

Go to <https://faucet.circle.com>, select **Arc Testnet**, paste the Coordinator address from `wallets.json`, click Send USDC.

### 6. Verify Nanopayment flow

```bash
npm run send-nanopayment
```

Sends $0.001 USDC from Coordinator → first Specialist and prints the Arc tx hash + explorer link. That's the Phase 0 deliverable.

## Phase 1 — TaskMarket smart contract

On-chain task registry with atomic pay-on-completion. Contract in `contracts/contracts/TaskMarket.sol`, deployed via Circle's Smart Contract Platform SDK from the Coordinator wallet.

```bash
npm run compile-contracts       # hardhat compile
npm run test-contracts          # 6 local tests pass
npm run deploy-taskmarket       # deploys to ARC-TESTNET, saves deployments.json
npm run taskmarket-lifecycle    # post → bid → submit → approveAndPay end-to-end
```

**Note on gas:** on Arc Testnet the network fee is paid in USDC. Every agent wallet needs a small USDC float (~0.05 USDC) to cover contract calls. The lifecycle script auto-tops up the specialist from the coordinator.

## Phase 3 — Specialist Agents

8 autonomous agents poll the TaskMarket contract (via public Arc RPC), claim matching tasks, call the configured LLM to do the work, and submit the result on-chain. Set `LLM_PROVIDER=mistral` (default) or `LLM_PROVIDER=claude` (Claude Haiku 4.5) in `.env`. A background loop on the coordinator auto-approves completed tasks → USDC flows per-completion.

Capability assignment (matches IMPLEMENTATION.md):

| Specialist | Capability |
|---|---|
| 1–2 | summarize |
| 3–4 | classify |
| 5–6 | translate |
| 7 | sentiment |
| 8 | extract |

### Run

Set `ANTHROPIC_API_KEY` in `.env` first.

```bash
npm run seed-tasks     # coordinator posts 5 demo tasks on-chain
npm run run-agents     # spawns 8 specialists; coordinator auto-approves completions
```

The agents:
1. Read `nextTaskId` and iterate forward on each poll tick
2. Filter for `status=Open` + matching `taskType`
3. Call `bidOnTask` via Circle SDK (first-come wins; losers see the revert and move on)
4. Fetch the input, call the LLM with a capability-specific prompt
5. Call `submitResult` with the output
6. Auto-approver on the coordinator sees `status=Completed` and fires `approveAndPay`

Agents top themselves up from the coordinator when USDC gas float drops below `AGENT_GAS_FLOOR_USDC`.

## Phase 4 — Trust layer, x402 monetization, multi-chain

The market now integrates four agentic-payments standards on top of Circle
Nanopayments. Each can be used independently; see the matching file/script
for details.

### 1. ERC-8004 trust layer

`contracts/contracts/AgentRegistry.sol` is a reference ERC-8004 registry with
identity, reputation and validation. When wired, `TaskMarket.bidOnTask` requires
a registered agent id, and `approveAndPay` emits reputation feedback
automatically.

```bash
npm run deploy-registry   # deploy AgentRegistry
npm run register-agents   # on-board every specialist + link registry → TaskMarket
```

### 2. x402 facilitator + payment-gated APIs

`server/lib/x402.ts` is a self-contained x402 facilitator (EIP-3009 "exact"
scheme) and gate middleware. The dashboard server exposes three
payment-gated endpoints for `$0.001 USDC` per request:

| Endpoint | Returns |
|---|---|
| `GET /x402/info` | payment requirements (no auth) |
| `GET /premium/snapshot` | full marketplace snapshot |
| `GET /premium/tasks` | last 50 tasks |
| `GET /premium/stats` | live stats |

Clients construct an EIP-3009 `transferWithAuthorization` signature with
`signExactPayment()`, base64 it, and pass it in `X-PAYMENT`. Without a valid
payment the server returns HTTP 402 with a machine-readable
`paymentRequirements` body matching the [x402 spec](https://www.x402.org/specification).

### 2b. Circle Nanopayments SDK (official path)

In parallel with the custom facilitator above, we wire Circle's official
**Nanopayments** SDK (`@circle-fin/x402-batching`). This is the headline
hackathon integration: Gateway batches settlement so sub-cent per-request
pricing is economically viable.

```bash
npm install @circle-fin/x402-batching @x402/core @x402/evm express viem
npm run nano-seller            # Express seller, http://localhost:8788
npm run nano-buyer             # GatewayClient: deposit + 60 paid calls
```

Seller uses `createGatewayMiddleware({ sellerAddress, chain: "arcTestnet" })`
and protects `/premium-data`, `/premium-snapshot`, `/premium-stats` with
`gateway.require("$0.001")`. Buyer uses `GatewayClient.pay(url)` which handles
402 → EIP-3009 sign → retry automatically. Both files are small and act as
reference wire-ups for the SDK.

Docs: https://developers.circle.com/gateway/nanopayments

### 3. Multi-chain DC Wallets

`server/lib/chains.ts` registers Arc (testnet + mainnet), Ethereum Sepolia,
Base (testnet + mainnet), Polygon Amoy and Avalanche Fuji. Switch chains with:

```bash
CIRCLE_BLOCKCHAIN=BASE-SEPOLIA npm run create-wallets
```

All downstream scripts (`deploy-taskmarket`, `deploy-registry`, `run-agents`,
dashboard) pick up the chain's USDC address, chainId, EIP-712 domain name and
explorer URL from the registry — no other code changes needed.

### 4. Vyper / Titanoboa / circle-titanoboa-sdk / vyper-agentic-payments

See [`vyper/README.md`](./vyper/README.md). Includes:

- `vyper/contracts/AgentRegistry.vy` — ERC-8004 registry in Vyper
- `vyper/contracts/x402PaymentGate.vy` — on-chain x402 settlement contract
- `vyper/tests/` — Titanoboa-driven pytest suite
- `vyper/scripts/circle_boa_bridge.py` — reference `circle-titanoboa-sdk`
  bridge that compiles Vyper via Titanoboa and deploys through Circle DC
  Wallets on any supported chain.

```bash
pip install titanoboa pytest eth-account
pytest vyper/tests -q
```

## Hackathon submission

- **[submission/SUBMISSION.md](./submission/SUBMISSION.md)** — answer key for every submission field.
- **[submission/MARGIN.md](./submission/MARGIN.md)** — why this model fails on traditional L1 gas.
- **[submission/FEEDBACK.md](./submission/FEEDBACK.md)** — Circle product feedback (eligible for the $500 USDC prize).
- **`npm run tx-report`** — scans TaskMarket logs and writes `tx-report.md` +
  `tx-report.csv` proving the 50+ on-chain tx requirement.

## Repo layout

```
contracts/   Solidity smart contracts (TaskMarket, AgentRegistry, MockUSDC)
vyper/       Vyper reference implementations + Titanoboa tests
server/
  agents/    Individual specialist agent logic
  lib/       chains, circle, x402, market, registry, config
dashboard/   Static HTML/JS dashboard + SSE
scripts/     Deploy, seed, register, demo scripts
output/      Recovery file + wallet metadata (gitignored)
```
# swarm-market
