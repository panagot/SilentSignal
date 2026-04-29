import { GoldRushClient } from '@covalenthq/client-sdk'
import { readApiKey, readArgs } from './shared.js'

function chainToDex(chainName) {
  return {
    'eth-mainnet': 'ethereum',
    'base-mainnet': 'base',
    'matic-mainnet': 'polygon',
    'bsc-mainnet': 'bsc',
  }[chainName]
}

async function fallbackDexPrice(chainName, tokenAddress) {
  const dexChain = chainToDex(chainName)
  if (!dexChain) return null
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)
  if (!res.ok) return null
  const payload = await res.json()
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : []
  const row = pairs.find((pair) => pair?.chainId === dexChain) ?? pairs[0]
  const price = Number(row?.priceUsd ?? NaN)
  return Number.isFinite(price) ? price : null
}

async function main() {
  const apiKey = readApiKey()
  const { chainName, tokenAddress } = readArgs()
  const client = new GoldRushClient(apiKey)
  const response = await client.PricingService.getTokenPrices(chainName, 'USD', tokenAddress)
  const token = response.data?.[0]
  if (!token) {
    console.log('FAIL: No token pricing data returned')
    process.exit(1)
  }

  const goldRushPrice = token.items?.[0]?.price ?? null
  const dexPrice = await fallbackDexPrice(chainName, tokenAddress)
  const latest = goldRushPrice ?? dexPrice
  const symbol = token.contract_ticker_symbol ?? 'UNKNOWN'
  console.log(JSON.stringify({
    test: 'price',
    chainName,
    tokenAddress,
    symbol,
    goldRushPriceUsd: goldRushPrice,
    dexFallbackPriceUsd: dexPrice,
    latestPriceUsd: latest,
    pointsReturned: token.items?.length ?? 0,
    status: latest !== null ? 'PASS' : 'FAIL',
  }, null, 2))
  if (latest === null) process.exit(1)
}

main().catch((error) => {
  console.error('FAIL:', error.message)
  process.exit(1)
})
