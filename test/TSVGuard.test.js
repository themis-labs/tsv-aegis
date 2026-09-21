const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('TSVGuard', function () {
  const CAP = ethers.parseUnits('1000', 18);
  let admin, oracle, stranger, guard;

  beforeEach(async function () {
    [admin, oracle, stranger] = await ethers.getSigners();
    const TSVGuard = await ethers.getContractFactory('TSVGuard');
    guard = await TSVGuard.deploy(oracle.address, CAP);
  });

  it('grants roles and starts with trading enabled', async function () {
    const ORACLE_ROLE = await guard.ORACLE_ROLE();
    expect(await guard.hasRole(ORACLE_ROLE, oracle.address)).to.equal(true);
    expect(await guard.hasRole(await guard.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await guard.tradingEnabled()).to.equal(true);
  });

  it('reverts on zero oracle address or zero cap', async function () {
    const TSVGuard = await ethers.getContractFactory('TSVGuard');
    await expect(TSVGuard.deploy(ethers.ZeroAddress, CAP)).to.be.revertedWithCustomError(
      TSVGuard,
      'ZeroAddress',
    );
    await expect(TSVGuard.deploy(oracle.address, 0)).to.be.revertedWithCustomError(
      TSVGuard,
      'ZeroCap',
    );
  });

  it('halts and resumes on oracle signal', async function () {
    await expect(guard.connect(oracle).setStockHaltStatus(true))
      .to.emit(guard, 'HaltUpdated')
      .withArgs(true, 'Underlying NMS stock halted (LULD)');
    expect(await guard.tradingEnabled()).to.equal(false);

    await guard.connect(oracle).setStockHaltStatus(false);
    expect(await guard.tradingEnabled()).to.equal(true);
  });

  it('rejects state changes from non-oracle accounts', async function () {
    const ORACLE_ROLE = await guard.ORACLE_ROLE();
    await expect(guard.connect(stranger).setStockHaltStatus(true))
      .to.be.revertedWithCustomError(guard, 'AccessControlUnauthorizedAccount')
      .withArgs(stranger.address, ORACLE_ROLE);
    await expect(guard.connect(stranger).recordVolume(1)).to.be.revertedWithCustomError(
      guard,
      'AccessControlUnauthorizedAccount',
    );
  });

  it('blocks trading once the daily cap is reached', async function () {
    await guard.connect(oracle).recordVolume(CAP - 1n);
    expect(await guard.tradingEnabled()).to.equal(true);

    await expect(guard.connect(oracle).recordVolume(1n)).to.emit(guard, 'CapBreached');
    expect(await guard.tradingEnabled()).to.equal(false);
  });

  it('re-enables trading on the next UTC day (lazy rollover)', async function () {
    await guard.connect(oracle).recordVolume(CAP);
    expect(await guard.tradingEnabled()).to.equal(false);

    await time.increase(1 * 24 * 60 * 60 + 1);
    expect(await guard.tradingEnabled()).to.equal(true);
    expect(await guard.effectiveDailyVolume()).to.equal(0n);

    await guard.connect(oracle).recordVolume(10n);
    expect(await guard.currentDailyVolume()).to.equal(10n);
  });

  it('does NOT clear a market halt on day rollover', async function () {
    await guard.connect(oracle).setStockHaltStatus(true);
    await time.increase(2 * 24 * 60 * 60);
    expect(await guard.marketHalted()).to.equal(true);
    expect(await guard.tradingEnabled()).to.equal(false);
  });

  it('lets the oracle update the daily cap', async function () {
    const newCap = ethers.parseUnits('2000', 18);
    await expect(guard.connect(oracle).setMaxDailyCap(newCap))
      .to.emit(guard, 'MaxDailyCapUpdated')
      .withArgs(CAP, newCap);
    expect(await guard.maxDailyCap()).to.equal(newCap);
    await expect(guard.connect(oracle).setMaxDailyCap(0)).to.be.revertedWithCustomError(
      guard,
      'ZeroCap',
    );
  });
});
