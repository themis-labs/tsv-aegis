# Security assumptions and threat model

Trust assumptions behind Aegis and the known limitations of the v1 reference
implementation, with the mitigation path for each. Written for security
reviewers and integrators wiring `tradingEnabled()` into a venue.

## Trust model

`TSVGuard` has two roles:

- **Admin (`DEFAULT_ADMIN_ROLE`)** — manages roles and sets the reference market
  MIC (`setMarketId`); holds no halt, volume, or session powers of its own.
- **Oracle relay (`ORACLE_ROLE`)** — pushes halt/resume signals, records executed
  volume, updates the daily cap, and reports the venue session. In the reference
  setup this is one hot key used by `scripts/oracle.js`; the
  `ChainlinkStreamsAdapter` contract also holds it so verified reports push halt
  state without a relay key.

No role can move user funds. The guard holds no ether, tokens, or allowances; it
is a permission check (`tradingEnabled()`) plus accounting state. The worst a
compromised role can do is stop trading, resume it against policy, or corrupt
the volume tally — each an on-chain event, reversible by the admin.

## Known limitations and mitigations

### Single-signer oracle relay

- **Limitation.** One `ORACLE_ROLE` key drives halt, volume, and cap state. A
  compromised relay key can halt trading or withhold a halt; it cannot steal
  funds — there is nothing in the contract to steal.
- **Current exposure.** Halt liveness and tally accuracy rest on one key's
  custody and on the relay process staying up.
- **Mitigation path.** Threshold (2-of-3) relays are on the v1.0 roadmap. The
  streams adapter already provides a relay-free path (DON-verified,
  permissionless submission). Until then, custody the relay key in a KMS or HSM,
  never in a plaintext env var.

### Halt-transaction inclusion delay

- **Limitation.** A halt takes effect at inclusion, not at the venue's halt
  time; a pending halt sits in the public mempool and can in principle be
  front-run.
- **Current exposure.** The design minimizes the cross-market arbitrage window;
  it does not promise zero-latency parity with the primary exchange —
  propagation and block times always apply.
- **Mitigation path.** Private-mempool or direct-sequencer submission for halt
  transactions (roadmap). Integrators with stricter latency needs should treat
  the guard as a floor, not a clock.

### Volume-cap manipulation

- **Limitation.** The daily cap is only as honest as the volume tally.
- **Current exposure.** v1 is not directly exposed to wash trading: volume is
  relay-recorded via `recordVolume`, not tallied from the swap path, so
  third-party trading cannot inflate the tally; the exposure is inverted — a
  relay that under-records weakens the cap.
- **Mitigation path.** Integrators wiring their own volume sources must record
  only executed volume from pools that honor the guard; moving volume
  accounting into the swap path is on the v1.0 roadmap.

### Oracle initialization state

Current source on `main` is fail-closed: `tradingEnabled()` returns false until
the first halt-status report arrives. The recorded deployments run earlier
bytecode (per the README's commit SHAs): the Base instances pre-date the
ERC-8392 surface and fail-closed initialization, the Arbitrum Sepolia instance
pre-dates fail-closed initialization — those guards read as trading-enabled
before the first report.

### Stale or unknown feed state

The streams adapter fails closed on every degraded input. Unknown or Closed
market status, unmapped status values, a mid stale beyond `maxStaleness`, and a
non-positive mid all resolve to trading-disabled; malformed or wrong-feed
reports revert without touching guard state. Chainlink does not flag LULD halts
in `marketStatus`; a halted venue stops publishing, so a quiet feed is a halt
signal.

## Operator checklist

- Use separate keys for the admin and the relay; do not reuse the deployer key
  as `ORACLE_ROLE`.
- Custody the relay key in a KMS or HSM, not in plaintext env files on shared
  hosts.
- Monitor halt-status freshness (`haltStatusUpdatedAt`); alert when it lags the
  venue's own halt feed.
- After any rehearsal or demo, leave the guard in the intended state and verify
  it on-chain — a stuck halt is visible to every integrator.

## Reporting

Suspected vulnerabilities: see [SECURITY.md](../SECURITY.md).
