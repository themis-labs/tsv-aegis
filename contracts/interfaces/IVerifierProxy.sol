// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Chainlink-deployed entry point for on-chain Data Streams report
///         verification. The proxy routes each payload to the verifier
///         registered for its DON config digest. Per-network addresses:
///         https://docs.chain.link/data-streams/supported-networks
interface IVerifierProxy {
    /// @param payload Full report payload as returned by the Streams API.
    /// @param parameterPayload Fee metadata; empty bytes under subscription
    ///        billing (no per-call LINK funding or approval needed).
    /// @return verifierResponse ABI-encoded verified report body; decode
    ///         into the struct matching the report's schema version.
    function verify(
        bytes calldata payload,
        bytes calldata parameterPayload
    ) external payable returns (bytes memory verifierResponse);
}
