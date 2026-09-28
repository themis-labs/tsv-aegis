// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal subset of the Uniswap v4 core types a guarded hook
///         needs, kept local so the example compiles without a v4-core
///         dependency. Field order and types mirror PoolKey and SwapParams
///         from @uniswap/v4-core (Currency/IHooks collapsed to address);
///         a production hook imports the real types and derives from
///         BaseHook instead.

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}
