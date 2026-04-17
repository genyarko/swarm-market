import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { AgentRegistry, TaskMarket, MockUSDC } from '../typechain-types';

describe('AgentRegistry (ERC-8004)', () => {
  async function deploy() {
    const [coordinator, agent1, agent2, rater] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('AgentRegistry');
    const registry = (await Registry.deploy()) as unknown as AgentRegistry;
    await registry.waitForDeployment();
    return { registry, coordinator, agent1, agent2, rater };
  }

  it('registers an agent and exposes identity lookups', async () => {
    const { registry, agent1 } = await deploy();
    await expect(registry.connect(agent1).registerAgent('a.agents', 'ipfs://card'))
      .to.emit(registry, 'AgentRegistered')
      .withArgs(1n, agent1.address, 'a.agents', 'ipfs://card');
    expect(await registry.agentIdOf(agent1.address)).to.equal(1n);
    const a = await registry.getAgent(1);
    expect(a.owner).to.equal(agent1.address);
    expect(a.active).to.equal(true);
  });

  it('rejects double registration', async () => {
    const { registry, agent1 } = await deploy();
    await registry.connect(agent1).registerAgent('a', 'u');
    await expect(registry.connect(agent1).registerAgent('a2', 'u2')).to.be.revertedWithCustomError(
      registry,
      'AlreadyRegistered',
    );
  });

  it('records feedback and computes average score', async () => {
    const { registry, agent1, rater } = await deploy();
    await registry.connect(agent1).registerAgent('a', 'u');
    const interactionId = ethers.id('task-1');
    await registry.connect(rater).giveFeedback(1, 80, interactionId, 'ipfs://r1');
    await registry.connect(rater).giveFeedback(1, 100, interactionId, 'ipfs://r2');
    expect(await registry.feedbackCount(1)).to.equal(2n);
    expect(await registry.averageScore(1)).to.equal(90n);
  });

  it('rejects scores above 100', async () => {
    const { registry, agent1, rater } = await deploy();
    await registry.connect(agent1).registerAgent('a', 'u');
    await expect(
      registry.connect(rater).giveFeedback(1, 101, ethers.id('x'), ''),
    ).to.be.revertedWithCustomError(registry, 'InvalidScore');
  });

  it('runs full validation request → resolve flow', async () => {
    const { registry, agent1, rater } = await deploy();
    await registry.connect(agent1).registerAgent('a', 'u');
    const dataHash = ethers.id('output');
    await expect(registry.connect(agent1).requestValidation(1, dataHash, 'ipfs://out'))
      .to.emit(registry, 'ValidationRequested')
      .withArgs(1n, 1n, agent1.address, dataHash, 'ipfs://out');
    await registry.connect(rater).resolveValidation(1, true, 'ipfs://verdict');
    const v = await registry.getValidation(1);
    expect(v.validator).to.equal(rater.address);
    expect(v.state).to.equal(1); // Approved
  });
});

describe('TaskMarket × AgentRegistry', () => {
  const REWARD = 3000n;
  const TIMEOUT = 60n;

  async function deploy() {
    const [coordinator, agent1, agent2] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory('MockUSDC');
    const usdc = (await USDC.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    const Registry = await ethers.getContractFactory('AgentRegistry');
    const registry = (await Registry.deploy()) as unknown as AgentRegistry;
    await registry.waitForDeployment();

    const Market = await ethers.getContractFactory('TaskMarket');
    const market = (await Market.deploy(
      await usdc.getAddress(),
      coordinator.address,
      TIMEOUT,
    )) as unknown as TaskMarket;
    await market.waitForDeployment();

    await usdc.mint(coordinator.address, 10_000_000n);
    await usdc.connect(coordinator).approve(await market.getAddress(), ethers.MaxUint256);
    await market.connect(coordinator).setSpecialist(agent1.address, true);
    await market.connect(coordinator).setSpecialist(agent2.address, true);
    await market.connect(coordinator).setAgentRegistry(await registry.getAddress());

    return { market, registry, usdc, coordinator, agent1, agent2 };
  }

  it('blocks bids from unregistered agents when registry is linked', async () => {
    const { market, coordinator, agent1 } = await deploy();
    await market.connect(coordinator).postTask('summarize', 'ipfs://in', REWARD);
    await expect(market.connect(agent1).bidOnTask(1)).to.be.revertedWithCustomError(
      market,
      'NoAgentIdentity',
    );
  });

  it('emits reputation feedback on approveAndPay', async () => {
    const { market, registry, coordinator, agent1 } = await deploy();
    await registry.connect(agent1).registerAgent('a.agents', 'ipfs://card');
    await market.connect(coordinator).postTask('summarize', 'ipfs://in', REWARD);
    await market.connect(agent1).bidOnTask(1);
    await market.connect(agent1).submitResult(1, 'ipfs://result');
    await expect(market.connect(coordinator).approveAndPay(1)).to.emit(registry, 'FeedbackGiven');
    expect(await registry.averageScore(1)).to.equal(100n);
  });

  it('approveAndPayWithScore records a custom reputation score', async () => {
    const { market, registry, coordinator, agent1 } = await deploy();
    await registry.connect(agent1).registerAgent('a.agents', 'ipfs://card');
    await market.connect(coordinator).postTask('summarize', 'ipfs://in', REWARD);
    await market.connect(agent1).bidOnTask(1);
    await market.connect(agent1).submitResult(1, 'ipfs://result');
    await market.connect(coordinator).approveAndPayWithScore(1, 75, 'ipfs://review');
    expect(await registry.averageScore(1)).to.equal(75n);
  });
});
