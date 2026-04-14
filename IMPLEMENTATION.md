# Agent Swarm Task Market — Implementation Plan

## Project Overview

A decentralized micro-task marketplace where a **Coordinator Agent** decomposes work into atomic tasks and posts them to a marketplace. **Specialist Agents** (summarizers, classifiers, translators, sentiment analyzers) bid on and complete tasks, receiving per-completion USDC payments settled on Arc via Circle Nanopayments. The entire loop — post → bid → assign → complete → verify → pay — happens autonomously with no batching or escrow.

---

1. Fund the coordinator with Arc Testnet USDC:
       https://faucet.circle.com  →  Arc Testnet  →  0x7cc91c5b241db69f2aedd3d0342e7f8b6a9d558e
  2. Run: npm run send-nanopayment
PS C:\Users\genya\Downloads\swarm-agent>

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND DASHBOARD                 │
│  Live task feed · Agent activity · USDC flow graph   │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket
┌──────────────────────▼──────────────────────────────┐
│                  TASK MARKETPLACE SERVER              │
│  Task Queue · Bidding Engine · Verification · Events │
└───┬──────────┬───────────────┬───────────────┬──────┘
    │          │               │               │
┌───▼───┐ ┌───▼───┐     ┌─────▼─────┐   ┌─────▼─────┐
│Coord. │ │Agents │     │  Payment  │   │  Claude   │
│Agent  │ │(5-10) │     │  Service  │   │  API      │
└───────┘ └───────┘     │(Nanopay)  │   │(Verify)   │
                        └─────┬─────┘   └───────────┘
                              │
                        ┌─────▼─────┐
                        │    Arc    │
                        │  (USDC)   │
                        └───────────┘
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Smart Contracts | Solidity (Arc is EVM-compatible) | Task registry + atomic pay-on-completion |
| Backend / Agents | Node.js + TypeScript | Fast async, good Web3 libraries |
| Agent Intelligence | Claude API (Sonnet) | Summarization, classification, translation |
| Wallets | Circle Wallets API | Programmatic wallets for each agent |
| Payments | Circle Nanopayments | Sub-cent settlement, gas-free |
| Frontend | React (Vite) | Live dashboard for demo day |
| Real-time | WebSocket (Socket.io) | Stream task/payment events to dashboard |
| Database | SQLite (or in-memory) | Lightweight, no infra overhead for hackathon |

---

## Phase 0 — Environment & Accounts (Day 1: Mon Apr 20)

**Goal:** Everything boots, wallets exist, you can send USDC on Arc testnet.

### Steps

1. **Set up repo structure**
   ```
   agent-swarm-market/
   ├── contracts/          # Solidity smart contracts
   ├── server/             # Marketplace backend + agent orchestrator
   │   ├── agents/         # Individual agent logic
   │   ├── marketplace/    # Task queue, bidding, verification
   │   ├── payments/       # Circle Nanopayments integration
   │   └── index.ts        # Entry point
   ├── dashboard/          # React frontend
   ├── scripts/            # Deploy, seed, demo scripts
   └── README.md
   ```

2. **Configure Circle Developer Console**
   - Create a Circle developer account at [developers.circle.com](https://developers.circle.com)
   - Get API keys for Arc testnet
   - Familiarize with Nanopayments SDK/docs from the hackathon resource links

3. **Create programmatic wallets**
   - 1 Coordinator wallet (posts tasks, holds the "budget")
   - 5–10 Specialist Agent wallets (receive payments)
   - 1 Marketplace treasury wallet (optional, for fee collection)
   - Use Circle Wallets API to generate these programmatically

4. **Fund wallets with testnet USDC**
   - Fund the Coordinator wallet with enough USDC for the demo (e.g., 10 USDC = thousands of micro-tasks)
   - Verify you can send a basic USDC transfer between wallets on Arc

5. **Verify Nanopayments flow**
   - Execute a single sub-cent Nanopayment (e.g., $0.001) from Coordinator → Agent
   - Confirm settlement on Arc
   - Log the transaction hash

### Deliverable
> ✅ All wallets funded. A script that sends $0.001 USDC from Coordinator to Agent and prints the tx hash.

---

## Phase 1 — Smart Contract: TaskMarket (Day 1–2: Mon–Tue)

**Goal:** On-chain task registry with atomic pay-on-completion.

### Contract Design

```solidity
// TaskMarket.sol — simplified structure

struct Task {
    uint256 id;
    address poster;          // Coordinator
    address assignee;        // Specialist Agent
    string  taskType;        // "summarize" | "classify" | "translate" | "sentiment"
    string  inputCID;        // IPFS CID or off-chain reference to input data
    uint256 rewardWei;       // Payment in USDC (6 decimals)
    uint8   status;          // 0=Open, 1=Assigned, 2=Completed, 3=Paid
}

// Core functions:
// postTask(taskType, inputCID, rewardWei) → creates task, locks reward
// bidOnTask(taskId) → agent claims task
// submitResult(taskId, resultCID) → agent submits work
// approveAndPay(taskId) → coordinator approves, USDC transfers atomically
```

### Steps

1. **Write the TaskMarket contract**
   - `postTask`: Coordinator deposits reward USDC into contract, task goes to Open
   - `bidOnTask`: First valid specialist claims it (simple first-come-first-served for MVP)
   - `submitResult`: Agent submits result hash/CID, status → Completed
   - `approveAndPay`: Coordinator (or automated verifier) approves, contract sends USDC to agent atomically

2. **Keep it minimal**
   - No complex bidding auction (wastes time)
   - No dispute resolution (out of scope)
   - First-come-first-served assignment is fine for demo
   - Events on every state change (for dashboard)

3. **Deploy to Arc testnet**
   - Use Hardhat or Foundry
   - Verify contract on explorer
   - Save contract address + ABI

4. **Write integration tests**
   - Post a task → bid → submit → approve → verify USDC moved
   - Post 10 tasks rapidly → verify all settle correctly

### Deliverable
> ✅ Deployed TaskMarket contract on Arc testnet. A script that runs a full task lifecycle end-to-end.

---

## Phase 2 — Marketplace Server (Day 2–3: Tue–Wed)

**Goal:** Off-chain orchestrator that coordinates the task lifecycle and talks to the contract.

### Components

#### 2A. Task Queue Manager
```
- Receives bulk work from Coordinator (e.g., "process these 50 documents")
- Decomposes into atomic tasks with type + input data
- Posts each task to the smart contract
- Tracks task state via contract events
```

#### 2B. Agent Registry
```
- Registers each specialist agent with:
  - Wallet address
  - Capabilities: ["summarize", "classify", "translate", "sentiment"]
  - Current status: idle | working
  - Performance stats: tasks completed, avg time
```

#### 2C. Matching Engine
```
- When a task is posted, notify eligible agents
- Agent bids (calls bidOnTask on-chain)
- Simple round-robin or fastest-response wins
```

#### 2D. Verification Service
```
- When agent submits result:
  - Run a lightweight quality check (e.g., call Claude to score the output 1-10)
  - If score ≥ 7: call approveAndPay
  - If score < 7: flag for re-assignment (stretch goal)
```

### Steps

1. **Set up Express/Fastify server with TypeScript**

2. **Implement event listener for TaskMarket contract**
   - Listen for TaskPosted, TaskAssigned, TaskCompleted, TaskPaid events
   - Update local state + push to WebSocket

3. **Build the Task Queue Manager**
   - API endpoint: `POST /jobs` — accepts a bulk job (list of documents/texts)
   - Decomposes into individual tasks
   - Posts each to contract via Nanopayments

4. **Build the Agent Registry**
   - On startup, register all agents with their wallets + capabilities
   - Track idle/busy state

5. **Build the Matching Engine**
   - On TaskPosted event → find idle agent with matching capability → trigger bid

6. **Build the Verification Service**
   - On result submission → send original input + agent output to Claude API
   - Prompt: "Rate this {taskType} output 1-10 for quality. Respond with just the number."
   - Approve if passing threshold

### Deliverable
> ✅ Server that can accept a bulk job, decompose it, post tasks, match agents, and verify results. Full lifecycle running off-chain + on-chain together.

---

## Phase 3 — Specialist Agents (Day 3–4: Wed–Thu)

**Goal:** 5–10 autonomous agents that poll for tasks, do real AI work, and submit results.

### Agent Types

| Agent | Capability | What It Does | Reward |
|---|---|---|---|
| Summarizer × 2 | `summarize` | Condenses text to 2–3 sentences | $0.003 |
| Classifier × 2 | `classify` | Categorizes text (topic, sentiment, intent) | $0.002 |
| Translator × 2 | `translate` | Translates text to a target language | $0.004 |
| Sentiment × 1 | `sentiment` | Returns sentiment score + explanation | $0.002 |
| Extractor × 1 | `extract` | Pulls key entities/facts from text | $0.003 |

### Agent Lifecycle (each agent runs this loop)

```
while (true) {
  1. Poll marketplace for open tasks matching my capability
  2. If task found → call bidOnTask(taskId) on-chain
  3. If I won the bid:
     a. Fetch input data
     b. Call Claude API with task-specific prompt
     c. Store result
     d. Call submitResult(taskId, resultHash) on-chain
  4. Wait for payment confirmation event
  5. Log: "Earned $0.003 for task #42 (summarize)" 
  6. Brief cooldown → repeat
}
```

### Steps

1. **Create base Agent class**
   ```typescript
   class SpecialistAgent {
     wallet: CircleWallet;
     capabilities: string[];
     status: 'idle' | 'working';
     
     async pollForTasks(): Promise<Task | null>;
     async executeTask(task: Task): Promise<string>;
     async submitResult(taskId: string, result: string): Promise<void>;
   }
   ```

2. **Implement each specialist as a subclass**
   - Each overrides `executeTask` with a specific Claude prompt
   - Summarizer: "Summarize the following text in 2-3 concise sentences: {input}"
   - Classifier: "Classify this text into one of: [tech, business, science, politics, entertainment]. Return JSON: {category, confidence}"
   - Translator: "Translate to Spanish: {input}"
   - etc.

3. **Run agents as concurrent processes**
   - Use Node.js worker threads or just concurrent async loops
   - Each agent has its own wallet + its own polling interval (stagger to avoid collisions)

4. **Add logging**
   - Every agent action logged with timestamp, task ID, USDC earned
   - This feeds the dashboard and the demo narrative

### Deliverable
> ✅ 5–10 agents running concurrently, picking up tasks, doing real AI work via Claude, submitting results, and getting paid in USDC on Arc.

---

## Phase 4 — Coordinator Agent (Day 4: Thu)

**Goal:** The Coordinator autonomously generates and posts tasks, creating continuous economic activity.

### Coordinator Behavior

```
1. Load a dataset of documents/texts (pre-seeded, ~100 items)
2. For each item, decide which task types to apply:
   - Long text → summarize + extract + sentiment
   - Short text → classify + sentiment
   - Foreign text → translate + summarize
3. Post each task to the marketplace with appropriate reward
4. Monitor completion events
5. Aggregate results into a "processed dataset"
6. Report: "Processed 100 items via 250 micro-tasks, total cost: $0.62"
```

### Steps

1. **Create a seed dataset**
   - 50–100 text snippets (news articles, product reviews, multilingual content)
   - Store as JSON file

2. **Build the Coordinator Agent**
   - Reads dataset
   - Generates task plan per item (which agent types needed)
   - Posts tasks in controlled batches (10 at a time to keep flow visible)
   - Tracks budget spent

3. **Add configurable pacing**
   - For demo: post tasks every 2–3 seconds so the audience can see flow
   - For stress test: burst 50 tasks at once to show throughput

### Deliverable
> ✅ Coordinator posting tasks from a real dataset, agents completing them, USDC flowing — the full autonomous loop running hands-free.

---

## Phase 5 — Live Dashboard (Day 4–5: Thu–Fri)

**Goal:** A visually compelling real-time dashboard for demo day.

### Dashboard Panels

```
┌──────────────────────────────────────────────────────────┐
│  AGENT SWARM TASK MARKET                    Total: $0.62 │
├────────────────────┬─────────────────────────────────────┤
│                    │                                     │
│   AGENT STATUS     │         LIVE TASK FEED              │
│                    │                                     │
│  🟢 Summarizer-1   │  ✅ Task #47 summarize → Agent-3    │
│  🔵 Summarizer-2   │  💰 $0.003 paid → 0x7a2...         │
│  🟢 Classifier-1   │  📋 Task #48 classify  → pending   │
│  🔵 Translator-1   │  ✅ Task #46 translate → Agent-5    │
│  🟢 Sentiment-1    │  💰 $0.004 paid → 0xa1f...         │
│  ...               │  ...                                │
│                    │                                     │
├────────────────────┼─────────────────────────────────────┤
│                    │                                     │
│  USDC FLOW GRAPH   │       STATISTICS                    │
│                    │                                     │
│  ┌─ Coordinator    │  Tasks Posted:     142              │
│  │   $0.62 out     │  Tasks Completed:  138              │
│  ├─► Agent-1       │  Avg Completion:   1.2s             │
│  │    $0.12        │  Avg Cost/Task:    $0.0028          │
│  ├─► Agent-2       │  Throughput:       2.3 tasks/sec    │
│  │    $0.09        │  Gas Cost (trad):  $6.90 ← THIS    │
│  └─► ...           │  Gas Cost (Arc):   $0.00 ✅         │
│                    │  Savings:          99.99%           │
│                    │                                     │
└────────────────────┴─────────────────────────────────────┘
```

### The Killer Stat (for judges)

**"Gas Cost Comparison"** — Show in real time:
- Traditional L1: 138 transactions × $0.05 avg gas = **$6.90 in gas alone** (more than the task rewards themselves)
- On Arc with Nanopayments: **$0.00 gas overhead**
- This is the margin argument. Display it prominently.

### Steps

1. **Scaffold React app with Vite**
2. **Connect WebSocket to marketplace server**
3. **Build panels:**
   - Agent status cards (idle/working, tasks completed, USDC earned)
   - Live task feed (scrolling log of events)
   - USDC flow visualization (animated connections between coordinator and agents)
   - Statistics panel with the gas comparison counter
4. **Polish for demo day**
   - Dark theme, smooth animations
   - Large fonts readable from a projector
   - Auto-scrolling feed

### Deliverable
> ✅ A beautiful real-time dashboard that tells the economic story at a glance.

---

## Phase 6 — Demo Script & Polish (Day 5–6: Fri–Sat Apr 25–26)

**Goal:** Rehearsed, bulletproof demo.

### Demo Flow (3–5 minutes)

| Time | Action | What Audience Sees |
|---|---|---|
| 0:00 | "We built an autonomous task marketplace where AI agents transact in USDC." | Title slide |
| 0:30 | Start the Coordinator. It begins posting tasks. | Dashboard lights up: tasks appearing |
| 1:00 | Agents start claiming and completing tasks. | Agent cards go active, feed scrolling |
| 1:30 | Zoom into a single task lifecycle. | Trace one task: post → bid → AI work → verify → pay |
| 2:00 | Show the USDC flow: real money moving per-completion. | Animated flow graph, wallet balances updating |
| 2:30 | Hit the gas comparison stat hard. | "138 tasks. $0 gas. On Ethereum, that's $6.90 wasted." |
| 3:00 | Show the aggregated output — "We processed 100 documents for $0.62" | Results panel |
| 3:30 | Wrap: "This is the agent economy. Machines doing real work, getting paid per-action, settling in real time." | Applause slide |

### Pre-Demo Checklist

- [ ] All agent wallets funded
- [ ] Seed dataset loaded
- [ ] Server, agents, and dashboard all start with one command (`npm run demo`)
- [ ] Fallback: pre-recorded video of a successful run
- [ ] README with setup instructions, architecture diagram, and screenshots

### Submission Artifacts

- [ ] Working demo (live or recorded)
- [ ] GitHub repo with README
- [ ] Architecture explanation
- [ ] Margin analysis document (why this fails with gas)
- [ ] Feedback form completed (for the $500 USDC feedback prize)

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Nanopayments SDK issues | Start integration Day 1; fall back to direct USDC transfers if needed |
| Arc testnet downtime | Cache recent tx hashes; show recorded demo as backup |
| Claude API rate limits | Pre-generate some results; use caching for repeated task types |
| Smart contract bugs | Keep contract minimal; test heavily on Day 2 |
| Demo-day nerves | Single `npm run demo` command; rehearse 3+ times |

---

## Daily Schedule

| Day | Date | Focus | Milestone |
|---|---|---|---|
| 1 | Mon Apr 20 | Setup, wallets, first Nanopayment | ✅ Money moves on Arc |
| 2 | Tue Apr 21 | Smart contract + marketplace server | ✅ Full task lifecycle on-chain |
| 3 | Wed Apr 22 | Specialist agents + Claude integration | ✅ Agents doing real AI work |
| 4 | Thu Apr 23 | Coordinator + dashboard | ✅ Autonomous loop running |
| 5 | Fri Apr 24 | Polish dashboard + demo script | ✅ Demo-ready |
| 6 | Sat Apr 25 | On-site build, refine, rehearse | ✅ Battle-tested |
| 7 | Sun Apr 26 | Demo day | 🏆 Ship it |

---

## Key Metrics for Judges

These numbers should be visible on your dashboard and in your submission:

1. **Transaction count**: 50+ on-chain transactions (aim for 150+)
2. **Per-task cost**: $0.002–$0.004 per task
3. **Gas savings**: 99.9%+ vs traditional L1
4. **Throughput**: 2+ tasks/second sustained
5. **Agent count**: 5–10 autonomous agents
6. **Total economic activity**: ~$0.50–$1.00 across 200+ tasks
7. **Zero human intervention** after pressing "start"


The CLI keeps flipping into interactive mode despite the flags (Git Bash on Windows — TTY detection issue) and the -r flag seems to need an extra auth scope the CLI doesn't   currently have.                                                                                                                                                            
                                                                                                                                                                              
  Let me switch to a hybrid approach: you create the empty services in the UI (30 sec), I set vars + start commands via CLI.                                                                                                                                                                                                                                
  In the Railway web UI, impartial-courage project:                                                                                                                             1. Click "+ Create" or the "+" button → Empty Service → name it agents                                                                                                      
  2. Same thing for coordinator                                                                                                                                                 3. For each: Settings → Source → Connect Repo → genyarko/swarm-market                                                                                                       

  (Don't set any variables or start command yet — I'll do that via CLI.)

  Tell me when both services exist and I'll run the CLI steps.