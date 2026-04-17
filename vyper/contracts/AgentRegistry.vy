# pragma version ^0.4.0
# @title AgentRegistry (Vyper reference) — ERC-8004 trust layer
# @notice Vyper port of the Solidity reference. Designed to be exercised by
#         Titanoboa from Python and by the circle-titanoboa-sdk bridge so the
#         same contract surface can run in sim and on Arc / other EVM chains.
# @dev    Mirrors the semantics of contracts/contracts/AgentRegistry.sol.

# ───────────────────────── Identity ─────────────────────────

struct Agent:
    id: uint256
    owner: address
    domain: String[64]
    metadataURI: String[256]
    registeredAt: uint64
    active: bool

next_agent_id: public(uint256)
agents: HashMap[uint256, Agent]
agent_id_of: public(HashMap[address, uint256])

event AgentRegistered:
    agentId: indexed(uint256)
    owner: indexed(address)
    domain: String[64]
    metadataURI: String[256]

event AgentUpdated:
    agentId: indexed(uint256)
    domain: String[64]
    metadataURI: String[256]

event AgentDeactivated:
    agentId: indexed(uint256)

# ───────────────────────── Reputation ─────────────────────────

struct Feedback:
    agentId: uint256
    rater: address
    score: uint8
    interactionId: bytes32
    uri: String[256]
    timestamp: uint64

feedback_count: public(HashMap[uint256, uint256])
score_sum: public(HashMap[uint256, uint256])
_feedback_of: HashMap[uint256, HashMap[uint256, Feedback]]

event FeedbackGiven:
    agentId: indexed(uint256)
    rater: indexed(address)
    score: uint8
    interactionId: indexed(bytes32)
    uri: String[256]

# ───────────────────────── Validation ─────────────────────────

flag ValidationState:
    REQUESTED
    APPROVED
    REJECTED

struct ValidationRequest:
    id: uint256
    agentId: uint256
    requester: address
    dataHash: bytes32
    uri: String[256]
    validator: address
    state: ValidationState
    requestedAt: uint64
    respondedAt: uint64
    verdictURI: String[256]

next_validation_id: public(uint256)
validations: HashMap[uint256, ValidationRequest]

event ValidationRequested:
    validationId: indexed(uint256)
    agentId: indexed(uint256)
    requester: indexed(address)
    dataHash: bytes32
    uri: String[256]

event ValidationResolved:
    validationId: indexed(uint256)
    validator: indexed(address)
    state: ValidationState
    verdictURI: String[256]


@deploy
def __init__():
    self.next_agent_id = 1
    self.next_validation_id = 1


# ───────────────────────── Identity API ─────────────────────────

@external
def register_agent(domain: String[64], metadataURI: String[256]) -> uint256:
    assert self.agent_id_of[msg.sender] == 0, "already_registered"
    id: uint256 = self.next_agent_id
    self.next_agent_id = id + 1
    self.agents[id] = Agent(
        id=id,
        owner=msg.sender,
        domain=domain,
        metadataURI=metadataURI,
        registeredAt=convert(block.timestamp, uint64),
        active=True,
    )
    self.agent_id_of[msg.sender] = id
    log AgentRegistered(agentId=id, owner=msg.sender, domain=domain, metadataURI=metadataURI)
    return id


@external
def update_agent(domain: String[64], metadataURI: String[256]):
    id: uint256 = self.agent_id_of[msg.sender]
    assert id != 0, "unknown_agent"
    a: Agent = self.agents[id]
    assert a.owner == msg.sender, "not_owner"
    a.domain = domain
    a.metadataURI = metadataURI
    self.agents[id] = a
    log AgentUpdated(agentId=id, domain=domain, metadataURI=metadataURI)


@external
def deactivate_agent():
    id: uint256 = self.agent_id_of[msg.sender]
    assert id != 0, "unknown_agent"
    a: Agent = self.agents[id]
    assert a.owner == msg.sender, "not_owner"
    a.active = False
    self.agents[id] = a
    log AgentDeactivated(agentId=id)


@view
@external
def get_agent(id: uint256) -> Agent:
    return self.agents[id]


# ───────────────────────── Reputation API ─────────────────────────

@external
def give_feedback(agentId: uint256, score: uint8, interactionId: bytes32, uri: String[256]):
    assert score <= 100, "invalid_score"
    a: Agent = self.agents[agentId]
    assert a.id != 0, "unknown_agent"
    assert a.active, "inactive_agent"
    idx: uint256 = self.feedback_count[agentId]
    self._feedback_of[agentId][idx] = Feedback(
        agentId=agentId,
        rater=msg.sender,
        score=score,
        interactionId=interactionId,
        uri=uri,
        timestamp=convert(block.timestamp, uint64),
    )
    self.feedback_count[agentId] = idx + 1
    self.score_sum[agentId] += convert(score, uint256)
    log FeedbackGiven(agentId=agentId, rater=msg.sender, score=score, interactionId=interactionId, uri=uri)


@view
@external
def average_score(agentId: uint256) -> uint256:
    n: uint256 = self.feedback_count[agentId]
    if n == 0:
        return 0
    return self.score_sum[agentId] // n


@view
@external
def get_feedback(agentId: uint256, idx: uint256) -> Feedback:
    return self._feedback_of[agentId][idx]


# ───────────────────────── Validation API ─────────────────────────

@external
def request_validation(agentId: uint256, dataHash: bytes32, uri: String[256]) -> uint256:
    assert self.agents[agentId].id != 0, "unknown_agent"
    id: uint256 = self.next_validation_id
    self.next_validation_id = id + 1
    self.validations[id] = ValidationRequest(
        id=id,
        agentId=agentId,
        requester=msg.sender,
        dataHash=dataHash,
        uri=uri,
        validator=empty(address),
        state=ValidationState.REQUESTED,
        requestedAt=convert(block.timestamp, uint64),
        respondedAt=0,
        verdictURI="",
    )
    log ValidationRequested(validationId=id, agentId=agentId, requester=msg.sender, dataHash=dataHash, uri=uri)
    return id


@external
def resolve_validation(validationId: uint256, approved: bool, verdictURI: String[256]):
    v: ValidationRequest = self.validations[validationId]
    assert v.id != 0, "unknown_validation"
    assert v.state == ValidationState.REQUESTED, "not_pending"
    v.validator = msg.sender
    v.state = ValidationState.APPROVED if approved else ValidationState.REJECTED
    v.respondedAt = convert(block.timestamp, uint64)
    v.verdictURI = verdictURI
    self.validations[validationId] = v
    log ValidationResolved(validationId=validationId, validator=msg.sender, state=v.state, verdictURI=verdictURI)


@view
@external
def get_validation(validationId: uint256) -> ValidationRequest:
    return self.validations[validationId]
