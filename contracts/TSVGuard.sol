// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title TSVGuard
/// @notice Compliance shield for tokenized NMS stock trading under the SEC
///         Innovation Exemption (order of 2026-09-17, press release 2026-90).
///         Two independent stop conditions:
///         1. a market halt relayed from traditional venues (LULD), matching
///            the order's concurrent-stoppage condition;
///         2. a per-day volume cap (0.25% / 2.5% of prior-month ADV by tier).
///         The two conditions use separate flags on purpose: a daily volume
///         rollover must never clear an active market halt.
contract TSVGuard is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    bool public marketHalted;
    uint256 public maxDailyCap;
    uint256 public currentDailyVolume;
    uint64 public currentDay; // UTC day index: block.timestamp / 1 days

    event HaltUpdated(bool halted, string reason);
    event MaxDailyCapUpdated(uint256 oldCap, uint256 newCap);
    event VolumeRecorded(uint64 indexed day, uint256 added, uint256 dailyTotal);
    event CapBreached(uint64 indexed day, uint256 dailyTotal, uint256 maxDailyCap);

    error ZeroAddress();
    error ZeroCap();

    constructor(address oracle, uint256 _maxDailyCap) {
        if (oracle == address(0)) revert ZeroAddress();
        if (_maxDailyCap == 0) revert ZeroCap();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, oracle);
        maxDailyCap = _maxDailyCap;
        currentDay = uint64(block.timestamp / 1 days);
    }

    /// @notice Daily total after lazy day rollover (no write required).
    function effectiveDailyVolume() public view returns (uint256) {
        // Strict equality is intended: day indices are discrete UTC-day
        // counters, so "same day" is exactly the condition we want.
        // slither-disable-next-line incorrect-equality
        return uint64(block.timestamp / 1 days) == currentDay ? currentDailyVolume : 0;
    }

    /// @notice Whether trading is currently allowed.
    function tradingEnabled() public view returns (bool) {
        return !marketHalted && effectiveDailyVolume() < maxDailyCap;
    }

    /// @notice Relay a halt/resume signal from the underlying market.
    function setStockHaltStatus(bool isHalted) external onlyRole(ORACLE_ROLE) {
        marketHalted = isHalted;
        emit HaltUpdated(
            isHalted,
            isHalted ? "Underlying NMS stock halted (LULD)" : "Underlying NMS stock resumed"
        );
    }

    /// @notice Update the daily volume cap (e.g. monthly ADV recalibration).
    function setMaxDailyCap(uint256 newCap) external onlyRole(ORACLE_ROLE) {
        if (newCap == 0) revert ZeroCap();
        emit MaxDailyCapUpdated(maxDailyCap, newCap);
        maxDailyCap = newCap;
    }

    /// @notice Record traded volume; emits CapBreached once the cap is hit.
    function recordVolume(uint256 addedVolume) external onlyRole(ORACLE_ROLE) {
        _rollDay();
        currentDailyVolume += addedVolume;
        emit VolumeRecorded(currentDay, addedVolume, currentDailyVolume);
        if (currentDailyVolume >= maxDailyCap) {
            emit CapBreached(currentDay, currentDailyVolume, maxDailyCap);
        }
    }

    /// @notice Permissionless day rollover; also callable by Keepers as a
    ///         scheduled job. Trading state re-derives lazily either way.
    function rollDay() external {
        _rollDay();
    }

    function _rollDay() internal {
        uint64 day = uint64(block.timestamp / 1 days);
        if (day != currentDay) {
            currentDay = day;
            currentDailyVolume = 0;
        }
    }
}
