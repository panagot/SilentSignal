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

async function fromDex(chainName, tokenAddress) {
  const dexChain = chainToDex(chainName)
  if (!dexChain) return null
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)
  if (!res.ok) return null
  const payload = await res.json()
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : []
  const candidate = pairs.find((p) => p?.chainId === dexChain) ?? pairs[0]
  const marketCap = Number(candidate?.marketCap ?? candidate?.fdv ?? NaN)
  const priceUsd = Number(candidate?.priceUsd ?? NaN)
  return {
    marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
    priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
  }
}

async function main() {
  const apiKey = readApiKey()
  const { chainName, tokenAddress } = readArgs()
  const client = new GoldRushClient(apiKey)

  const priceRes = await client.PricingService.getTokenPrices(chainName, 'USD', tokenAddress)
  const tokenData = priceRes.data?.[0]
  const goldRushPrice = Number(tokenData?.items?.[0]?.price ?? NaN)
  const dex = await fromDex(chainName, tokenAddress)
  const price = Number.isFinite(goldRushPrice) ? goldRushPrice : dex?.priceUsd
  if (!Number.isFinite(price)) throw new Error('No valid price found (GoldRush + Dex fallback)')

  let goldRushCap = null
  try {
    const holders = await client.BalanceService.getTokenHoldersV2ForTokenAddressByPage(
      chainName,
      tokenAddress,
      { pageSize: 100, pageNumber: 0 },
    )
    const row = holders.data?.items?.[0]
    if (row?.total_supply !== undefined && row?.total_supply !== null) {
      const decimals = row.contract_decimals ?? tokenData?.contract_decimals ?? 18
      const supply = Number(row.total_supply) / 10 ** decimals
      goldRushCap = Number.isFinite(supply) ? supply * price : null
    }
  } catch {
    goldRushCap = null
  }

  const dexCap = dex?.marketCap ?? null
  const finalCap = goldRushCap && goldRushCap > 0 ? goldRushCap : dexCap
  console.log(JSON.stringify({
    test: 'marketcap',
    chainName,
    tokenAddress,
    priceUsd: price,
    priceSource: Number.isFinite(goldRushPrice) ? 'goldrush' : 'dex-fallback',
    marketCapFromGoldRush: goldRushCap,
    marketCapFromDexScreener: dexCap,
    selectedMarketCap: finalCap,
    status: finalCap ? 'PASS' : 'FAIL',
  }, null, 2))
}

main().catch((error) => {
  console.error('FAIL:', error.message)
  process.exit(1)
})
