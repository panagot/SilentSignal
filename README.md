# SilentSignal

SilentSignal is an intent-based execution demo that combines:

- GoldRush market + wallet data
- solver simulation and trust scoring
- MEV-shield concept modeling
- optional live execution path on Base Sepolia

## App Commands

- `npm run dev` - start local UI
- `npm run lint` - run lint checks
- `npm run build` - production build
- `npm run test:intentflow` - buy/sell intent flow validation

## Live Execution (Base Sepolia)

The app includes a `Live Execution (Base Sepolia)` panel for:

1. connecting wallet
2. signing EIP-712 intent
3. locking ETH on settlement contract
4. filling the intent on-chain

## Verified Example (Live Sepolia Transactions)

The project includes a proven Sepolia transfer run with real tx hashes:

1. Sender -> Maker funding (`0.0003 ETH`)
   - `0x3528bfd2530204d254ae9a80b78201cdaf4502b92dad502af739375b387e4448`
2. Sender -> Solver funding (`0.0003 ETH`)
   - `0x0b6fc3a3677cd96f5c93e603636dd5a2a0a41970f333e572ad2e6383a8755ed8`
3. Maker -> Solver test transfer (`0.00005 ETH`)
   - `0xeed83f09fc8603ff49771d5190ed49cac829ba8757f662c86621365e76407f12`

These demonstrate real testnet wallet generation, funding, and transaction execution.

### LP clarity

- **LP usage in verified tx hashes above:** `0` pools  
  (these are funding/transfer proofs, not routed swap fills)
- **LP usage in SilentSignal order simulation:** `3` venues  
  (`Pool A / Pool B / Pool C` split-and-merge route model)

This distinction is intentional: the verified hashes prove live chain execution,
while the simulation section demonstrates solver multi-LP routing behavior.

### Environment

Copy `.env.example` and fill values:

- `VITE_GOLDRUSH_API_KEY`
- `VITE_SETTLEMENT_CONTRACT_ADDRESS` (after deployment)
- `BASE_SEPOLIA_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

## Settlement Contract

Compile:

- `npm run contracts:compile`

Deploy to Base Sepolia:

- `npm run contracts:deploy:base-sepolia`

The deploy command prints the settlement contract address. Add that to
`VITE_SETTLEMENT_CONTRACT_ADDRESS` for frontend usage.
