// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerifierProxy} from "../interfaces/IVerifierProxy.sol";

/// @notice Halt-state sink the adapter pushes into. TSVGuard implements
///         this; the adapter must hold ORACLE_ROLE on it.
interface IHaltRelay {
    function setStockHaltStatus(bool isHalted) external;
}

/// @title ChainlinkStreamsAdapter
/// @notice Consumes Chainlink 24/5 U.S. Equities Streams reports (RWA
///         Advanced, schema v11), verifies them through the chain's
///         VerifierProxy, and translates market status into the guard's
///         halt flag.
/// @dev    Chainlink does not flag LULD trading halts in marketStatus; a
///         halted venue simply stops publishing, so staleness of the
///         consensus mid price is the on-chain halt signal. Live sessions
///         (1 pre-market, 2 regular, 3 post-market, 4 overnight) with a
///         fresh, positive mid allow trading; Unknown (0), Closed (5),
///         unmapped values, a stale mid, or a non-positive mid all resolve
///         to halted. Calls are permissionless: authenticity comes from
///         DON signature verification, not from the caller.
contract ChainlinkStreamsAdapter {
    IVerifierProxy public immutable verifier;
    IHaltRelay public immutable guard;
    bytes32 public immutable feedId;
    /// @notice Max age of the mid price, in seconds, before the feed reads
    ///         as halted.
    uint64 public immutable maxStaleness;

    /// @notice Fields of the last applied report, kept so the current halt
    ///         state always carries an auditable cause.
    uint32 public lastMarketStatus;
    int192 public lastMid;
    uint64 public lastSeenTimestampNs;
    uint64 public lastAppliedAt;

    event ReportApplied(uint32 marketStatus, int192 mid, uint64 lastSeenTimestampNs, bool halted);

    error ZeroAddress();
    error ZeroFeedId();
    error ZeroStaleness();
    error UnsupportedReportVersion(uint16 version);
    error UnknownFeed(bytes32 got, bytes32 want);

    struct ReportV11 {
        bytes32 feedId;
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint192 nativeFee;
        uint192 linkFee;
        uint32 expiresAt;
        int192 mid;
        uint64 lastSeenTimestampNs;
        int192 bid;
        int192 bidVolume;
        int192 ask;
        int192 askVolume;
        int192 lastTradedPrice;
        uint32 marketStatus;
    }

    constructor(address _verifier, address _guard, bytes32 _feedId, uint64 _maxStaleness) {
        if (_verifier == address(0) || _guard == address(0)) revert ZeroAddress();
        if (_feedId == bytes32(0)) revert ZeroFeedId();
        if (_maxStaleness == 0) revert ZeroStaleness();
        verifier = IVerifierProxy(_verifier);
        guard = IHaltRelay(_guard);
        feedId = _feedId;
        maxStaleness = _maxStaleness;
    }

    /// @notice Verify one signed report and push the derived halt state.
    /// @param payload Full report payload as returned by the Streams API.
    function updateFromReport(bytes calldata payload) external {
        // The first two bytes of the report body carry the schema version
        // (they double as the feed ID prefix, e.g. 0x000b... for v11).
        (, bytes memory reportData) = abi.decode(payload, (bytes32[3], bytes));
        uint16 version = (uint16(uint8(reportData[0])) << 8) | uint16(uint8(reportData[1]));
        if (version != 11) revert UnsupportedReportVersion(version);

        bytes memory verified = verifier.verify(payload, bytes(""));
        ReportV11 memory report = abi.decode(verified, (ReportV11));
        if (report.feedId != feedId) revert UnknownFeed(report.feedId, feedId);

        bool halted = _derivesHalt(report);

        lastMarketStatus = report.marketStatus;
        lastMid = report.mid;
        lastSeenTimestampNs = report.lastSeenTimestampNs;
        lastAppliedAt = uint64(block.timestamp);
        emit ReportApplied(report.marketStatus, report.mid, report.lastSeenTimestampNs, halted);

        guard.setStockHaltStatus(halted);
    }

    function _derivesHalt(ReportV11 memory report) internal view returns (bool) {
        // Only 1-4 are live trading sessions; Unknown, Closed and anything
        // unmapped must read as halted, never as a healthy market.
        if (report.marketStatus < 1 || report.marketStatus > 4) return true;
        // Single-provider sessions can print a zero or outlier mid while
        // timestamps keep advancing; refuse to treat that as a live market.
        if (report.mid <= 0) return true;
        // A halted venue stops publishing: the mid timestamp going quiet
        // past the staleness budget is the on-chain LULD signal. The
        // timestamp is not monotonic across reports, so a value in the
        // future simply reads as fresh.
        uint64 nowNs = uint64(block.timestamp) * 1e9;
        return report.lastSeenTimestampNs + maxStaleness * 1e9 < nowNs;
    }
}
