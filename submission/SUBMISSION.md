# Hackathon Submission — Agentic Economy on Arc

Answer key for every field in the submission form. Copy each section into
the corresponding field on Dorahacks.

---

## 📋 Basic Information

### Project Title
**Agent Swarm Task Market — an autonomous micro-task economy on Arc**

### Short Description (≤ 200 chars)
The Operating System for Agent Labor Markets: AI agents post, bid, execute,
and settle micro-tasks in sub-cent USDC on Arc with ERC-8004 reputation and
x402 programmable monetization.

*(183 characters)*

### Long Description

**Angle title: The Operating System for Agent Labor Markets.**
Most "agent-to-agent economy" demos stop at theory because gas kills
micro-payments. A $0.003 task cannot absorb traditional L1 fees.
Arc + Circle Nanopayments flip that math: USDC-native, deterministic,
sub-cent settlement that makes per-action economics viable.

**One-liner.** Agent Swarm Task Market is an autonomous labor economy where
AI agents discover work, compete for tasks, deliver results, and get paid in
sub-cent USDC on Arc — with identity/reputation and programmable API
monetization layered on top.

**What it does.** A **Coordinator Agent** loads a 51-item seed dataset
(English + multilingual text) and decomposes each item into 2–3 atomic
tasks drawn from five capabilities — `summarize`, `classify`, `translate`,
`sentiment`, `extract` — each priced at $0.002–$0.004 USDC. Tasks are
posted to an on-chain `TaskMarket` contract that escrows the reward.

Eight **Specialist Agents** poll the contract over Arc RPC, claim tasks
matching their capabilities (first-come wins), fetch the input, call an
LLM to do the work (pluggable via `LLM_PROVIDER` — defaults to Mistral,
switchable to Claude Haiku 4.5 by setting `LLM_PROVIDER=claude`), and
submit the result on-chain. A
background auto-approver on the coordinator releases the escrowed USDC
atomically to the winning specialist the moment the result arrives.
An **ERC-8004 trust registry** (`contracts/AgentRegistry.sol`) gates
bidding by identity and automatically records a reputation score on
every payment. The full loop — **post → bid → AI work → submit → verify
→ pay → reputation update** — runs autonomously with zero human
intervention.

**Nanopayments layer.** On top of the marketplace we expose two x402
surfaces for per-request API monetization:
1. A custom facilitator at `/premium/*` implementing EIP-3009 "exact"
   directly (`server/lib/x402.ts`).
2. The headline Circle integration: a Gateway seller using
   **`@circle-fin/x402-batching`** (`server/dashboard/nano-seller.ts`) at
   `/premium-data` for **$0.001 per request**. A matching buyer
   (`scripts/nano-buyer.ts`) uses the official `GatewayClient` to
   deposit once into a unified balance and pay per call — exactly the
   pattern Circle's Nanopayments docs prescribe.

**Proof of the three hard requirements.**
- ✅ **Per-action pricing ≤ $0.01** — rewards are $0.002–$0.004 on the
  marketplace side, $0.001 on the Nanopayments API side.
- ✅ **50+ on-chain transactions** — `npm run tx-report` scans the
  `TaskMarket` event log after a run and emits `tx-report.md` / `.csv`
  with every tx hash and Arc explorer link. The 51-item dataset produces
  ~400 on-chain events across 100+ unique txs per run.
- ✅ **Margin explanation** — [`MARGIN.md`](./MARGIN.md) shows why the
  same model loses $0.08–$2.40 per task on Ethereum/Base/Polygon and
  becomes economically viable only on Arc. The live dashboard
  (`server/dashboard/server.ts`) renders the "traditional L1 gas would
  cost $X" comparison in real time during the demo.

**Scoring narrative (explicit, judge-facing).**
- This is a **full economic loop**, not only a paywall integration:
  create work → open competition → verify completion → atomic settlement →
  reputation accrual → secondary API monetization.
- We meet **≤ $0.01 per action**.
- We have **50+ on-chain txs** (**155 unique txs in this run**).
- We provide **margin proof vs traditional L1s**.
- Primary track: **Agent-to-Agent Payment Loop**; secondary: **Per-API Monetization Engine** + **Usage-Based Compute Billing**.

**Track alignment.** Primary: **🤖 Agent-to-Agent Payment Loop**.
Secondary: **🪙 Per-API Monetization Engine** and **🧮 Usage-Based
Compute Billing** — both naturally emerge from the same code.

**Circle products used.** Arc, USDC, Circle Nanopayments
(`@circle-fin/x402-batching`), Circle Wallets
(`@circle-fin/developer-controlled-wallets`), Circle Smart Contract
Platform (`@circle-fin/smart-contract-platform`), x402 standard. Detailed
feedback in [`FEEDBACK.md`](./FEEDBACK.md).

### Technology / Category Tags
`Arc` `USDC` `Circle Nanopayments` `Circle Wallets` `Circle Smart Contract Platform`
`x402` `ERC-8004` `Agent-to-Agent Payments` `Autonomous Agents` `Micropayments`
`TypeScript` `Solidity` `Vyper` `Titanoboa` `Claude` `Mistral`

### Primary Track
**🤖 Agent-to-Agent Payment Loop** — autonomous agents pay and receive value in
real time, trustless, no batching or custodian.

### Secondary Tracks (natural alignment)
- 🪙 **Per-API Monetization Engine** — Nanopayments seller gates premium
  market data at $0.001/request via `@circle-fin/x402-batching`.
- 🧮 **Usage-Based Compute Billing** — every completed Claude call is billed
  on-chain per-action at $0.002–$0.004.

---

## 📸 Cover Image / Video / Slides

- **Cover image**: screenshot of `https://swarm-market-production.up.railway.app` dashboard during a
  50+ tx run (agent cards active, flow graph animating, gas comparison panel
  showing $X trad vs $0 Arc).
- **Video presentation**: see §"Transaction Flow Demonstration (Video)" below.
https://youtu.be/8W_EnCeTaTE
- **Slide presentation**: 5 slides covering problem → architecture → live
  numbers → Circle product feedback → future work.

---

## 💻 App Hosting & Code Repository

### Public GitHub Repository
https://github.com/genyarko/swarm-market

### Application URL (hosted demo)
Railway deployment — `https://swarm-market-production.up.railway.app` (dashboard only,
read-only).

### Run locally
```bash
npm install
cp .env.example .env     # fill CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, ANTHROPIC_API_KEY
npm run create-wallets
# Fund coordinator at https://faucet.circle.com (Arc Testnet)
npm run deploy-taskmarket
npm run deploy-registry
npm run register-agents
npm run run-coordinator      # begins posting tasks from seed dataset
npm run run-agents           # spawns 8 specialists + auto-approver
npm run dashboard            # https://swarm-market-production.up.railway.app
# Nanopayments track:
npm run nano-seller          # http://localhost:8788  (Circle Gateway middleware)
npm run nano-buyer           # deposit → 60 paid calls
# Proof:
npm run tx-report            # writes tx-report.md + tx-report.csv
```

---

## 📝 Circle Product Feedback (Required)

See **[FEEDBACK.md](./FEEDBACK.md)** — covers products used, why we chose
them, what worked, what could be improved, and concrete recommendations.


## ✅ Hackathon hard requirements — evidence checklist

| Requirement | Status | Evidence |
|---|---|---|
| Per-action pricing ≤ $0.01 | ✅ | `coordinator.ts:33-39` ($0.002–$0.004); Nanopayments price $0.001 |
| 50+ on-chain transactions | ✅ | `tx-report.md` after running coordinator+agents on the 51-item dataset (≈ 400+ events across 100+ unique txs). One command: `npm run tx-report` |
| Margin explanation | ✅ | [MARGIN.md](./MARGIN.md) |
| Arc settlement | ✅ | `server/lib/chains.ts:31`; `deployments.json` |
| USDC (native gas + value) | ✅ | `TaskMarket.sol` escrows USDC; Arc uses USDC for gas |
| Circle Nanopayments infra | ✅ | `server/dashboard/nano-seller.ts` + `scripts/nano-buyer.ts` wire `@circle-fin/x402-batching` |
| Circle Wallets | ✅ | `@circle-fin/developer-controlled-wallets` throughout |
| x402 | ✅ | Own facilitator (`server/lib/x402.ts`) + Circle Gateway middleware |
| ERC-8004 trust layer | ✅ | `contracts/contracts/AgentRegistry.sol` + `vyper/contracts/AgentRegistry.vy` |
| Vyper / Titanoboa | ✅ | `vyper/` (contracts, tests, `circle_boa_bridge.py`) |
| Aligned with ≥1 track | ✅ | Agent-to-Agent (primary); Per-API and Usage-Based (secondary) |

---

## ❓ Judge FAQ (online review)

**Q: Why are some `TaskCompleted` events not yet `TaskPaid`?**  
A: `TaskPaid` only occurs after coordinator grading/approval; failed or stalled assignments move through reject/reclaim/pending states before payment.

**Q: Why are task IDs non-contiguous in some tx reports?**  
A: Reports can include a fixed block window over a long-lived contract, so IDs may reflect prior runs and concurrent sessions in the same deployment.

**Q: How is trust enforced for agents?**  
A: `TaskMarket` can require ERC-8004 identity via `AgentRegistry`, and approvals emit reputation feedback that updates each agent's score history.
