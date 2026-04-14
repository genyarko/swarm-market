# Security Scan — 2026-04-14

Scope: smart contract, server libs (circle, market, llm, config), agent loop, coordinator, dashboard server + static JS, scripts, committed artifacts.

## Secrets / git hygiene — OK

- `.env`, `wallets.json`, `entity-secret-ciphertext.txt` are gitignored and not in history.
- `deployments.json` is committed but contains only public addresses/tx hashes.
- Caveat unrelated to repo: `CIRCLE_API_KEY` (testnet), `CIRCLE_ENTITY_SECRET`, and `MISTRAL_API_KEY` appeared in Claude Code CLI output during the 2026-04-14 session. Rotate if that transcript is shared externally.

## High

### H1. No result verification before payment
**Location:** `scripts/run-agents.ts:56–86` (`autoApprover`).
The loop calls `approveAndPay` on any task in `Completed` status without checking the submitted result. `IMPLEMENTATION.md` planned a Claude-scored quality gate (≥7 approves); it is not implemented. A malicious specialist can bid, submit junk, and be paid.
**Fix:** fetch `resultCID`, send through an LLM grader, only call `approveAndPay` on pass.

### H2. Funds locked by stalled assignees
**Location:** `contracts/contracts/TaskMarket.sol`.
If a specialist calls `bidOnTask` and never calls `submitResult`, the task is stuck in `Assigned` forever and the escrowed USDC is unrecoverable. `cancelOpenTask` only works on `Open` status — there is no timeout, reclaim, or reassignment path.
**Fix:** add an assignment deadline (store `assignedAt` or a block number) and a `reclaimIfExpired(id)` that returns the escrow to the poster after N blocks, or a `reassign(id)` that resets status to `Open`.

### H3. Anyone can bid on any task
**Location:** `contracts/contracts/TaskMarket.sol` `bidOnTask`.
The contract does not enforce capability or whitelist bidders. An attacker can claim tasks they have no intent to fulfill, griefing the marketplace (compounds with H2).
**Fix:** maintain an on-chain whitelist of specialist addresses, or require the coordinator to pre-authorize bidders per task.

## Medium

### M1. Prompt injection surface
**Location:** `server/lib/llm.ts`, `server/agents/prompts.ts:4–30`.
Task inputs are concatenated into prompts without sanitization. Currently only the coordinator posts tasks, so the trust boundary is internal — but the contract allows any address to post. If task posting is opened up, attacker-controlled input can make the LLM emit arbitrary output. Results are trimmed to 900 chars and submitted on-chain; the dashboard escapes feed text in `dashboard/app.js:90`, so no XSS today.
**Fix:** delimit input clearly in the prompt template, or restrict `postTask` to coordinator-only on the contract.

### M2. Static server path-traversal defence is weak but sufficient
**Location:** `server/dashboard/server.ts:258`.
The regex replace on `..` is redundant; the real protection is the `startsWith(DASHBOARD_DIR)` check on the next line, which does catch traversal attempts after `path.join` normalization. Current behavior is safe.
**Fix:** drop the regex and rely on the `startsWith` check; or switch to `path.resolve` + a sandbox check.

### M3. No rate-limiting or connection cap on SSE
**Location:** `server/dashboard/server.ts` (`/events`, `/snapshot`).
CORS is `*` by design (public read-only dashboard). Nothing caps the number of open SSE clients — a peer could open many connections and exhaust sockets.
**Fix:** cap `clients` size (reject or 503 beyond N), add per-IP rate-limit. Acceptable to defer for a hackathon build.

## Low / informational

### L1. ERC-20 return-value assumption
**Location:** `TaskMarket.sol` `postTask`, `approveAndPay`, `cancelOpenTask`.
Code checks `usdc.transfer*` return values. USDC conforms, so fine. Using OpenZeppelin `SafeERC20` would make the contract robust to non-conforming tokens if the token address ever changes.

### L2. CEI pattern OK
`approveAndPay` and `cancelOpenTask` update status before the external transfer, so reentrancy is not exploitable.

### L3. No admin / pause
Intentional for decentralization; means a contract bug cannot be mitigated post-deploy.

### L4. `npm audit` not run
Run `npm audit --omit=dev` on both the root and `contracts/` workspaces to catch transitive CVEs.

## Recommended next steps (priority order)

1. Implement LLM-grader verification in `autoApprover` (addresses H1).
2. Add assignment deadline + reclaim path on the contract (addresses H2).
3. Run `npm audit --omit=dev` on root and `contracts/` and pin anything flagged (L4).
4. Whitelist specialist addresses or coordinator-gate bidding (addresses H3).
5. Restrict `postTask` to coordinator or sanitize inputs when third-party posting is enabled (addresses M1).
6. Cap SSE client count on dashboard (addresses M3).
