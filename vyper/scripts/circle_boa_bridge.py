"""
circle-titanoboa-sdk bridge: deploy Vyper agentic-payments contracts to any
Circle-supported chain via Developer-Controlled Wallets.

Flow:
  1. Compile the Vyper source with Titanoboa (`boa.load_partial`).
  2. Extract ABI + bytecode.
  3. Hand off to Circle's Smart Contract Platform SDK for deployment from a
     Circle-managed coordinator wallet — no private keys needed, same DC-wallet
     security model as the rest of the repo.

Usage:
    pip install titanoboa requests
    python vyper/scripts/circle_boa_bridge.py --contract AgentRegistry \\
        --blockchain ARC-TESTNET

Env:
    CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID

This script is intentionally small — think of it as a reference showing how
boa's compilation output plugs into Circle's deploy endpoint, which is the
core of what the (external) circle-titanoboa-sdk package automates.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import boa
import requests

CIRCLE_BASE = "https://api.circle.com/v1/w3s"


def compile_vyper(path: Path) -> tuple[list, str]:
    """Compile a .vy source with Titanoboa and return (abi, bytecode-hex)."""
    deployer = boa.load_partial(str(path))
    abi = deployer.abi
    bytecode = "0x" + deployer.compiler_data.bytecode.hex()
    return abi, bytecode


def deploy_via_circle(
    api_key: str,
    entity_secret_ciphertext: str,
    wallet_id: str,
    blockchain: str,
    name: str,
    abi: list,
    bytecode: str,
    constructor_params: list,
) -> dict:
    """POST to Circle SCP /deploy and poll until terminal."""
    url = f"{CIRCLE_BASE}/developer/deploy"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "name": name,
        "description": f"Vyper-{name}-via-titanoboa",
        "blockchain": blockchain,
        "walletId": wallet_id,
        "abiJson": json.dumps(abi),
        "bytecode": bytecode,
        "entitySecretCiphertext": entity_secret_ciphertext,
        "constructorParameters": constructor_params,
        "fee": {"type": "level", "config": {"feeLevel": "MEDIUM"}},
    }
    r = requests.post(url, headers=headers, json=body, timeout=30)
    r.raise_for_status()
    data = r.json().get("data", {})
    tx_id = data.get("transactionId") or data.get("id")
    contract_id = data.get("contractId")
    print(f"[circle] deploy tx {tx_id} (contract {contract_id})")

    terminal = {"COMPLETE", "FAILED", "CANCELLED", "DENIED"}
    while True:
        t = requests.get(
            f"{CIRCLE_BASE}/transactions/{tx_id}",
            headers=headers,
            timeout=15,
        ).json().get("data", {}).get("transaction", {})
        state = t.get("state", "UNKNOWN")
        print(f"[circle]   state={state}")
        if state in terminal:
            if state != "COMPLETE":
                raise RuntimeError(f"deploy ended {state}")
            return {
                "address": t.get("contractAddress") or t.get("destinationAddress"),
                "txHash": t.get("txHash"),
                "contractId": contract_id,
            }
        time.sleep(3)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--contract", default="AgentRegistry",
                   help="Vyper contract name (file in vyper/contracts)")
    p.add_argument("--blockchain", default=os.environ.get("CIRCLE_BLOCKCHAIN", "ARC-TESTNET"))
    p.add_argument("--constructor", default="[]",
                   help="JSON array of constructor parameters")
    args = p.parse_args()

    src = Path(f"vyper/contracts/{args.contract}.vy")
    if not src.exists():
        print(f"✗ source not found: {src}", file=sys.stderr)
        return 1

    api_key = os.environ["CIRCLE_API_KEY"]
    entity_secret = os.environ["CIRCLE_ENTITY_SECRET_CIPHERTEXT"]
    wallet_id = os.environ["CIRCLE_WALLET_ID"]

    print(f"[boa] compiling {src} …")
    abi, bytecode = compile_vyper(src)
    print(f"[boa] abi entries: {len(abi)}  bytecode: {len(bytecode) // 2 - 1} bytes")

    result = deploy_via_circle(
        api_key=api_key,
        entity_secret_ciphertext=entity_secret,
        wallet_id=wallet_id,
        blockchain=args.blockchain,
        name=args.contract,
        abi=abi,
        bytecode=bytecode,
        constructor_params=json.loads(args.constructor),
    )
    print("\n✅ deployed")
    print(f"   address: {result['address']}")
    print(f"   tx:      {result['txHash']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
