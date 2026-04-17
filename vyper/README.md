# Vyper reference implementations

Vyper ports of the two trust-layer contracts, wired up for Titanoboa testing
and for deployment through Circle's Developer-Controlled Wallets.

## Contracts

| File | Purpose |
|---|---|
| `contracts/AgentRegistry.vy` | ERC-8004 identity / reputation / validation registry |
| `contracts/x402PaymentGate.vy` | On-chain settlement of x402 EIP-3009 authorizations |

## Tooling

| Tool | How this repo uses it |
|---|---|
| **[titanoboa](https://github.com/vyperlang/titanoboa)** | Python-native EVM simulator. Runs `tests/test_*.py` against the Vyper sources directly — no Hardhat, no local node. |
| **[circle-titanoboa-sdk](https://github.com/circle-fin/circle-titanoboa-sdk)** | Bridge that compiles Vyper with Titanoboa and deploys the bytecode through Circle's Smart Contract Platform API. `scripts/circle_boa_bridge.py` is a self-contained reference implementation of that pattern — swap it for the upstream SDK when it's published. |
| **[vyper-agentic-payments](https://github.com/vyperlang/vyper-agentic-payments)** | Reference patterns for agent-driven payment flows in Vyper. `x402PaymentGate.vy` follows this pattern: agents earn USDC via EIP-3009 authorizations, which the gate settles on-chain on behalf of the resource provider. |
| **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** | Trust layer standard (identity + reputation + validation) for autonomous agents. `AgentRegistry.vy` is a reference implementation — matches the Solidity version in `contracts/contracts/AgentRegistry.sol` ABI-for-ABI. |

## Running the tests

```bash
pip install titanoboa pytest eth-account
pytest vyper/tests -q
```

## Deploying via Circle DC Wallets

```bash
pip install titanoboa requests
export CIRCLE_API_KEY=...
export CIRCLE_ENTITY_SECRET_CIPHERTEXT=...
export CIRCLE_WALLET_ID=...
python vyper/scripts/circle_boa_bridge.py --contract AgentRegistry --blockchain ARC-TESTNET
```

The bridge works for any Circle-supported chain — pass `--blockchain BASE-SEPOLIA`,
`MATIC-AMOY`, etc. See `server/lib/chains.ts` for the full chain registry.
