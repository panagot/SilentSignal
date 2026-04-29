import { execSync } from 'node:child_process'
import { DEFAULT_CHAIN, DEFAULT_CA } from './shared.js'

function run(cmd) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' })
}

function main() {
  const chainName = process.argv[2] ?? DEFAULT_CHAIN
  const tokenAddress = process.argv[3] ?? DEFAULT_CA

  const priceOut = run(`node scripts/test-price.js ${chainName} ${tokenAddress}`)
  const capOut = run(`node scripts/test-marketcap.js ${chainName} ${tokenAddress}`)

  console.log('=== SilentSignal Full Smoke Test ===')
  console.log(`Chain: ${chainName}`)
  console.log(`Token: ${tokenAddress}`)
  console.log('\n--- Price Test ---')
  console.log(priceOut.trim())
  console.log('\n--- Market Cap Test ---')
  console.log(capOut.trim())
}

try {
  main()
} catch (error) {
  console.error('FAIL:', error.message)
  process.exit(1)
}
