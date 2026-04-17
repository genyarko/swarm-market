// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry — ERC-8004 trust layer for autonomous agents
/// @notice Implements the three core ERC-8004 registries:
///         1. Identity Registry  — agents self-register with a resolvable
///            off-chain metadata URI (agent card, A2A endpoint, etc.).
///         2. Reputation Registry — clients record feedback tied to a
///            completed interaction (e.g. TaskMarket task id).
///         3. Validation Registry — third-party validators attest to the
///            correctness of an agent's output (stake-less attestations
///            are stored on-chain for downstream slashing / ranking).
/// @dev Reference spec: https://eips.ethereum.org/EIPS/eip-8004
///      This is a reference implementation — production deployments should
///      add access control for issuer roles and consider EAS integration.
contract AgentRegistry {
    // ─────────────────────── Identity ───────────────────────

    struct Agent {
        uint256 id;
        address owner;           // controlling wallet
        string  domain;          // e.g. "specialist-1.agents.example"
        string  metadataURI;     // ipfs://... or https://... agent card
        uint64  registeredAt;
        bool    active;
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256) public agentIdOf;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string domain, string metadataURI);
    event AgentUpdated(uint256 indexed agentId, string domain, string metadataURI);
    event AgentDeactivated(uint256 indexed agentId);

    error AlreadyRegistered();
    error NotAgentOwner();
    error UnknownAgent();

    function registerAgent(string calldata domain, string calldata metadataURI) external returns (uint256 id) {
        if (agentIdOf[msg.sender] != 0) revert AlreadyRegistered();
        id = nextAgentId++;
        _agents[id] = Agent({
            id: id,
            owner: msg.sender,
            domain: domain,
            metadataURI: metadataURI,
            registeredAt: uint64(block.timestamp),
            active: true
        });
        agentIdOf[msg.sender] = id;
        emit AgentRegistered(id, msg.sender, domain, metadataURI);
    }

    function updateAgent(string calldata domain, string calldata metadataURI) external {
        uint256 id = agentIdOf[msg.sender];
        if (id == 0) revert UnknownAgent();
        Agent storage a = _agents[id];
        if (a.owner != msg.sender) revert NotAgentOwner();
        a.domain = domain;
        a.metadataURI = metadataURI;
        emit AgentUpdated(id, domain, metadataURI);
    }

    function deactivateAgent() external {
        uint256 id = agentIdOf[msg.sender];
        if (id == 0) revert UnknownAgent();
        Agent storage a = _agents[id];
        if (a.owner != msg.sender) revert NotAgentOwner();
        a.active = false;
        emit AgentDeactivated(id);
    }

    function getAgent(uint256 id) external view returns (Agent memory) {
        return _agents[id];
    }

    function getAgentByAddress(address owner) external view returns (Agent memory) {
        uint256 id = agentIdOf[owner];
        if (id == 0) revert UnknownAgent();
        return _agents[id];
    }

    // ─────────────────────── Reputation ───────────────────────

    struct Feedback {
        uint256 agentId;
        address rater;
        uint8   score;           // 0-100
        bytes32 interactionId;   // e.g. keccak256("taskmarket", taskId)
        string  uri;             // optional off-chain review content
        uint64  timestamp;
    }

    Feedback[] private _feedback;
    mapping(uint256 => uint256[]) private _feedbackOf;     // agentId → indices
    mapping(uint256 => uint256) public scoreSum;           // agentId → sum
    mapping(uint256 => uint256) public feedbackCount;      // agentId → count

    event FeedbackGiven(
        uint256 indexed agentId,
        address indexed rater,
        uint8 score,
        bytes32 indexed interactionId,
        string uri
    );

    error InvalidScore();
    error InactiveAgent();

    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 interactionId,
        string calldata uri
    ) external {
        if (score > 100) revert InvalidScore();
        Agent storage a = _agents[agentId];
        if (a.id == 0) revert UnknownAgent();
        if (!a.active) revert InactiveAgent();
        uint256 idx = _feedback.length;
        _feedback.push(Feedback({
            agentId: agentId,
            rater: msg.sender,
            score: score,
            interactionId: interactionId,
            uri: uri,
            timestamp: uint64(block.timestamp)
        }));
        _feedbackOf[agentId].push(idx);
        scoreSum[agentId] += score;
        feedbackCount[agentId] += 1;
        emit FeedbackGiven(agentId, msg.sender, score, interactionId, uri);
    }

    function averageScore(uint256 agentId) external view returns (uint256) {
        uint256 n = feedbackCount[agentId];
        if (n == 0) return 0;
        return scoreSum[agentId] / n;
    }

    function getFeedback(uint256 idx) external view returns (Feedback memory) {
        return _feedback[idx];
    }

    function feedbackIndicesOf(uint256 agentId) external view returns (uint256[] memory) {
        return _feedbackOf[agentId];
    }

    // ─────────────────────── Validation ───────────────────────

    enum ValidationState { Requested, Approved, Rejected }

    struct ValidationRequest {
        uint256 id;
        uint256 agentId;
        address requester;
        bytes32 dataHash;        // commit to the output being validated
        string  uri;              // where to fetch the output
        address validator;       // set on response
        ValidationState state;
        uint64  requestedAt;
        uint64  respondedAt;
        string  verdictURI;      // optional validator report
    }

    uint256 public nextValidationId = 1;
    mapping(uint256 => ValidationRequest) private _validations;

    event ValidationRequested(
        uint256 indexed validationId,
        uint256 indexed agentId,
        address indexed requester,
        bytes32 dataHash,
        string uri
    );
    event ValidationResolved(
        uint256 indexed validationId,
        address indexed validator,
        ValidationState state,
        string verdictURI
    );

    error UnknownValidation();
    error NotPending();

    function requestValidation(
        uint256 agentId,
        bytes32 dataHash,
        string calldata uri
    ) external returns (uint256 id) {
        if (_agents[agentId].id == 0) revert UnknownAgent();
        id = nextValidationId++;
        _validations[id] = ValidationRequest({
            id: id,
            agentId: agentId,
            requester: msg.sender,
            dataHash: dataHash,
            uri: uri,
            validator: address(0),
            state: ValidationState.Requested,
            requestedAt: uint64(block.timestamp),
            respondedAt: 0,
            verdictURI: ""
        });
        emit ValidationRequested(id, agentId, msg.sender, dataHash, uri);
    }

    function resolveValidation(uint256 validationId, bool approved, string calldata verdictURI) external {
        ValidationRequest storage v = _validations[validationId];
        if (v.id == 0) revert UnknownValidation();
        if (v.state != ValidationState.Requested) revert NotPending();
        v.validator = msg.sender;
        v.state = approved ? ValidationState.Approved : ValidationState.Rejected;
        v.respondedAt = uint64(block.timestamp);
        v.verdictURI = verdictURI;
        emit ValidationResolved(validationId, msg.sender, v.state, verdictURI);
    }

    function getValidation(uint256 validationId) external view returns (ValidationRequest memory) {
        return _validations[validationId];
    }
}
