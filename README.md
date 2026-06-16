# ZKGRM Jetton + Miner

A TON smart contract repository for the ZKGRM jetton and proof-of-work miner stack.

## Project overview

This repository contains:

- `contracts/jetton-minter.fc` — ZKGRM Jetton Minter with admin-controlled minting, wallet status modes, metadata content, and upgrade support.
- `contracts/jetton-wallet.fc` — Jetton wallet implementation with both `user` and `protocol` modes, payload policy checks, and transfer restrictions.
- `contracts/miner.fc` — Miner contract that mines PoW rewards into jetton wallets, auto-discovers its jetton wallet via `transfer_notification`, and supports explicit reward recipients.
- `contracts/helpers/` — helper libraries and shared contract functions.
- `wrappers/` — TypeScript wrappers for `JettonMinter`, `JettonWallet`, `Miner`, and contract utilities.
- `scripts/` — deployment, upgrade, wallet check, and maintenance scripts.
- `tests/` and `sandbox_tests/` — Jest and sandbox integration test coverage.
- `zkgram-jetton-metadata.json` and `logo.png` — ZKGRM token metadata and branding.

## What this repo does

ZKGRM is a privacy-aware jetton on TON with a protocol-mode wallet policy designed for contract-driven flows. Ordinary user wallets are restricted from direct transfers, while protocol wallets can perform standard TEP-74 interactions and contract payload processing.

The miner contract provides a PoW reward mechanism that issues jettons to miner wallets and forwards rewards to recipients.

## Key features

- ZKGRM token metadata and branding: `name = ZKGRM`, `symbol = ZKGRM`, `decimals = 9`.
- Admin-managed jetton minter with:
  - `mint`
  - `top_up`
  - `set_status`
  - `change_admin`
  - `upgrade`
- Jetton wallet status modes:
  - `user` mode: restricted direct transfers and safer ordinary holding behavior.
  - `protocol` mode: allows payload transfers for DEX / miner / pool logic.
- Miner contract behaviors:
  - PoW mining reward generation,
  - auto-discovery of jetton wallet from `transfer_notification`,
  - explicit reward recipient support,
  - difficulty retargeting.
- TypeScript wrappers and scripts enable contract deployment, interaction, and local tests.

## Repository structure

- `contracts/` — FunC source contracts for jetton minter, wallet, miner, and utilities.
- `build/` — compiled contract artifacts and generated Fift outputs.
- `wrappers/` — TypeScript contract wrappers and helpers.
- `scripts/` — CLI scripts for deployment, upgrades, status changes, and metadata updates.
- `tests/`, `sandbox_tests/` — integration and sandbox tests.
- `zkgram-jetton-metadata.json` — token metadata for ZKGRM.
- `logo.png` — branding image for the token metadata.

## Quick start

Install dependencies:

```bash
npm install
```

Build contracts:

```bash
npm run build
```

Run tests:

```bash
npm run test
```

Run Blueprint commands:

```bash
npm start
```

Or use explicit Blueprint CLI:

```bash
npx blueprint run <script>
```

## License

This repository is released under the terms of its existing license.
