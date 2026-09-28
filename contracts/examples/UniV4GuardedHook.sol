// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITSVGuard} from "../interfaces/ITSVGuard.sol";
import {PoolKey, SwapParams} from "./interfaces/IV4TypesMinimal.sol";

/// @title UniV4GuardedHook
/// @notice Reference integration pattern: a Uniswap v4 hook whose
///         beforeSwap consults TSVGuard.tradingEnabled() and reverts the
///         swap while the guard disallows trading. This mirrors what the
///         exemption's concurrent-stoppage condition needs inside a swap
///         path — the guard is read, never written, so the hook adds no
///         trust assumptions beyond the guard itself.
/// @dev    Example-only, not deployed. A production hook derives from
///         BaseHook, imports the real v4-core types, and is mined to an
///         address whose flags enable the beforeSwap permission; none of
///         that machinery is reproduced here. Fail-closed by construction:
///         if the guard call itself reverts, the swap reverts with it.
contract UniV4GuardedHook {
    ITSVGuard public immutable guard;
    /// @notice Only the PoolManager may invoke hook entry points.
    address public immutable poolManager;

    error ZeroAddress();
    error NotPoolManager();
    error TradingHalted();

    constructor(address _poolManager, address _guard) {
        if (_poolManager == address(0) || _guard == address(0)) revert ZeroAddress();
        poolManager = _poolManager;
        guard = ITSVGuard(_guard);
    }

    /// @notice Entry point the PoolManager calls before every swap.
    ///         Reverts with TradingHalted while the guard disallows
    ///         trading; otherwise returns the selector and zero overrides,
    ///         matching the v4 beforeSwap convention (no balance delta, no
    ///         lp-fee override).
    function beforeSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        bytes calldata
    ) external view returns (bytes4, int128, uint24) {
        if (msg.sender != poolManager) revert NotPoolManager();
        if (!guard.tradingEnabled()) revert TradingHalted();
        return (this.beforeSwap.selector, 0, 0);
    }
}
