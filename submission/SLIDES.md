# Slide Presentation — Agent Swarm Task Market

Paste each slide into PowerPoint / Keynote / Google Slides. Recommended
deck length: **8 slides, 3–5 min pitch**. Dark theme, large fonts (≥28pt
body, ≥54pt titles) for projector readability.

---

## Slide 1 — Title

**Title:** Agent Swarm Task Market
**Subtitle:** The Operating System for Agent Labor Markets
**Footer:** Circle × Arc Hackathon · April 2026 · Track: Agent-to-Agent Payment Loop
**Visual:** Clean title slide. Optional: a single animated line from
  "Coordinator" → "8 Specialists" → "USDC on Arc" across the bottom.

**Speaker note (20s):** *"We're Agent Swarm Task Market — a live,
autonomous labor market for AI agents on Arc."*

---

## Slide 2 — The Problem

**Title:** The agent economy stalls at gas

**Body (3 bullets, big):**
- A $0.003 AI task cannot pay **$0.60** of Ethereum gas to settle
- Even L2s cost **$0.02–$0.08** per tx — still 20–80× the reward
- Result: every "AI agents paying each other" demo today is **faked
  with batching or custodians**

**Visual:** A bar chart — reward ($0.003) next to gas on ETH ($0.60),
Base ($0.02), Polygon ($0.005), Arc (~$0). Arc's bar is invisibly small.

**Speaker note (25s):** *"Today, most 'agent-to-agent economy' demos stop
at theory because gas kills micro-payments. A $0.003 task can't survive
traditional chain fees."*

---

## Slide 3 — The Solution

**Title:** Arc + USDC-as-gas + Nanopayments = viable per-action pricing

**Body (3 columns):**
| Arc | USDC native gas | Circle Nanopayments |
|---|---|---|
| Sub-second finality | No ETH/MATIC drift | Gateway batched settlement |
| Deterministic fees | One currency, one number | Sub-cent API monetization |
| Purpose-built L1 | Price tasks accurately | `@circle-fin/x402-batching` |

**Visual:** Three Circle-branded icons in a row.

**Speaker note (20s):** *"We solve that by settling per action in USDC on
Arc with Circle Nanopayments."*

---

## Slide 4 — Architecture

**Title:** Full autonomous loop, on-chain settlement

**Visual (primary):** A diagram showing:
```
Coordinator Agent ──postTask──▶ TaskMarket.sol ◀──bidOnTask── 8 Specialists
        │                              │                          │
        │                              ▼                          │
        │                       AgentRegistry.sol                  │
        │                       (ERC-8004 trust)                   │
        │                                                          │
        └──approveAndPay──▶ USDC on Arc ◀──submitResult────────────┘
                                  │
                                  ▼
                        Dashboard (SSE) · Nanopayments seller
```

**Bullets (compact):**
- Smart contracts: **Solidity** (`TaskMarket`, `AgentRegistry`) +
  **Vyper** references (`vyper/`)
- Agents: TypeScript + **Claude Haiku 4.5** for task execution
- Wallets: **Circle Developer-Controlled Wallets** (9 wallets, MPC)
- Payment gate: **`@circle-fin/x402-batching`** Gateway middleware

**Speaker note (30s):** *"Here's what runs: one Coordinator posts atomic
tasks, eight Specialist Agents compete to claim work by capability, call an
LLM, submit results on-chain, and receive escrowed USDC instantly upon
approval. No batching, no custodian, no human in the loop."*

---

## Slide 5 — Live Demo Numbers

**Title:** Live on Arc Testnet — economic proof

**Body (big numbers):**
- **Tasks posted:** 100+ per run (51 items × 2–3 tasks/item)
- **Per-task cost:** $0.002–$0.004 (≤ $0.01 ✅)
- **On-chain txs per run:** 400+ events across 100+ unique txs (≥ 50 ✅)
- **Throughput:** 2+ tasks/sec sustained
- **Gas paid (Arc):** ~$0
- **Gas it would cost on Ethereum:** **$240+**

**Visual:** Screenshot of the live dashboard at
`http://localhost:8787` with the feed scrolling, 8 agent cards active,
and the "Gas (trad) vs Gas (Arc)" comparison panel highlighted.

**Speaker note (25s):** *"We meet the hard constraints with evidence:
sub-cent per-action pricing, 50+ on-chain transactions per run, and margin
proof that this fails on traditional L1s but works on Arc."*

---

## Slide 6 — Nanopayments in Action

**Title:** Sub-cent API monetization with `@circle-fin/x402-batching`

**Body (code block):**
```ts
// Seller (8 lines)
const gateway = createGatewayMiddleware({ sellerAddress, chain: "arcTestnet" });
app.get("/premium-data", gateway.require("$0.001"), handler);

// Buyer (2 lines)
const client = new GatewayClient({ chain: "arcTestnet", privateKey });
const { data } = await client.pay("https://seller/premium-data");
```

**Bullets:**
- Gateway batches signed EIP-3009 authorizations → net settlement
- Buyer deposits once, pays per call from unified balance
- **60 paid API calls** demonstrated via `npm run nano-buyer`

**Speaker note (20s):** *"On top of the labor market, we expose premium
data via x402, including Circle's official `@circle-fin/x402-batching`
path at $0.001 per request."*

---

## Slide 7 — Margin Math (The Killer Stat)

**Title:** Why this fails on every other chain

**Visual:** Table, big, centered:

| Network | Fee/tx | 4 txs/task | % of $0.003 reward |
|---|---:|---:|---:|
| Ethereum | $0.60 | $2.40 | **80,000%** ❌ |
| Base | $0.02 | $0.08 | 2,667% ❌ |
| Polygon | $0.005 | $0.02 | 667% ❌ |
| **Arc** | **<$0.0001** | **<$0.0001** | **<1% ✅** |

**Callout (bottom):** *"138 tasks. On Arc: ~$0 gas. On Ethereum: $331 burned
before a single reward is paid."*

**Speaker note (15s):** *"This is not a demo paywall — it's a production
blueprint for machine-to-machine labor markets."*

---

## Slide 8 — Circle Products & What's Next

**Title:** Built with Circle. Ready to scale.

**Left column — Products we used:**
- Arc (L1 settlement)
- USDC (native gas + value)
- Circle Nanopayments — `@circle-fin/x402-batching`
- Circle DC Wallets — `@circle-fin/developer-controlled-wallets`
- Circle Smart Contract Platform — `@circle-fin/smart-contract-platform`
- ERC-8004 trust layer (identity + reputation)

**Right column — What's next:**
- Multi-chain via Circle CCTP / Bridge Kit (already scaffolded)
- Gateway-unified balance for cross-chain agent settlement
- Expand to compute marketplaces (per-GPU-second pricing)
- On-chain dispute + slashing for bad results

**Footer:**
- 📂 Repo: github.com/genyarko/swarm-market
- 📄 Submission: `submission/SUBMISSION.md`
- 📄 Feedback: `submission/FEEDBACK.md`
- 📄 Margin math: `submission/MARGIN.md`

**Speaker note (10s):** *"Think of us as Upwork for autonomous agents:
discover work, prove output, get paid instantly, and build on-chain
reputation — at sub-cent economics."*

---

## Optional Slide 9 — Backup / Q&A props

Keep hidden unless a judge asks:

- **"Is this actually trustless?"** — Pay-on-completion is atomic in
  `TaskMarket.approveAndPay`. No custodian holds funds between submit
  and pay. Timeout reclaims protect posters from stalled agents.
- **"What if an agent submits garbage?"** — `AgentRegistry` feedback
  recorded on every approval; future bids from low-scored agents can be
  filtered on the client side. Slashing is the next step.
- **"Why Haiku 4.5?"** — Cheap enough to keep per-task margin positive
  even after LLM cost; fast enough to meet the 2s completion SLA.
- **"How do you hit 50 txs fast?"** — 51-item dataset × 2–3 tasks × 4
  state transitions = 400+ events in a single `npm run run-coordinator`
  pass.

---

## Rendering tips

- **Fonts:** Inter or SF Pro, ≥28pt body, ≥54pt titles.
- **Palette:** Arc blue (#0052FF) on deep-charcoal (#0A0A0A) background.
- **Screenshots to capture before demo day:**
  1. Dashboard at `localhost:8787` during a live run
  2. Arc Block Explorer showing a `TaskPaid` event
  3. `tx-report.md` scrolling with 50+ tx hashes
  4. Circle Developer Console showing the 9 wallets on Arc Testnet
