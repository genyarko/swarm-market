// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title TaskMarket — atomic pay-on-completion micro-task registry
/// @notice Coordinator posts tasks and escrows the reward. Specialists bid (first wins),
///         submit a result, and on approval the reward is atomically transferred in USDC.
contract TaskMarket {
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
    }

    IERC20  public immutable usdc;
    uint256 public nextTaskId = 1;
    mapping(uint256 => Task) private _tasks;

    event TaskPosted(uint256 indexed id, address indexed poster, string taskType, string inputCID, uint256 reward);
    event TaskAssigned(uint256 indexed id, address indexed assignee);
    event TaskCompleted(uint256 indexed id, string resultCID);
    event TaskPaid(uint256 indexed id, address indexed assignee, uint256 reward);
    event TaskCancelled(uint256 indexed id);

    error NotOpen();
    error NotAssigned();
    error NotCompleted();
    error NotPoster();
    error OnlyAssignee();
    error TransferFailed();

    constructor(address usdcAddress) {
        usdc = IERC20(usdcAddress);
    }

    function postTask(string calldata taskType, string calldata inputCID, uint256 reward)
        external
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
            status: Status.Open
        });
        if (!usdc.transferFrom(msg.sender, address(this), reward)) revert TransferFailed();
        emit TaskPosted(id, msg.sender, taskType, inputCID, reward);
    }

    function bidOnTask(uint256 id) external {
        Task storage t = _tasks[id];
        if (t.status != Status.Open) revert NotOpen();
        t.assignee = msg.sender;
        t.status = Status.Assigned;
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
        Task storage t = _tasks[id];
        if (t.status != Status.Completed) revert NotCompleted();
        if (msg.sender != t.poster) revert NotPoster();
        t.status = Status.Paid;
        if (!usdc.transfer(t.assignee, t.reward)) revert TransferFailed();
        emit TaskPaid(id, t.assignee, t.reward);
    }

    function cancelOpenTask(uint256 id) external {
        Task storage t = _tasks[id];
        if (t.status != Status.Open) revert NotOpen();
        if (msg.sender != t.poster) revert NotPoster();
        t.status = Status.Cancelled;
        if (!usdc.transfer(t.poster, t.reward)) revert TransferFailed();
        emit TaskCancelled(id);
    }

    function getTask(uint256 id) external view returns (Task memory) {
        return _tasks[id];
    }
}
