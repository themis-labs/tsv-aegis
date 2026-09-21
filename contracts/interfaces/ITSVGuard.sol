// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Integration surface for AMMs / venues that gate swaps on TSVGuard.
interface ITSVGuard {
    function tradingEnabled() external view returns (bool);
    function marketHalted() external view returns (bool);
    function effectiveDailyVolume() external view returns (uint256);
    function maxDailyCap() external view returns (uint256);

    event HaltUpdated(bool halted, string reason);
    event CapBreached(uint64 indexed day, uint256 dailyTotal, uint256 maxDailyCap);
}
