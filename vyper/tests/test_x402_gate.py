"""
Titanoboa test for the Vyper x402PaymentGate — verifies on-chain settlement
of an EIP-3009 authorization.

Run:
    pip install titanoboa pytest eth-account
    pytest vyper/tests/test_x402_gate.py -q
"""
import boa
import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data


# Minimal EIP-3009 USDC mock (Vyper) — inline so the test is self-contained.
MOCK_USDC_SOURCE = """
# pragma version ^0.4.0

event Transfer:
    _from: indexed(address)
    _to: indexed(address)
    value: uint256

name: public(String[32])
version: public(String[8])
DOMAIN_SEPARATOR: public(bytes32)
balanceOf: public(HashMap[address, uint256])
authorization_used: public(HashMap[address, HashMap[bytes32, bool]])

TRANSFER_WITH_AUTH_TYPEHASH: constant(bytes32) = keccak256(
    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
)

@deploy
def __init__():
    self.name = "USDC"
    self.version = "2"
    self.DOMAIN_SEPARATOR = keccak256(
        concat(
            keccak256(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(b"USDC"),
            keccak256(b"2"),
            convert(chain.id, bytes32),
            convert(self, bytes32),
        )
    )

@external
def mint(to: address, amount: uint256):
    self.balanceOf[to] += amount
    log Transfer(_from=empty(address), _to=to, value=amount)

@external
def transferWithAuthorization(
    _from: address,
    _to: address,
    value: uint256,
    validAfter: uint256,
    validBefore: uint256,
    nonce: bytes32,
    v: uint8,
    r: bytes32,
    s: bytes32,
):
    assert block.timestamp > validAfter, "not_yet_valid"
    assert block.timestamp < validBefore, "expired"
    assert not self.authorization_used[_from][nonce], "used"
    struct_hash: bytes32 = keccak256(
        concat(
            TRANSFER_WITH_AUTH_TYPEHASH,
            convert(_from, bytes32),
            convert(_to, bytes32),
            convert(value, bytes32),
            convert(validAfter, bytes32),
            convert(validBefore, bytes32),
            nonce,
        )
    )
    digest: bytes32 = keccak256(concat(b"\\x19\\x01", self.DOMAIN_SEPARATOR, struct_hash))
    signer: address = ecrecover(digest, convert(v, uint256), convert(r, uint256), convert(s, uint256))
    assert signer == _from, "bad_sig"
    self.authorization_used[_from][nonce] = True
    assert self.balanceOf[_from] >= value, "balance"
    self.balanceOf[_from] -= value
    self.balanceOf[_to] += value
    log Transfer(_from=_from, _to=_to, value=value)
"""


@pytest.fixture
def deployed():
    # Payer with a known private key so we can sign EIP-3009 authorizations.
    payer_acct = Account.create()
    boa.env.set_balance(payer_acct.address, 10**18)

    payee = boa.env.generate_address("payee")
    usdc = boa.loads(MOCK_USDC_SOURCE)
    gate = boa.load("vyper/contracts/x402PaymentGate.vy", usdc.address, payee)

    usdc.mint(payer_acct.address, 10_000_000)  # 10 USDC
    return usdc, gate, payer_acct, payee


def test_settle_x402_exact_payment(deployed):
    usdc, gate, payer, payee = deployed

    now = boa.env.evm.patch.timestamp
    valid_after = now - 5
    valid_before = now + 120
    value = 1000  # 0.001 USDC (6 decimals)
    nonce = (12345).to_bytes(32, "big")

    domain = {
        "name": "USDC",
        "version": "2",
        "chainId": boa.env.evm.patch.chain_id,
        "verifyingContract": usdc.address,
    }
    types = {
        "TransferWithAuthorization": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
            {"name": "nonce", "type": "bytes32"},
        ],
    }
    message = {
        "from": payer.address,
        "to": payee,
        "value": value,
        "validAfter": valid_after,
        "validBefore": valid_before,
        "nonce": nonce,
    }
    signable = encode_typed_data(
        domain_data=domain,
        message_types=types,
        message_data=message,
    )
    sig = Account.sign_message(signable, payer.key)

    gate.settle(
        payer.address, value, valid_after, valid_before, nonce,
        sig.v, sig.r.to_bytes(32, "big"), sig.s.to_bytes(32, "big"),
    )

    assert usdc.balanceOf(payee) == value
    assert gate.total_settled() == value
