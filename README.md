<div align="center">

# SilentSignal

### Privacy-Aware Intent Execution with On-Chain Settlement Guardrails

**Submit a high-level buy/sell intent. Solver agents compete to fill it confidentially across multiple LP venues. On-chain guardrails enforce safe, verifiable settlement.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-silent--signal--gamma.vercel.app-0ea5e9?style=for-the-badge)](https://silent-signal-gamma.vercel.app/)
[![Network](https://img.shields.io/badge/Network-Ethereum%20Sepolia-627EEA?style=for-the-badge)](https://sepolia.etherscan.io/)
[![Built With](https://img.shields.io/badge/Built%20with-GoldRush%20%2B%20Ethers-14b8a6?style=for-the-badge)](https://goldrush.dev/)

</div>

---

## Why SilentSignal

Today's on-chain trading is **publicly broadcast**: every order signals direction, size, and routing to anyone watching the mempool. That leaks information, invites MEV, and forces traders to manually fragment orders across venues.

SilentSignal flips the model. Users describe **what they want**, not how to route. They sign a high-level intent — a private envelope containing the desired outcome plus on-chain guardrails — and a competitive solver layer turns that intent into the best possible fill across multiple LPs. Settlement is guarded, signed, and verifiable on-chain.

> **Short pitch:** SilentSignal lets users execute high-size on-chain orders with better privacy and execution quality by using solver agents that confidentially route and split flow across multiple LPs, while on-chain guardrails (max input, min output, expiry, signatures) enforce safe settlement.

## Live demo

- App: <https://silent-signal-gamma.vercel.app/>
- Repo: <https://github.com/panagot/SilentSignal>
- Network: Ethereum Sepolia (chainId `11155111`)

## What's inside

| Surface | What it does |
|---|---|
| **Intent Desk** | Build and publish a stealth buy/sell intent with on-chain guardrails (max input, min output, slippage, expiry). Live market data via the **GoldRush** SDK with a **DexScreener** fallback. |
| **1 ETH Simulation** | Models a complete buy/sell flow against live prices: solver competition, multi-LP route split (Pool A / B / C), and best-fill quote. Also visualizes the difference between Shield-on and Shield-off execution paths. |
| **Live Execution (Sepolia)** | Real on-chain flow against the deployed `IntentSettlement` contract: connect wallet, sign EIP-712 intent, lock ETH, approve token, fill. Tx hashes and Etherscan links surface in the UI. |
| **Solver Engine** | Ranks solver candidates by trust score (derived from GoldRush wallet history), spread, and ETA. |
| **Analytics** | Session metrics: intents tracked, open / executed counts, latest fill rate. |
| **MEV Shield Controls** | Toggle a privacy posture: private relay, commit-reveal, short-lived intents, randomized slicing, solver allowlist, batch auction window. |

## How it works

```
User intent (signed EIP-712)
        │
        ▼
SilentSignal app  ──►  Solver auction  ──►  Best solver fills
        │                  (private)            (multi-LP split)
        │
        ▼
IntentSettlement.sol
  - lockIntent(hash, nonce, expiry)  payable
  - fillIntent(intent, amountIn, amountOut, sig)
  - hashIntentStruct(intent)         pure
        │
        ▼
On-chain settlement on Ethereum Sepolia
```

The settlement contract enforces:

- intent integrity via EIP-712 hash + signature recovery
- per-intent **maxInput**, **minOutput**, **expiry**, **nonce**, and **allowPartial** flags
- maker/solver separation (with an opt-in self-fill demo mode for solo testing)

## Verified live transactions

These are real Sepolia tx hashes you can replay end-to-end. They prove the wallet, funding, and transfer paths used by SilentSignal:

| Step | Tx hash | Description |
|---|---|---|
| 1 | [`0x3528bf...e4448`](https://sepolia.etherscan.io/tx/0x3528bfd2530204d254ae9a80b78201cdaf4502b92dad502af739375b387e4448) | Sender → maker funding (`0.0003 ETH`) |
| 2 | [`0x0b6fc3...55ed8`](https://sepolia.etherscan.io/tx/0x0b6fc3a3677cd96f5c93e603636dd5a2a0a41970f333e572ad2e6383a8755ed8) | Sender → solver funding (`0.0003 ETH`) |
| 3 | [`0xeed83f...07f12`](https://sepolia.etherscan.io/tx/0xeed83f09fc8603ff49771d5190ed49cac829ba8757f662c86621365e76407f12) | Maker → solver test transfer (`0.00005 ETH`) |

> **LP usage notes:** the verified transfer hashes use **0** liquidity pools — they prove the funding and transfer mechanics. The solver simulation panel demonstrates **3** virtual LP venues (Pool A / Pool B / Pool C) used for the routing model.

## Try the live execution flow

1. Open the app and connect a wallet on **Ethereum Sepolia**. The app auto-prompts a network switch (and adds Sepolia if missing) via EIP-3085 / EIP-3326.
2. Make sure your wallet holds a little Sepolia ETH (gas + the lock amount) and some Sepolia USDC for the solver leg.
3. Set **Settlement Contract**, **Token Out** (e.g. Sepolia USDC `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238`), and the input/output amounts.
4. Click in order: **Connect → Sign → Lock → Approve Token → Fill**.
5. Watch the toast log; once a tx confirms, copy the hash or open it on Etherscan from the UI.

A **Demo self-solver mode** toggle lets the maker wallet act as the solver too, so you can run the full flow with one wallet for judging.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        React + Vite UI (this repo)                  │
│                                                                    │
│   Intent Desk   ─►   Solver Engine   ─►   Live Execution panel     │
│        │                                       │                   │
│        ▼                                       ▼                   │
│  GoldRush SDK + DexScreener          ethers.js v6 / EIP-712        │
└────────────────────────────────────────────────────────────────────┘
            │                                          │
            ▼                                          ▼
┌─────────────────────────────┐           ┌──────────────────────────┐
│  GoldRush API               │           │  IntentSettlement.sol    │
│  - PricingService           │           │  Ethereum Sepolia        │
│  - BalanceService           │           │  Solidity 0.8.x +        │
│  - TransactionService       │           │  OpenZeppelin            │
└─────────────────────────────┘           └──────────────────────────┘
```

## Tech stack

- **Frontend:** React 19, Vite 8, framer-motion, lucide-react, react-hot-toast
- **Data:** `@covalenthq/client-sdk` (GoldRush) + DexScreener fallback
- **Web3:** ethers.js v6 (BrowserProvider, Contract, EIP-712 typed data)
- **Contracts:** Solidity + OpenZeppelin, deployed via Hardhat
- **Network:** Ethereum Sepolia (chainId `11155111`)
- **Hosting:** Vercel

## Repo layout

```
.
├── src/
│   ├── App.jsx                # Main UI: intent desk, simulation, live execution
│   ├── App.css                # Design system + component styles
│   ├── liveExecution.js       # IntentSettlement ABI + Sepolia constants
│   └── main.jsx
├── contracts/                 # IntentSettlement.sol (Hardhat)
├── scripts/
│   ├── deploy-settlement.js   # Deploy IntentSettlement to Sepolia
│   ├── test-intent-flow.js    # GoldRush + intent validation
│   ├── test-price.js
│   ├── test-marketcap.js
│   ├── test-batch.js
│   ├── test-full.js
│   └── test-sepolia-tx.js     # Live Sepolia transfer test
├── public/favicon.svg
├── index.html
├── vite.config.js
└── README.md
```

## Local setup

```bash
git clone https://github.com/panagot/SilentSignal.git
cd SilentSignal
npm install
cp .env.example .env.local
# Fill in:
#   VITE_GOLDRUSH_API_KEY=...
#   VITE_SETTLEMENT_CONTRACT_ADDRESS=0x... (after contract deploy)
#   SEPOLIA_RPC_URL=...
#   DEPLOYER_PRIVATE_KEY=...
npm run dev
```

## Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm run preview` | Preview the production build |
| `npm run test:price` | Validate GoldRush price lookup |
| `npm run test:marketcap` | Validate market cap (with DexScreener fallback) |
| `npm run test:full` | End-to-end data check on a token |
| `npm run test:batch` | Batch token test (with `--csv` flag for export) |
| `npm run test:intentflow` | Validate intent / solver pipeline |
| `npm run test:sepolia:tx` | Send a real Sepolia test transfer |
| `npm run contracts:compile` | Compile `IntentSettlement.sol` |
| `npm run contracts:deploy:base-sepolia` | Deploy `IntentSettlement` to Ethereum Sepolia |

## Settlement contract

`IntentSettlement.sol` exposes:

- `lockIntent(bytes32 intentHash, uint256 nonce, uint256 expiry) payable` — maker locks ETH against an intent hash.
- `fillIntent(Intent intent, uint256 amountInWei, uint256 amountOutTokens, bytes signature)` — solver pulls token out, releases ETH, validates EIP-712 signature and guardrails.
- `hashIntentStruct(Intent intent) pure` — canonical hash used for signing & locking.

Deploy with `npm run contracts:deploy:base-sepolia` (the script reads `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` from `.env.local`). After deploy, paste the printed address into `VITE_SETTLEMENT_CONTRACT_ADDRESS`.

## What makes this different from a DEX aggregator

A DEX aggregator (Kyber, 1inch) executes a public swap on the maker's behalf. SilentSignal is **intent + auction + guarded settlement**:

- The maker doesn't expose the route; they only sign the desired outcome.
- Solvers compete for the right to execute, similar to a sealed-bid auction.
- Routing across multiple LPs happens inside the solver, not in plain view of the mempool.
- The contract enforces safety bounds — even if a solver tries to misbehave, on-chain checks reject the fill.

## Hackathon submission

- Submitted to the **Frontier Hackathon** Colosseum profile: <https://arena.colosseum.org/profiles/PANAGOT>
- Demo video (Loom, tagging `@goldrushdev`): <https://www.loom.com/share/2defe3796d1146a8b22a3571a968aaca>

## License

MIT
