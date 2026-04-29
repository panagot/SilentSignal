import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_CHAIN, DEFAULT_CA } from './shared.js'

const SAMPLE_TOKENS = [
  { label: 'User Example', chain: 'eth-mainnet', ca: DEFAULT_CA },
  { label: 'MYSTERY', chain: 'eth-mainnet', ca: '0x45547AB0100f5E8b158258b6d94D7586De69fc21' },
  { label: 'PEPE', chain: 'eth-mainnet', ca: '0x6982508145454Ce325dDbE47a25d4ec3d2311933' },
  { label: 'WETH', chain: 'eth-mainnet', ca: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  { label: 'USDC', chain: 'eth-mainnet', ca: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
]

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: 'pipe' })
}

function parseJsonOutput(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function main() {
  const args = process.argv.slice(2)
  const writeCsv = args.includes('--csv')
  const chainOverride = args.find((arg) => !arg.startsWith('--')) ?? null
  const tokens = SAMPLE_TOKENS.map((token) => ({
    ...token,
    chain: chainOverride ?? token.chain ?? DEFAULT_CHAIN,
  }))

  const rows = []
  for (const token of tokens) {
    try {
      const priceRaw = run(`node scripts/test-price.js ${token.chain} ${token.ca}`)
      const capRaw = run(`node scripts/test-marketcap.js ${token.chain} ${token.ca}`)
      const price = parseJsonOutput(priceRaw)
      const cap = parseJsonOutput(capRaw)

      rows.push({
        token: token.label,
        chain: token.chain,
        symbol: price?.symbol ?? 'N/A',
        ca: token.ca,
        priceUsd: price?.latestPriceUsd ?? null,
        marketCap: cap?.selectedMarketCap ?? null,
        priceStatus: price?.status ?? 'FAIL',
        capStatus: cap?.status ?? 'FAIL',
      })
    } catch {
      rows.push({
        token: token.label,
        chain: token.chain,
        symbol: 'N/A',
        ca: token.ca,
        priceUsd: null,
        marketCap: null,
        priceStatus: 'FAIL',
        capStatus: 'FAIL',
      })
    }
  }

  const payload = { test: 'batch', rows }
  console.log(JSON.stringify(payload, null, 2))

  if (writeCsv) {
    const reportDir = path.resolve('test-reports')
    fs.mkdirSync(reportDir, { recursive: true })
    const csvPath = path.join(reportDir, 'batch-report.csv')
    const header = [
      'token',
      'chain',
      'symbol',
      'ca',
      'priceUsd',
      'marketCap',
      'priceStatus',
      'capStatus',
    ]
    const lines = [
      header.join(','),
      ...rows.map((row) =>
        [
          row.token,
          row.chain,
          row.symbol,
          row.ca,
          row.priceUsd ?? '',
          row.marketCap ?? '',
          row.priceStatus,
          row.capStatus,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ]
    fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8')
    console.log(`CSV report written: ${csvPath}`)
  }
}

main()
