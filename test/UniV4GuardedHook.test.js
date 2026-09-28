const { expect } = require('chai');
const { ethers } = require('hardhat');

const CAP = ethers.parseUnits('1000', 18);

// Contents don't matter to the hook (it gates on the guard, not the
// pool), so any well-formed key and params do.
const POOL_KEY = {
  currency0: '0x0000000000000000000000000000000000000001',
  currency1: '0x0000000000000000000000000000000000000002',
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000003',
};
const SWAP_PARAMS = { zeroForOne: true, amountSpecified: -1000n, sqrtPriceLimitX96: 0n };

describe('UniV4GuardedHook', function () {
  let admin, poolManager, stranger, guard, hook;

  beforeEach(async function () {
    [admin, poolManager, stranger] = await ethers.getSigners();
    const TSVGuard = await ethers.getContractFactory('TSVGuard');
    guard = await TSVGuard.deploy(admin.address, CAP);
    const UniV4GuardedHook = await ethers.getContractFactory('UniV4GuardedHook');
    hook = await UniV4GuardedHook.deploy(poolManager.address, await guard.getAddress());
  });

  it('rejects zero constructor arguments', async function () {
    const UniV4GuardedHook = await ethers.getContractFactory('UniV4GuardedHook');
    await expect(
      UniV4GuardedHook.deploy(ethers.ZeroAddress, await guard.getAddress()),
    ).to.be.revertedWithCustomError(hook, 'ZeroAddress');
    await expect(
      UniV4GuardedHook.deploy(poolManager.address, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(hook, 'ZeroAddress');
  });

  it('lets a swap through while the guard allows trading', async function () {
    // The guard is fail-closed until the oracle's first report.
    await guard.connect(admin).setStockHaltStatus(false);
    const [selector, delta, feeOverride] = await hook
      .connect(poolManager)
      .beforeSwap.staticCall(stranger.address, POOL_KEY, SWAP_PARAMS, '0x');
    expect(selector).to.equal(hook.interface.getFunction('beforeSwap').selector);
    expect(delta).to.equal(0n);
    expect(feeOverride).to.equal(0n);
  });

  it('reverts the swap before the guard has seen any oracle report', async function () {
    await expect(
      hook
        .connect(poolManager)
        .beforeSwap.staticCall(stranger.address, POOL_KEY, SWAP_PARAMS, '0x'),
    ).to.be.revertedWithCustomError(hook, 'TradingHalted');
  });

  it('reverts the swap while the guard is halted', async function () {
    await guard.connect(admin).setStockHaltStatus(true);
    await expect(
      hook
        .connect(poolManager)
        .beforeSwap.staticCall(stranger.address, POOL_KEY, SWAP_PARAMS, '0x'),
    ).to.be.revertedWithCustomError(hook, 'TradingHalted');
  });

  it('lets swaps through again after the guard resumes', async function () {
    await guard.connect(admin).setStockHaltStatus(true);
    await guard.connect(admin).setStockHaltStatus(false);
    const [selector] = await hook
      .connect(poolManager)
      .beforeSwap.staticCall(stranger.address, POOL_KEY, SWAP_PARAMS, '0x');
    expect(selector).to.equal(hook.interface.getFunction('beforeSwap').selector);
  });

  it('rejects hook calls from anything but the PoolManager', async function () {
    await expect(
      hook.connect(stranger).beforeSwap.staticCall(stranger.address, POOL_KEY, SWAP_PARAMS, '0x'),
    ).to.be.revertedWithCustomError(hook, 'NotPoolManager');
  });
});
