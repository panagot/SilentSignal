import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers'

async function main() {
  loadEnv({ path: '.env.local', override: false })
  loadEnv()
  const rpcUrl =
    process.env.SEPOLIA_RPC_URL ||
    process.env.BASE_SEPOLIA_RPC_URL ||
    'https://ethereum-sepolia-rpc.publicnode.com'
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.TEST_SENDER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('Missing DEPLOYER_PRIVATE_KEY (or TEST_SENDER_PRIVATE_KEY) in environment.')
  }

  const artifactPath = path.resolve(
    'artifacts/contracts/IntentSettlement.sol/IntentSettlement.json',
  )
  if (!fs.existsSync(artifactPath)) {
    throw new Error('Missing compiled artifact. Run: npm run contracts:compile')
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

  const provider = new JsonRpcProvider(rpcUrl)
  const deployer = new Wallet(privateKey, provider)
  console.log('Deploying with:', deployer.address)

  const Factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer)
  const settlement = await Factory.deploy(deployer.address)
  await settlement.waitForDeployment()

  console.log('IntentSettlement deployed to:', await settlement.getAddress())
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
