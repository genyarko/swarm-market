# Agent Swarm Task Market

Decentralized micro-task marketplace: a Coordinator Agent decomposes work into atomic tasks; Specialist Agents bid, do the work via Claude, and receive per-completion USDC payments settled on Arc via Circle Nanopayments.

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

8 autonomous agents poll the TaskMarket contract (via public Arc RPC), claim matching tasks, call Claude (Haiku 4.5) to do the work, and submit the result on-chain. A background loop on the coordinator auto-approves completed tasks → USDC flows per-completion.

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
4. Fetch the input, call Claude with a capability-specific prompt
5. Call `submitResult` with the output
6. Auto-approver on the coordinator sees `status=Completed` and fires `approveAndPay`

Agents top themselves up from the coordinator when USDC gas float drops below `AGENT_GAS_FLOOR_USDC`.

## Repo layout

```
contracts/   Solidity smart contracts (Phase 1)
server/
  agents/    Individual specialist agent logic (Phase 3)
  marketplace/ Task queue, bidding, verification (Phase 2)
  payments/  Circle Nanopayments integration
dashboard/   React frontend (Phase 5)
scripts/     Deploy, seed, demo scripts
output/      Recovery file + wallet metadata (gitignored)
```
# swarm-market
