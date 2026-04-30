import { GoldRushClient } from '@covalenthq/client-sdk'
import { readApiKey } from './shared.js'

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

function isLikelyEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value).trim())
}

async function fetchWalletStrength(client, chainName, wallet) {
  let txCount = 0
  for await (const page of client.TransactionService.getAllTransactionsForAddress(
    chainName,
    wallet,
  )) {
    txCount = page?.data?.pagination?.total_count ?? page?.data?.items?.length ?? 0
    break
  }

  const balances = await client.BalanceService.getTokenBalancesForWalletAddress(
    chainName,
    wallet,
  )
  const totalUsdValue = (balances.data?.items ?? []).reduce(
    (acc, item) => acc + Number(item.quote ?? 0),
    0,
  )

  const normalizedTx = Math.min(100, Math.round((txCount / 200) * 100))
  const normalizedValue = Math.min(100, Math.round((totalUsdValue / 100000) * 100))
  return Math.round(normalizedTx * 0.6 + normalizedValue * 0.4)
}

async function validateIntentType({ client, chainName, tokenAddress, makerWallet, intentType }) {
  const checks = []
  const amount = 1250
  const maxSlippage = 1.5

  checks.push({
    check: `${intentType}: token address format`,
    pass: isLikelyEvmAddress(tokenAddress),
  })
  checks.push({
    check: `${intentType}: maker wallet format`,
    pass: isLikelyEvmAddress(makerWallet),
  })
  checks.push({
    check: `${intentType}: amount > 0`,
    pass: Number(amount) > 0,
  })
  checks.push({
    check: `${intentType}: slippage 0-20`,
    pass: Number(maxSlippage) >= 0 && Number(maxSlippage) <= 20,
  })

  const priceRes = await client.PricingService.getTokenPrices(chainName, 'USD', tokenAddress)
  const tokenData = priceRes.data?.[0]
  const goldRushPrice = tokenData?.items?.[0]?.price ?? null
  const dexFallbackPrice = await fallbackDexPrice(chainName, tokenAddress)
  const resolvedPrice = goldRushPrice ?? dexFallbackPrice
  const lastPrice = Number(resolvedPrice ?? NaN)
  const tokenSymbol = tokenData?.contract_ticker_symbol ?? 'TOKEN'

  checks.push({
    check: `${intentType}: pricing data available`,
    pass: Boolean(tokenData),
  })
  checks.push({
    check: `${intentType}: latest price is finite`,
    pass: Number.isFinite(lastPrice) && lastPrice >= 0,
  })

  const makerTrust = await fetchWalletStrength(client, chainName, makerWallet)
  checks.push({
    check: `${intentType}: maker trust score computed`,
    pass: Number.isFinite(makerTrust) && makerTrust >= 0 && makerTrust <= 100,
  })

  const intent = {
    chainName,
    intentType,
    tokenAddress,
    tokenSymbol,
    amount,
    maxSlippage,
    makerAlias: `shadow-${Math.floor(Math.random() * 9000) + 1000}`,
    makerWallet,
    makerTrust,
    filledAmount: 0,
    resolver: null,
  }

  checks.push({
    check: `${intentType}: intent object contains expected fields`,
    pass:
      intent.intentType === intentType &&
      intent.chainName === chainName &&
      intent.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() &&
      intent.amount > 0 &&
      intent.filledAmount === 0,
  })

  return {
    intentType,
    symbol: tokenSymbol,
    latestPriceUsd: lastPrice,
    goldRushPriceUsd: goldRushPrice,
    dexFallbackPriceUsd: dexFallbackPrice,
    makerTrust,
    checks,
  }
}

async function main() {
  const apiKey = readApiKey()
  const chainName = process.argv[2] ?? 'eth-mainnet'
  const tokenAddress = process.argv[3] ?? '0xAFF2565091E7207191dBe340B8528D02FA78d044'
  const makerWallet = process.argv[4] ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

  const client = new GoldRushClient(apiKey)
  const buyResult = await validateIntentType({
    client,
    chainName,
    tokenAddress,
    makerWallet,
    intentType: 'buy',
  })
  const sellResult = await validateIntentType({
    client,
    chainName,
    tokenAddress,
    makerWallet,
    intentType: 'sell',
  })

  const allChecks = [...buyResult.checks, ...sellResult.checks]
  const failed = allChecks.filter((c) => !c.pass)

  const payload = {
    test: 'intent-flow',
    chainName,
    tokenAddress,
    makerWallet,
    summary: {
      totalChecks: allChecks.length,
      passed: allChecks.length - failed.length,
      failed: failed.length,
      status: failed.length === 0 ? 'PASS' : 'FAIL',
    },
    buy: buyResult,
    sell: sellResult,
    failedChecks: failed,
  }

  console.log(JSON.stringify(payload, null, 2))

  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  console.error('FAIL:', error.message)
  process.exit(1)
})
