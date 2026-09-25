const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

// v11 feed IDs carry the schema version as their first two bytes.
const FEED_ID = '0x000b' + 'ab'.repeat(30);
const WRONG_FEED_ID = '0x000b' + 'cd'.repeat(30);
const V8_FEED_ID = '0x0008' + 'ab'.repeat(30);
const CAP = ethers.parseUnits('1000', 18);
const MAX_STALENESS = 300n;
const NS = 1_000_000_000n;

const REPORT_TYPES = [
  'bytes32',
  'uint32',
  'uint32',
  'uint192',
  'uint192',
  'uint32',
  'int192',
  'uint64',
  'int192',
  'int192',
  'int192',
  'int192',
  'int192',
  'uint32',
];

function buildPayload({ feedId = FEED_ID, mid = 25_000n, lastSeenNs = 0n, marketStatus = 2 }) {
  const reportData = abiCoder.encode(REPORT_TYPES, [
    feedId,
    0,
    0,
    0n,
    0n,
    0,
    mid,
    lastSeenNs,
    0n,
    0n,
    0n,
    0n,
    0n,
    marketStatus,
  ]);
  return abiCoder.encode(
    ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
    [[ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash], reportData, [], [], ethers.ZeroHash],
  );
}

describe('ChainlinkStreamsAdapter', function () {
  let admin, stranger, guard, verifier, adapter;
  const freshNs = async () => (BigInt(await time.latest()) + 60n) * NS;

  beforeEach(async function () {
    [admin, , stranger] = await ethers.getSigners();
    const TSVGuard = await ethers.getContractFactory('TSVGuard');
    guard = await TSVGuard.deploy(admin.address, CAP);
    const MockVerifierProxy = await ethers.getContractFactory('MockVerifierProxy');
    verifier = await MockVerifierProxy.deploy();
    const ChainlinkStreamsAdapter = await ethers.getContractFactory('ChainlinkStreamsAdapter');
    adapter = await ChainlinkStreamsAdapter.deploy(
      await verifier.getAddress(),
      await guard.getAddress(),
      FEED_ID,
      MAX_STALENESS,
    );
    await guard.connect(admin).grantRole(await guard.ORACLE_ROLE(), await adapter.getAddress());
  });

  it('rejects zero constructor arguments', async function () {
    const ChainlinkStreamsAdapter = await ethers.getContractFactory('ChainlinkStreamsAdapter');
    const verifierAddr = await verifier.getAddress();
    const guardAddr = await guard.getAddress();
    await expect(
      ChainlinkStreamsAdapter.deploy(ethers.ZeroAddress, guardAddr, FEED_ID, MAX_STALENESS),
    ).to.be.revertedWithCustomError(adapter, 'ZeroAddress');
    await expect(
      ChainlinkStreamsAdapter.deploy(verifierAddr, ethers.ZeroAddress, FEED_ID, MAX_STALENESS),
    ).to.be.revertedWithCustomError(adapter, 'ZeroAddress');
    await expect(
      ChainlinkStreamsAdapter.deploy(verifierAddr, guardAddr, ethers.ZeroHash, MAX_STALENESS),
    ).to.be.revertedWithCustomError(adapter, 'ZeroFeedId');
    await expect(
      ChainlinkStreamsAdapter.deploy(verifierAddr, guardAddr, FEED_ID, 0),
    ).to.be.revertedWithCustomError(adapter, 'ZeroStaleness');
  });

  it('keeps trading open on a fresh report from a live session', async function () {
    const lastSeenNs = await freshNs();
    const payload = buildPayload({ lastSeenNs, marketStatus: 2 });
    await expect(adapter.updateFromReport(payload))
      .to.emit(adapter, 'ReportApplied')
      .withArgs(2, 25_000n, lastSeenNs, false);
    expect(await guard.tradingEnabled()).to.equal(true);
    expect(await adapter.lastMarketStatus()).to.equal(2);
    expect(await adapter.lastSeenTimestampNs()).to.equal(lastSeenNs);
    expect(await adapter.lastAppliedAt()).to.be.gt(0);
  });

  it('treats pre-market, post-market and overnight as live sessions', async function () {
    for (const status of [1, 3, 4]) {
      await adapter.updateFromReport(
        buildPayload({ lastSeenNs: await freshNs(), marketStatus: status }),
      );
      expect(await guard.marketHalted()).to.equal(false);
    }
  });

  it('halts on Unknown or Closed market status', async function () {
    for (const status of [0, 5]) {
      await adapter.updateFromReport(
        buildPayload({ lastSeenNs: await freshNs(), marketStatus: status }),
      );
      expect(await guard.tradingEnabled()).to.equal(false);
    }
  });

  it('halts on unmapped market status values', async function () {
    await adapter.updateFromReport(buildPayload({ lastSeenNs: await freshNs(), marketStatus: 6 }));
    expect(await guard.tradingEnabled()).to.equal(false);
  });

  it('halts when the mid price goes stale', async function () {
    const now = BigInt(await time.latest()) + 2n;
    await time.setNextBlockTimestamp(now);
    const staleNs = (now - MAX_STALENESS - 1n) * NS;
    await adapter.updateFromReport(buildPayload({ lastSeenNs: staleNs, marketStatus: 2 }));
    expect(await guard.tradingEnabled()).to.equal(false);
  });

  it('stays open exactly at the staleness boundary', async function () {
    const now = BigInt(await time.latest()) + 2n;
    await time.setNextBlockTimestamp(now);
    const boundaryNs = (now - MAX_STALENESS) * NS;
    await adapter.updateFromReport(buildPayload({ lastSeenNs: boundaryNs, marketStatus: 2 }));
    expect(await guard.tradingEnabled()).to.equal(true);
  });

  it('reads a future mid timestamp as fresh, not as an error', async function () {
    // lastSeenTimestampNs is not monotonic across reports; a provider
    // shifting in or out can move it backwards or jump it ahead.
    const futureNs = (BigInt(await time.latest()) + 3600n) * NS;
    await adapter.updateFromReport(buildPayload({ lastSeenNs: futureNs, marketStatus: 2 }));
    expect(await guard.tradingEnabled()).to.equal(true);
  });

  it('halts on a zero or negative mid', async function () {
    await adapter.updateFromReport(
      buildPayload({ lastSeenNs: await freshNs(), mid: 0n, marketStatus: 2 }),
    );
    expect(await guard.tradingEnabled()).to.equal(false);
    await adapter.updateFromReport(
      buildPayload({ lastSeenNs: await freshNs(), mid: -1n, marketStatus: 2 }),
    );
    expect(await guard.tradingEnabled()).to.equal(false);
  });

  it('resumes trading when a fresh report follows a stale one', async function () {
    const now = BigInt(await time.latest()) + 2n;
    await time.setNextBlockTimestamp(now);
    await adapter.updateFromReport(
      buildPayload({ lastSeenNs: (now - MAX_STALENESS - 10n) * NS, marketStatus: 2 }),
    );
    expect(await guard.tradingEnabled()).to.equal(false);

    await adapter.updateFromReport(buildPayload({ lastSeenNs: await freshNs(), marketStatus: 2 }));
    expect(await guard.tradingEnabled()).to.equal(true);
  });

  it('reverts on a report from another feed', async function () {
    const payload = buildPayload({ feedId: WRONG_FEED_ID, lastSeenNs: await freshNs() });
    await expect(adapter.updateFromReport(payload))
      .to.be.revertedWithCustomError(adapter, 'UnknownFeed')
      .withArgs(WRONG_FEED_ID, FEED_ID);
  });

  it('reverts on an unsupported report schema version', async function () {
    const payload = buildPayload({ feedId: V8_FEED_ID, lastSeenNs: await freshNs() });
    await expect(adapter.updateFromReport(payload))
      .to.be.revertedWithCustomError(adapter, 'UnsupportedReportVersion')
      .withArgs(8);
  });

  it('lets anyone relay a report; authenticity comes from verification', async function () {
    await adapter
      .connect(stranger)
      .updateFromReport(buildPayload({ lastSeenNs: await freshNs(), marketStatus: 2 }));
    expect(await guard.tradingEnabled()).to.equal(true);
  });
});
