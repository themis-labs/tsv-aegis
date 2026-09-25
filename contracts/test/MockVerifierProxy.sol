// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Pass-through stand-in for Chainlink's VerifierProxy, used only in
///         unit tests. The real proxy checks the DON signature and returns
///         the embedded report body; signature verification belongs to
///         Chainlink's deployed contracts, so the mock skips straight to the
///         part the adapter is responsible for: decoding and mapping.
contract MockVerifierProxy {
    // Non-payable on purpose: the adapter never sends value, and a payable
    // mock with no withdrawal path would lock any ether sent by mistake.
    function verify(bytes calldata payload, bytes calldata) external returns (bytes memory) {
        (, bytes memory reportData) = abi.decode(payload, (bytes32[3], bytes));
        return reportData;
    }
}
