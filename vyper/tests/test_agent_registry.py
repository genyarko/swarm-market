"""
Titanoboa test suite for the Vyper AgentRegistry (ERC-8004).

Run:
    pip install titanoboa pytest
    pytest vyper/tests -q

The same contract surface is also exercised in production by the
`circle-titanoboa-sdk` bridge (see vyper/scripts/circle_boa_bridge.py),
which deploys the compiled bytecode through Circle's DC Wallets on Arc
or any other supported chain.
"""
import boa
import pytest


@pytest.fixture
def registry():
    return boa.load("vyper/contracts/AgentRegistry.vy")


@pytest.fixture
def alice():
    return boa.env.generate_address("alice")


@pytest.fixture
def bob():
    return boa.env.generate_address("bob")


@pytest.fixture
def validator():
    return boa.env.generate_address("validator")


def test_register_agent(registry, alice):
    with boa.env.prank(alice):
        agent_id = registry.register_agent("alice.agents.example", "ipfs://card-a")
    assert agent_id == 1
    assert registry.agent_id_of(alice) == 1
    a = registry.get_agent(1)
    assert a[1] == alice             # owner
    assert a[2] == "alice.agents.example"
    assert a[5] is True              # active


def test_cannot_double_register(registry, alice):
    with boa.env.prank(alice):
        registry.register_agent("a", "u")
        with boa.reverts("already_registered"):
            registry.register_agent("a2", "u2")


def test_feedback_and_average(registry, alice, bob):
    with boa.env.prank(alice):
        registry.register_agent("alice", "ipfs://a")
    interaction = b"\x01" * 32
    with boa.env.prank(bob):
        registry.give_feedback(1, 80, interaction, "ipfs://rev-1")
        registry.give_feedback(1, 100, interaction, "ipfs://rev-2")
    assert registry.feedback_count(1) == 2
    assert registry.score_sum(1) == 180
    assert registry.average_score(1) == 90


def test_invalid_score_rejected(registry, alice, bob):
    with boa.env.prank(alice):
        registry.register_agent("alice", "ipfs://a")
    with boa.env.prank(bob):
        with boa.reverts("invalid_score"):
            registry.give_feedback(1, 101, b"\x00" * 32, "")


def test_validation_flow(registry, alice, validator):
    with boa.env.prank(alice):
        registry.register_agent("alice", "ipfs://a")
    data_hash = b"\x02" * 32
    with boa.env.prank(alice):
        vid = registry.request_validation(1, data_hash, "ipfs://output")
    assert vid == 1

    with boa.env.prank(validator):
        registry.resolve_validation(vid, True, "ipfs://verdict")

    v = registry.get_validation(vid)
    assert v[5] == validator         # validator field
    assert v[6] == 1                 # state == APPROVED


def test_deactivate_blocks_feedback(registry, alice, bob):
    with boa.env.prank(alice):
        registry.register_agent("alice", "ipfs://a")
        registry.deactivate_agent()
    with boa.env.prank(bob):
        with boa.reverts("inactive_agent"):
            registry.give_feedback(1, 50, b"\x00" * 32, "")
