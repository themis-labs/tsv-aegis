# Security Policy

## Supported versions

This project is pre-1.0. Only the latest state of the `main` branch (and
the most recent tagged release, once published) receives fixes. Deployments
pinned to older commits should be treated as unsupported.

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub's
[private vulnerability reporting](https://github.com/themis-labs/tsv-aegis/security/advisories/new)
for this repository. Do not open a public issue for a security report.

Include enough detail to reproduce the problem: affected contract or
script, the scenario, and the impact you believe is possible. We will
acknowledge reports as time permits and coordinate disclosure with the
reporter once a fix is available. There is no bug bounty program.

## Scope notes

The following are documented design properties, not vulnerabilities:

- **Single-relay trust assumption.** In v1 the oracle is one `ORACLE_ROLE`
  key. A compromised or malicious relay can halt or resume trading at
  will. This is stated in the README and is replaced by multi-source
  threshold signatures on the roadmap.
- **Relay-recorded volume accounting.** Volume is recorded by the relay
  rather than intercepted inside the swap path in v1.
- **Deployment-specific operational security.** Private key management,
  RPC endpoint integrity, and market-data provider entitlements are the
  deployer's responsibility.
- **Testnet deployments.** Base Sepolia deployments use simulated events
  and test assets only.

Issues in the guard contract's access control, halt/cap accounting logic,
day-rollover behavior, or in the deploy/simulation tooling are in scope
and welcome.
