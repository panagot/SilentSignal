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
