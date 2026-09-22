# Aegis

**The compliance circuit breaker for tokenized equities.**

On-chain compliance shield for Tokenized Securities Venues (TSVs) operating
under the SEC **Innovation Exemption** issued on 2026-09-17 (press release
[2026-90](https://www.sec.gov/newsroom/press-releases/2026-90-sec-issues-innovation-exemption-facilitate-trading-tokenized-nms-stock-request-comment)).

A Tokenized Securities Venue (TSV) operating under the exemption must, among
other conditions, (a) stop trading a tokenized stock concurrently with any
halt of the underlying NMS stock on its primary listing exchange, and
(b) enforce per-symbol volume caps (0.25% / 2.5% of prior-month ADV by tier).
This middleware puts both conditions on-chain so any AMM or venue can
inherit them with a single check.

## Scope & disclaimer

TSV Aegis is open-source developer tooling and a reference implementation.
It does not operate a trading venue, issue securities, provide brokerage
services, custody assets, perform KYC/AML, or guarantee regulatory
compliance. Market-data integrations are optional, subject to provider
entitlements, and require independent validation by each deployer.

The Base Sepolia deployment uses simulated events and test assets only. It
is not production infrastructure and must not be used to facilitate live
securities trading.

## Architecture

```mermaid
flowchart LR
    A[US market data<br/>Polygon.io · v1<br/>Chainlink 24/5 Streams · v2] --> B[oracle.js<br/>relay node]
    B -->|setStockHaltStatus / recordVolume| C[TSVGuard.sol]
    C -->|tradingEnabled\(\)| D[AMM pool / TSV venue]
    C -->|status events| E[ERC-8391-compatible<br/>status surface · planned]
```

The data-source side is pluggable: v1 relays Polygon.io LULD signals, v2
adds a native Chainlink 24/5 U.S. Equities Streams adapter
([#4](https://github.com/themis-labs/tsv-aegis/issues/4)). The execution
side will expose halt status through an ERC-8391-compatible interface so
integrators read a standard enum instead of project-specific getters
([#3](https://github.com/themis-labs/tsv-aegis/issues/3)).

Two independent stop conditions, two separate flags:

- **Market halt** — relayed from LULD signals; matches the order's
  concurrent-stoppage condition.
- **Daily volume cap** — recorded volume is tallied per UTC day with lazy
  rollover; hitting the cap disables trading until the next day.

Keeping the flags separate matters: a day rollover must never clear an
active market halt. Day rollover is lazy (derived from `block.timestamp`)
with a permissionless `rollDay()` that Keepers-style automation can call.

## MVP scope — and what it is not

This repo is the grant-demo MVP. The oracle is a single relay key
(`ORACLE_ROLE`), and volume accounting is recorded by the relay rather than
intercepted inside the swap path. The production evolution (see Roadmap
below) replaces these with: multi-source threshold signatures
(2-of-3), private-mempool submission for halt transactions, Uniswap v4
`beforeSwap` atomic interception, and ERC-3643 `canTransfer` coverage for
off-venue transfers. Coverage is limited to pools and tokens that integrate
the guard — liquidity elsewhere is out of scope by design.

## Roadmap

- **v1 (this repo)** — Polygon.io LULD relay, single `ORACLE_ROLE`,
  relay-recorded volume accounting. Goal: prove the two stop conditions
  on-chain with minimal surface.
- **v2** — ERC-8391-compatible asset status surface
  ([#3](https://github.com/themis-labs/tsv-aegis/issues/3)); Chainlink
  24/5 U.S. Equities Streams as a native on-chain status source, removing
  the single-relay trust assumption
  ([#4](https://github.com/themis-labs/tsv-aegis/issues/4)).
- **Production hardening** — multi-source threshold signatures (2-of-3),
  private-mempool submission for halt transactions, Uniswap v4
  `beforeSwap` atomic interception, ERC-3643 `canTransfer` coverage for
  off-venue transfers.

Halt synchronization minimizes the cross-market arbitrage window; it does
not promise zero-latency parity with the primary exchange — propagation
and block times always apply.

## Data source notes

`oracle.js` subscribes to Polygon.io's stocks WebSocket (`LULD.<ticker>`).
That channel requires a plan that includes it; without the entitlement,
fall back to polling SIP market status over REST and call the same
`setStockHaltStatus` interface. The v2 Chainlink adapter consumes the
24/5 equities streams' market-status field instead, which removes the
polling trust assumption entirely.

## Quick start (Base Sepolia)

Aegis is deployed on [Base](https://base.org). The guard contract is plain
EVM — the same bytecode runs on any OP Stack or Ethereum chain, but Base is
the reference deployment and the network the oracle relay defaults to.

```bash
npm install
cp .env.example .env   # fill in PRIVATE_KEY (testnet), POLYGON_API_KEY
npm run compile
npm test               # unit tests: halt/resume, cap breach, day rollover, ACL

npm run deploy:base-sepolia
# paste the deployed address into .env as GUARD_ADDRESS, then:
npm run start:oracle
```

For mainnet, use `npm run deploy:base` with `BASE_RPC` and a funded deployer
key. Arbitrum Sepolia remains available via `npm run deploy:arbitrum-sepolia`
for cross-chain testing.

With `VERIFY=true` and an [Etherscan V2](https://docs.etherscan.io/) API key
set (one key covers Basescan, Arbiscan, and Etherscan), deployment also
verifies the contract source on the explorer.

## Repository layout

```
contracts/TSVGuard.sol          core guard contract (AccessControl, dual stop flags)
contracts/interfaces/ITSVGuard.sol  integration surface for AMMs / venues
scripts/deploy.js               cross-chain deploy + optional source verification
scripts/oracle.js               LULD listener relaying halt signals on-chain
test/TSVGuard.test.js           unit tests
```

## Compliance mapping

| Exemption condition                                     | On-chain mechanism                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Concurrent stoppage with underlying NMS stock           | `setStockHaltStatus` relayed from LULD feed, gate via `tradingEnabled()`           |
| Volume limits (0.25% / 2.5% of prior-month ADV by tier) | `recordVolume` + `maxDailyCap`, per-UTC-day tally, cap update via `setMaxDailyCap` |
| Auditable, public contracts on a permissionless ledger  | MIT-licensed source, verified on explorer, deployed to public testnets/mainnets    |

Regulatory references: SEC press release 2026-90 and the underlying order
(2026-09-17). The exemption is open for public comment; conditions may be
revised — check the current order text before relying on specific numbers.

## License

MIT
