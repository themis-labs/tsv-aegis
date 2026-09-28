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

function wrapPayload(reportData) {
  return abiCoder.encode(
    ['bytes32[3]', 'bytes', 'bytes32[]', 'bytes32[]', 'bytes32'],
    [[ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash], reportData, [], [], ethers.ZeroHash],
  );
}

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
  return wrapPayload(reportData);
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

  describe('failure modes', function () {
    it('reverts on an empty payload', async function () {
      await expect(adapter.updateFromReport('0x')).to.be.reverted;
      expect(await adapter.lastAppliedAt()).to.equal(0);
    });

    it('reverts on a truncated payload', async function () {
      const payload = buildPayload({ lastSeenNs: await freshNs() });
      await expect(adapter.updateFromReport(payload.slice(0, 100))).to.be.reverted;
    });

    it('reverts on a report body too short to carry the version prefix', async function () {
      // One byte is not enough to read the two-byte schema version, so the
      // version check panics before the verifier is ever called.
      await expect(adapter.updateFromReport(wrapPayload('0x00'))).to.be.revertedWithPanic(0x32);
    });

    it('reverts when the verified body is too short to decode a v11 report', async function () {
      // Starts with the v11 prefix so the version check passes, then the
      // struct decode runs out of data.
      const stub = abiCoder.encode(['bytes32', 'uint32'], [FEED_ID, 0]);
      await expect(adapter.updateFromReport(wrapPayload(stub))).to.be.reverted;
    });

    it('propagates a verifier revert', async function () {
      // The guard contract has no verify() entrypoint and no fallback, so
      // the call reverts and the adapter must let it bubble up.
      const ChainlinkStreamsAdapter = await ethers.getContractFactory('ChainlinkStreamsAdapter');
      const broken = await ChainlinkStreamsAdapter.deploy(
        await guard.getAddress(),
        await guard.getAddress(),
        FEED_ID,
        MAX_STALENESS,
      );
      await expect(broken.updateFromReport(buildPayload({ lastSeenNs: await freshNs() }))).to.be
        .reverted;
    });

    it('reverts when the verifier returns undecodable data', async function () {
      // An EOA standing in for the verifier answers the call with empty
      // returndata, which fails the report decode.
      const ChainlinkStreamsAdapter = await ethers.getContractFactory('ChainlinkStreamsAdapter');
      const miswired = await ChainlinkStreamsAdapter.deploy(
        stranger.address,
        await guard.getAddress(),
        FEED_ID,
        MAX_STALENESS,
      );
      await expect(miswired.updateFromReport(buildPayload({ lastSeenNs: await freshNs() }))).to.be
        .reverted;
    });

    it('reverts the update when the adapter lacks ORACLE_ROLE on the guard', async function () {
      const ChainlinkStreamsAdapter = await ethers.getContractFactory('ChainlinkStreamsAdapter');
      const unauthorized = await ChainlinkStreamsAdapter.deploy(
        await verifier.getAddress(),
        await guard.getAddress(),
        FEED_ID,
        MAX_STALENESS,
      );
      const oracleRole = await guard.ORACLE_ROLE();
      await expect(unauthorized.updateFromReport(buildPayload({ lastSeenNs: await freshNs() })))
        .to.be.revertedWithCustomError(guard, 'AccessControlUnauthorizedAccount')
        .withArgs(await unauthorized.getAddress(), oracleRole);
      // The guard must not latch any state from a report it never accepted.
      expect(await guard.haltStatusUpdatedAt()).to.equal(0);
    });

    it('reverts updates after ORACLE_ROLE is revoked', async function () {
      await adapter.updateFromReport(
        buildPayload({ lastSeenNs: await freshNs(), marketStatus: 2 }),
      );
      expect(await guard.tradingEnabled()).to.equal(true);

      await guard.connect(admin).revokeRole(await guard.ORACLE_ROLE(), await adapter.getAddress());
      await expect(
        adapter.updateFromReport(buildPayload({ lastSeenNs: await freshNs(), marketStatus: 2 })),
      ).to.be.revertedWithCustomError(guard, 'AccessControlUnauthorizedAccount');
      expect(await guard.tradingEnabled()).to.equal(true);
    });

    it('keeps the halt in place when a follow-up malformed report reverts', async function () {
      await adapter.updateFromReport(
        buildPayload({ lastSeenNs: await freshNs(), marketStatus: 5 }),
      );
      expect(await guard.tradingEnabled()).to.equal(false);

      await expect(adapter.updateFromReport('0x')).to.be.reverted;
      await expect(
        adapter.updateFromReport(buildPayload({ feedId: WRONG_FEED_ID })),
      ).to.be.revertedWithCustomError(adapter, 'UnknownFeed');
      expect(await guard.tradingEnabled()).to.equal(false);
      expect(await adapter.lastMarketStatus()).to.equal(5);
    });

    it('halts on a zero last-seen timestamp even in a live session', async function () {
      // A report that has never observed a trade must not read as a healthy
      // market: lastSeenTimestampNs of 0 is as stale as it gets.
      await adapter.updateFromReport(buildPayload({ lastSeenNs: 0n, marketStatus: 2 }));
      expect(await guard.tradingEnabled()).to.equal(false);
    });

    it('halts on the highest unmapped market status value', async function () {
      await adapter.updateFromReport(
        buildPayload({ lastSeenNs: await freshNs(), marketStatus: 4_294_967_295 }),
      );
      expect(await guard.tradingEnabled()).to.equal(false);
    });

    it('flags the halt in ReportApplied for degraded reports', async function () {
      const lastSeenNs = await freshNs();
      await expect(adapter.updateFromReport(buildPayload({ lastSeenNs, marketStatus: 5 })))
        .to.emit(adapter, 'ReportApplied')
        .withArgs(5, 25_000n, lastSeenNs, true);
    });

    it('surfaces the adapter halt on the guard ERC-8392 interruption enum', async function () {
      const ASSET_HALTED = 3;
      await adapter.updateFromReport(
        buildPayload({ lastSeenNs: await freshNs(), marketStatus: 0 }),
      );
      const status = await guard.referenceMarketStatus();
      expect(status.interruption).to.equal(ASSET_HALTED);
      expect(status.interruptionAsOf).to.be.gt(0);
    });
  });
});
