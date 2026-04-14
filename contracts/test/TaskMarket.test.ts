import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { TaskMarket, MockUSDC } from '../typechain-types';

const REWARD = 3000n; // 0.003 USDC at 6 decimals

describe('TaskMarket', () => {
  async function deploy() {
    const [coordinator, agent1, agent2, outsider] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory('MockUSDC');
    const usdc = (await USDC.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    const Market = await ethers.getContractFactory('TaskMarket');
    const market = (await Market.deploy(await usdc.getAddress())) as unknown as TaskMarket;
    await market.waitForDeployment();

    await usdc.mint(coordinator.address, 10_000_000n); // 10 USDC
    await usdc.connect(coordinator).approve(await market.getAddress(), ethers.MaxUint256);

    return { market, usdc, coordinator, agent1, agent2, outsider };
  }

  it('runs full lifecycle and transfers USDC atomically', async () => {
    const { market, usdc, coordinator, agent1 } = await deploy();

    await expect(market.connect(coordinator).postTask('summarize', 'ipfs://input', REWARD))
      .to.emit(market, 'TaskPosted')
      .withArgs(1n, coordinator.address, 'summarize', 'ipfs://input', REWARD);

    expect(await usdc.balanceOf(await market.getAddress())).to.equal(REWARD);

    await expect(market.connect(agent1).bidOnTask(1))
      .to.emit(market, 'TaskAssigned')
      .withArgs(1n, agent1.address);

    await expect(market.connect(agent1).submitResult(1, 'ipfs://result'))
      .to.emit(market, 'TaskCompleted')
      .withArgs(1n, 'ipfs://result');

    const before = await usdc.balanceOf(agent1.address);
    await expect(market.connect(coordinator).approveAndPay(1))
      .to.emit(market, 'TaskPaid')
      .withArgs(1n, agent1.address, REWARD);

    expect(await usdc.balanceOf(agent1.address)).to.equal(before + REWARD);
    expect(await usdc.balanceOf(await market.getAddress())).to.equal(0n);

    const task = await market.getTask(1);
    expect(task.status).to.equal(3); // Paid
  });

  it('rejects second bidder (first-come wins)', async () => {
    const { market, coordinator, agent1, agent2 } = await deploy();
    await market.connect(coordinator).postTask('classify', 'ipfs://x', REWARD);
    await market.connect(agent1).bidOnTask(1);
    await expect(market.connect(agent2).bidOnTask(1))
      .to.be.revertedWithCustomError(market, 'NotOpen');
  });

  it('only the assignee can submit a result', async () => {
    const { market, coordinator, agent1, agent2 } = await deploy();
    await market.connect(coordinator).postTask('translate', 'ipfs://x', REWARD);
    await market.connect(agent1).bidOnTask(1);
    await expect(market.connect(agent2).submitResult(1, 'bad'))
      .to.be.revertedWithCustomError(market, 'OnlyAssignee');
  });

  it('only the poster can approveAndPay', async () => {
    const { market, coordinator, agent1, outsider } = await deploy();
    await market.connect(coordinator).postTask('sentiment', 'ipfs://x', REWARD);
    await market.connect(agent1).bidOnTask(1);
    await market.connect(agent1).submitResult(1, 'ipfs://r');
    await expect(market.connect(outsider).approveAndPay(1))
      .to.be.revertedWithCustomError(market, 'NotPoster');
  });

  it('cancel refunds the poster', async () => {
    const { market, usdc, coordinator } = await deploy();
    const before = await usdc.balanceOf(coordinator.address);
    await market.connect(coordinator).postTask('extract', 'ipfs://x', REWARD);
    await market.connect(coordinator).cancelOpenTask(1);
    expect(await usdc.balanceOf(coordinator.address)).to.equal(before);
  });

  it('handles 10 tasks posted rapidly in a row', async () => {
    const { market, usdc, coordinator, agent1 } = await deploy();
    const marketAddr = await market.getAddress();

    for (let i = 0; i < 10; i++) {
      await market.connect(coordinator).postTask('summarize', `ipfs://doc-${i}`, REWARD);
    }
    expect(await usdc.balanceOf(marketAddr)).to.equal(REWARD * 10n);

    const agentBefore = await usdc.balanceOf(agent1.address);
    for (let id = 1; id <= 10; id++) {
      await market.connect(agent1).bidOnTask(id);
      await market.connect(agent1).submitResult(id, `ipfs://r-${id}`);
      await market.connect(coordinator).approveAndPay(id);
    }
    expect(await usdc.balanceOf(agent1.address)).to.equal(agentBefore + REWARD * 10n);
    expect(await usdc.balanceOf(marketAddr)).to.equal(0n);
  });
});
