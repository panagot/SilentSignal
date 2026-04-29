import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_CA = '0x696969A73cFE28165e94f0924D3c940A55BC483e'
export const DEFAULT_CHAIN = 'eth-mainnet'

export function readApiKey() {
  const envPath = path.resolve('.env.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.local file with VITE_GOLDRUSH_API_KEY')
  }
  const raw = fs.readFileSync(envPath, 'utf8')
  const match = raw.match(/^VITE_GOLDRUSH_API_KEY=(.+)$/m)
  if (!match?.[1]) throw new Error('VITE_GOLDRUSH_API_KEY missing in .env.local')
  return match[1].trim()
}

export function readArgs() {
  const chainName = process.argv[2] ?? DEFAULT_CHAIN
  const tokenAddress = process.argv[3] ?? DEFAULT_CA
  return { chainName, tokenAddress }
}
