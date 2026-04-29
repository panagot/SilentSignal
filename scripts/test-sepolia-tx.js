import { config as loadEnv } from 'dotenv'
import { JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers'

loadEnv({ path: '.env.local', override: false })
loadEnv()

const DEFAULT_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC
  const provider = new JsonRpcProvider(rpcUrl)

  const maker = Wallet.createRandom()
  const solver = Wallet.createRandom()

  const makerBal = await provider.getBalance(maker.address)
  const solverBal = await provider.getBalance(solver.address)

  const senderPk = process.env.TEST_SENDER_PRIVATE_KEY || ''
  let sender = null
  let senderBal = null
  if (senderPk) {
    sender = new Wallet(senderPk, provider)
    senderBal = await provider.getBalance(sender.address)
  }

  const report = {
    test: 'sepolia-tx',
    rpcUrl,
    createdWallets: {
      maker: {
        address: maker.address,
        privateKey: maker.privateKey,
        balanceEth: formatEther(makerBal),
      },
      solver: {
        address: solver.address,
        privateKey: solver.privateKey,
        balanceEth: formatEther(solverBal),
      },
    },
    sender: sender
      ? {
          address: sender.address,
          balanceEth: formatEther(senderBal),
        }
      : null,
    transfers: [],
    status: 'SKIP',
    reason: '',
  }

  if (!sender) {
    report.reason = 'No TEST_SENDER_PRIVATE_KEY set; generated wallets only.'
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const minNeeded = parseEther('0.001')
  if (senderBal < minNeeded) {
    report.reason = 'Sender has insufficient balance for test transfers.'
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const fundAmount = parseEther('0.0003')
  const tx1 = await sender.sendTransaction({ to: maker.address, value: fundAmount })
  await tx1.wait()
  report.transfers.push({
    from: sender.address,
    to: maker.address,
    amountEth: formatEther(fundAmount),
    hash: tx1.hash,
  })

  const tx2 = await sender.sendTransaction({ to: solver.address, value: fundAmount })
  await tx2.wait()
  report.transfers.push({
    from: sender.address,
    to: solver.address,
    amountEth: formatEther(fundAmount),
    hash: tx2.hash,
  })

  const makerSigner = new Wallet(maker.privateKey, provider)
  const tx3 = await makerSigner.sendTransaction({
    to: solver.address,
    value: parseEther('0.00005'),
  })
  await tx3.wait()
  report.transfers.push({
    from: maker.address,
    to: solver.address,
    amountEth: '0.00005',
    hash: tx3.hash,
  })

  report.status = 'PASS'
  report.reason = 'Wallet creation + real Sepolia transfers succeeded.'
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error('FAIL:', error.message)
  process.exit(1)
})
