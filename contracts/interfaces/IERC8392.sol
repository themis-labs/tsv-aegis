// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface definitions adapted from the ERC-8392 draft "Asset Status
///         Interface for Tokenized Assets" (first circulated as ERC-8391).
///         The draft standardizes token-level operational status discovery:
///         every enum reserves UNKNOWN = 0, views never revert, and return
///         values never depend on msg.sender.
///         Ref: https://ethereum-magicians.org/t/erc-8392-asset-status-interface-for-tokenized-assets/29489
interface IAssetStatus {
    /// @dev Lifecycle of the token program itself.
    enum Lifecycle {
        UNKNOWN, // 0 — status unavailable
        PRE_ACTIVE, // program announced/deployed, not yet operational
        ACTIVE, // normal operation
        SETTLEMENT_PENDING, // terminal event in progress (merger cash-out, wind-down)
        TERMINATED // program concluded; token is a claim residue at most
    }

    /// @dev Operational status of the program, orthogonal to lifecycle.
    enum ProgramStatus {
        UNKNOWN, // 0
        NORMAL, // issuer operations functioning as designed
        SUSPENDED // issuer has suspended normal operations (ops/legal/technical)
    }

    /// @notice Current program status. MUST NOT revert; MUST NOT depend on msg.sender.
    /// @return lifecycle       lifecycle state of the token program
    /// @return programStatus   operational status
    /// @return lifecycleAsOf   unix time lifecycle was last affirmed (0 = unknown)
    /// @return programAsOf     unix time programStatus was last affirmed (0 = unknown)
    function assetStatus()
        external
        view
        returns (
            Lifecycle lifecycle,
            ProgramStatus programStatus,
            uint64 lifecycleAsOf,
            uint64 programAsOf
        );
}

interface IReferenceMarketStatus {
    /// @dev Scheduled session state of the reference market.
    enum Session {
        UNKNOWN, // 0
        REGULAR, // continuous trading in the venue's primary session
        EXTENDED, // any scheduled non-primary trading session
        AUCTION, // scheduled or triggered auction/call phase
        CLOSED // any scheduled non-trading period, including intraday breaks
    }

    /// @dev Unscheduled interruption state, orthogonal to Session.
    enum Interruption {
        UNKNOWN, // 0
        NONE, // no known interruption
        PRICE_CONSTRAINED, // trading continues but constrained by a price-limit mechanism
        ASSET_HALTED, // this asset specifically halted by the venue
        VENUE_HALTED // the venue/market as a whole halted
    }

    /// @notice Session and interruption state of the reference market.
    /// @return session                 scheduled session state
    /// @return interruption            unscheduled interruption state
    /// @return sessionAsOf             unix time session state last affirmed
    /// @return interruptionAsOf        unix time interruption state last affirmed
    /// @return nextScheduledTransition unix time of next scheduled session change
    ///                                 (0 = unknown); scheduled transitions only
    /// @return marketId                ISO 10383 MIC as uppercase ASCII,
    ///                                 right-padded with zero bytes
    ///                                 (bytes32(0) = unknown or no listed venue)
    function referenceMarketStatus()
        external
        view
        returns (
            Session session,
            Interruption interruption,
            uint64 sessionAsOf,
            uint64 interruptionAsOf,
            uint64 nextScheduledTransition,
            bytes32 marketId
        );
}
