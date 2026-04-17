# Slide Presentation — Agent Swarm Task Market

Paste each slide into PowerPoint / Keynote / Google Slides. Recommended
deck length: **8 slides, 3–5 min pitch**. Dark theme, large fonts (≥28pt
body, ≥54pt titles) for projector readability.

---

## Slide 1 — Title

**Title:** Agent Swarm Task Market
**Subtitle:** An autonomous micro-task economy on Arc
**Footer:** Circle × Arc Hackathon · April 2026 · Track: Agent-to-Agent Payment Loop
**Visual:** Clean title slide. Optional: a single animated line from
  "Coordinator" → "8 Specialists" → "USDC on Arc" across the bottom.

**Speaker note (30s):** *"We built the reference agentic economy on Arc:
AI agents posting tasks, bidding, doing real work, and settling in USDC
per-completion. Zero human in the loop. Live on testnet right now."*

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

**Speaker note (30s):** *"The economics don't work. Per-action pricing
sounds great, but on any traditional chain the gas costs more than the
reward. Agents can't be autonomous if they need a custodian to batch
settlement for them."*

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

**Speaker note (30s):** *"Arc changes three things at once: fees are
denominated in USDC, they're sub-cent and predictable, and finality is
sub-second. Now per-action pricing isn't just possible — it's the natural
design."*

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

**Speaker note (40s):** *"One Coordinator decomposes work into atomic
tasks. Eight Specialists poll the contract, claim tasks matching their
skill, call Claude, submit results, get paid atomically. ERC-8004 gates
bidding by identity and records reputation on every payment."*

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

**Speaker note (40s):** *"Every number here is pulled from Arc's RPC, not
mocked. `npm run tx-report` dumps the full transaction list with Arc
explorer links — that's our 50+ tx proof, and judges can verify it
independently."*

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

**Speaker note (30s):** *"We wired Circle's official Nanopayments SDK end
to end — seller and buyer. Ten lines of integration. The buyer deposits
once, then pays $0.001 per request. Gateway handles batched settlement
behind the scenes."*

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

**Speaker note (30s):** *"This is the margin argument. It's not close —
it's 2–4 orders of magnitude. Without Arc there's no business. With Arc
this is shippable tomorrow."*

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

**Speaker note (40s):** *"Everything here is real Circle infrastructure.
Zero custom rails. We want this to be the template every agent-economy
hackathon starts from next year. Thanks — questions?"*

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
