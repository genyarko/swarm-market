# pragma version ^0.4.0
# @title x402PaymentGate (Vyper reference) — on-chain settlement of x402 payments
# @notice Receives EIP-3009 `transferWithAuthorization` payloads proxied from an
#         x402 facilitator and settles them against a USDC-compatible token.
#         Pairs with server/lib/x402.ts — the off-chain facilitator does the
#         verification, this contract finalizes settlement when the resource
#         provider wants an on-chain receipt.
# @dev    This is a reference for the vyper-agentic-payments pattern:
#         agents earn x402 micropayments without custodial rails.

interface IERC20WithAuth:
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
    ): nonpayable
    def balanceOf(account: address) -> uint256: view


asset: public(IERC20WithAuth)
payee: public(address)
total_settled: public(uint256)

event PaymentSettled:
    payer: indexed(address)
    payee: indexed(address)
    value: uint256
    nonce: indexed(bytes32)


@deploy
def __init__(asset_: address, payee_: address):
    self.asset = IERC20WithAuth(asset_)
    self.payee = payee_


@external
def settle(
    payer: address,
    value: uint256,
    validAfter: uint256,
    validBefore: uint256,
    nonce: bytes32,
    v: uint8,
    r: bytes32,
    s: bytes32,
):
    """
    @notice Submit a signed x402 exact-scheme authorization and pull the funds
            from the payer into the resource provider's payee address.
    @dev    Anyone may relay; the authorization is self-authenticating.
    """
    assert value > 0, "zero_value"
    extcall self.asset.transferWithAuthorization(
        payer, self.payee, value, validAfter, validBefore, nonce, v, r, s
    )
    self.total_settled += value
    log PaymentSettled(payer=payer, payee=self.payee, value=value, nonce=nonce)
