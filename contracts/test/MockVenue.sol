// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITSVGuard} from "../interfaces/ITSVGuard.sol";

/// @notice Minimal demo venue used by the end-to-end simulation. A real
///         integration (AMM pool, Uniswap v4 hook) performs the same
///         tradingEnabled() check inside its swap path.
contract MockVenue {
    ITSVGuard public immutable guard;
    uint256 public lastTradeAmount;

    error TradingHalted();

    constructor(address guardAddress) {
        guard = ITSVGuard(guardAddress);
    }

    /// @notice Simulated trade; reverts while the guard disallows trading.
    function trade(uint256 amount) external {
        if (!guard.tradingEnabled()) revert TradingHalted();
        lastTradeAmount = amount;
    }
}
