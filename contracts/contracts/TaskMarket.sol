// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAgentRegistry {
    function agentIdOf(address owner) external view returns (uint256);
    function giveFeedback(uint256 agentId, uint8 score, bytes32 interactionId, string calldata uri) external;
}

/// @title TaskMarket — atomic pay-on-completion micro-task registry
/// @notice Coordinator posts tasks and escrows the reward. Whitelisted specialists
///         bid (first wins), submit a result, and on approval the reward is atomically
///         transferred in USDC. If an assignee stalls past the timeout, the poster
///         can reclaim the escrow.
/// @dev    When an `AgentRegistry` (ERC-8004) is wired, bids require a registered
///         agent identity and approvals automatically record a reputation score.
contract TaskMarket {
    using SafeERC20 for IERC20;
    enum Status { Open, Assigned, Completed, Paid, Cancelled }

    struct Task {
        uint256 id;
        address poster;
        address assignee;
        string  taskType;
        string  inputCID;
        string  resultCID;
        uint256 reward;
        Status  status;
        uint64  assignedAt;
    }

    IERC20  public immutable usdc;
    address public immutable coordinator;
    uint64  public immutable assignmentTimeout; // seconds
    uint256 public nextTaskId = 1;
    mapping(uint256 => Task) private _tasks;
    mapping(address => bool) public isSpecialist;

    /// @notice Optional ERC-8004 registry. When non-zero, bidders must hold an
    ///         identity and approvals emit reputation feedback automatically.
    IAgentRegistry public agentRegistry;

    event TaskPosted(uint256 indexed id, address indexed poster, string taskType, string inputCID, uint256 reward);
    event TaskAssigned(uint256 indexed id, address indexed assignee);
    event TaskCompleted(uint256 indexed id, string resultCID);
    event TaskPaid(uint256 indexed id, address indexed assignee, uint256 reward);
    event TaskCancelled(uint256 indexed id);
    event TaskReclaimed(uint256 indexed id, address indexed expiredAssignee);
    event SpecialistAuthorized(address indexed who, bool allowed);

    error NotOpen();
    error NotAssigned();
    error NotCompleted();
    error NotPoster();
    error NotCoordinator();
    error NotWhitelisted();
    error NotExpired();
    error OnlyAssignee();
    error NoAgentIdentity();

    event AgentRegistrySet(address indexed registry);

    constructor(address usdcAddress, address coordinator_, uint64 assignmentTimeoutSeconds) {
        usdc = IERC20(usdcAddress);
        coordinator = coordinator_;
        assignmentTimeout = assignmentTimeoutSeconds;
    }

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert NotCoordinator();
        _;
    }

    function setSpecialist(address who, bool allowed) external onlyCoordinator {
        isSpecialist[who] = allowed;
        emit SpecialistAuthorized(who, allowed);
    }

    function setAgentRegistry(address registry) external onlyCoordinator {
        agentRegistry = IAgentRegistry(registry);
        emit AgentRegistrySet(registry);
    }

    function postTask(string calldata taskType, string calldata inputCID, uint256 reward)
        external
        onlyCoordinator
        returns (uint256 id)
    {
        id = nextTaskId++;
        _tasks[id] = Task({
            id: id,
            poster: msg.sender,
            assignee: address(0),
            taskType: taskType,
            inputCID: inputCID,
            resultCID: "",
            reward: reward,
            status: Status.Open,
            assignedAt: 0
        });
        usdc.safeTransferFrom(msg.sender, address(this), reward);
        emit TaskPosted(id, msg.sender, taskType, inputCID, reward);
    }

    function bidOnTask(uint256 id) external {
        if (!isSpecialist[msg.sender]) revert NotWhitelisted();
        if (address(agentRegistry) != address(0) && agentRegistry.agentIdOf(msg.sender) == 0) {
            revert NoAgentIdentity();
        }
        Task storage t = _tasks[id];
        if (t.status != Status.Open) revert NotOpen();
        t.assignee = msg.sender;
        t.status = Status.Assigned;
        t.assignedAt = uint64(block.timestamp);
        emit TaskAssigned(id, msg.sender);
    }

    function submitResult(uint256 id, string calldata resultCID) external {
        Task storage t = _tasks[id];
        if (t.status != Status.Assigned) revert NotAssigned();
        if (msg.sender != t.assignee) revert OnlyAssignee();
        t.resultCID = resultCID;
        t.status = Status.Completed;
        emit TaskCompleted(id, resultCID);
    }

    function approveAndPay(uint256 id) external {
        _approveAndPay(id, 100, "");
    }

    /// @notice Approve a task and post an explicit reputation score (0–100)
    ///         to the ERC-8004 registry. Score 100 is used for the default path.
    function approveAndPayWithScore(uint256 id, uint8 score, string calldata feedbackURI) external {
        _approveAndPay(id, score, feedbackURI);
    }

    function _approveAndPay(uint256 id, uint8 score, string memory feedbackURI) internal {
        Task storage t = _tasks[id];
        if (t.status != Status.Completed) revert NotCompleted();
        if (msg.sender != t.poster) revert NotPoster();
        t.status = Status.Paid;
        usdc.safeTransfer(t.assignee, t.reward);
        emit TaskPaid(id, t.assignee, t.reward);

        if (address(agentRegistry) != address(0)) {
            uint256 agentId = agentRegistry.agentIdOf(t.assignee);
            if (agentId != 0) {
                bytes32 interactionId = keccak256(abi.encodePacked("taskmarket", id));
                agentRegistry.giveFeedback(agentId, score, interactionId, feedbackURI);
            }
        }
    }

    function cancelOpenTask(uint256 id) external {
        Task storage t = _tasks[id];
        if (t.status != Status.Open) revert NotOpen();
        if (msg.sender != t.poster) revert NotPoster();
        t.status = Status.Cancelled;
        usdc.safeTransfer(t.poster, t.reward);
        emit TaskCancelled(id);
    }

    /// @notice Poster reclaims escrow from a stalled assignee after the timeout.
    /// @dev Refunds the poster and marks the task Cancelled to prevent further state changes.
    function reclaimExpiredAssignment(uint256 id) external {
        Task storage t = _tasks[id];
        if (t.status != Status.Assigned) revert NotAssigned();
        if (msg.sender != t.poster) revert NotPoster();
        if (block.timestamp < uint256(t.assignedAt) + uint256(assignmentTimeout)) revert NotExpired();
        address expired = t.assignee;
        t.status = Status.Cancelled;
        usdc.safeTransfer(t.poster, t.reward);
        emit TaskReclaimed(id, expired);
    }

    function getTask(uint256 id) external view returns (Task memory) {
        return _tasks[id];
    }
}
