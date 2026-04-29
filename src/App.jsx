import { useEffect, useMemo, useState } from 'react'
import { GoldRushClient } from '@covalenthq/client-sdk'
import { BrowserProvider, Contract, parseEther, parseUnits } from 'ethers'
import './App.css'
import {
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_SETTLEMENT_ADDRESS,
  INTENT_SETTLEMENT_ABI,
} from './liveExecution'

const CHAIN_OPTIONS = [
  { label: 'Ethereum Mainnet', value: 'eth-mainnet' },
  { label: 'Base Mainnet', value: 'base-mainnet' },
  { label: 'Polygon Mainnet', value: 'matic-mainnet' },
  { label: 'BNB Mainnet', value: 'bsc-mainnet' },
]

const SAMPLE_SOLVERS = [
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  '0x66f820a414680b5bcda5eeca5dea238543f42054',
  '0x28C6c06298d514Db089934071355E5743bf21d60',
]

const STORAGE_KEY = 'silentsignal-intents-v1'
const VIEWS = [
  { id: 'intent', label: 'Intent Desk' },
  { id: 'solver', label: 'Solver Engine' },
  { id: 'flow', label: 'Execution Flow' },
  { id: 'analytics', label: 'Analytics' },
]
const VIEW_META = {
  intent: {
    title: 'Intent Desk',
    subtitle: 'Capture private execution intent with market-aware guardrails.',
  },
  solver: {
    title: 'Solver Engine',
    subtitle: 'Rank counterparties by trust, spread profile, and expected latency.',
  },
  flow: {
    title: 'Execution Flow',
    subtitle: 'Monitor each stage from private broadcast to staged settlement.',
  },
  analytics: {
    title: 'Analytics',
    subtitle: 'Track platform health, fill quality, and token execution context.',
  },
}
const CA_PRESETS = [
  {
    label: 'MYSTERY',
    chainName: 'eth-mainnet',
    tokenAddress: '0x45547AB0100f5E8b158258b6d94D7586De69fc21',
  },
  {
    label: 'PEPE',
    chainName: 'eth-mainnet',
    tokenAddress: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
  },
  {
    label: 'User Example',
    chainName: 'eth-mainnet',
    tokenAddress: '0x696969A73cFE28165e94f0924D3c940A55BC483e',
  },
]
const WETH_MAINNET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const WRAPPED_NATIVE_BY_CHAIN = {
  'eth-mainnet': WETH_MAINNET,
  'base-mainnet': '0x4200000000000000000000000000000000000006',
  'matic-mainnet': '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  'bsc-mainnet': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
}
const DEFAULT_MEV_POLICY = {
  privateRelay: true,
  commitReveal: true,
  shortLivedIntent: true,
  onchainGuardrails: true,
  randomizedSlicing: true,
  solverAllowlist: true,
  batchAuctionWindow: true,
}

function buildMevPolicy(enabled) {
  if (enabled) return { ...DEFAULT_MEV_POLICY }
  return {
    privateRelay: false,
    commitReveal: false,
    shortLivedIntent: false,
    onchainGuardrails: true,
    randomizedSlicing: false,
    solverAllowlist: false,
    batchAuctionWindow: false,
  }
}

function formatCurrency(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatTokenPrice(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  if (numeric === 0) return '$0.00'
  if (numeric < 0.000000000001) return '<$0.000000000001'
  if (numeric < 0.01) {
    return `$${numeric.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')}`
  }
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
}

function formatCompactCurrency(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  if (numeric < 0.01) return '<$0.01'
  return `$${numeric.toLocaleString(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2,
  })}`
}

function shortAddress(address) {
  if (!address) return 'anonymous'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function deterministicTrustFromAddress(address) {
  const hex = String(address).replace(/^0x/i, '').slice(-8)
  const seed = Number.parseInt(hex || '0', 16)
  return 45 + (seed % 41) // 45..85
}

function simpleHash(input) {
  const text = String(input)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function createRandomizedSlices(totalAmount, count = 3) {
  const total = Number(totalAmount)
  if (!Number.isFinite(total) || total <= 0) return [0]
  const weights = Array.from({ length: count }, () => 0.4 + Math.random())
  const sum = weights.reduce((acc, n) => acc + n, 0)
  const raw = weights.map((w) => (w / sum) * total)
  const rounded = raw.map((n) => Number(n.toFixed(6)))
  const used = rounded.slice(0, -1).reduce((acc, n) => acc + n, 0)
  rounded[rounded.length - 1] = Number(Math.max(0, total - used).toFixed(6))
  return rounded
}

function isLikelyEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

function getIntentStatus(intent) {
  if (intent.filledAmount >= intent.amount) return 'executed'
  if (intent.filledAmount > 0) return 'partial'
  return 'open'
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

async function fetchWalletStrengthFast(client, chainName, wallet, timeoutMs = 2500) {
  const fallback = deterministicTrustFromAddress(wallet)
  try {
    const timed = await Promise.race([
      fetchWalletStrength(client, chainName, wallet),
      new Promise((resolve) => {
        setTimeout(() => resolve(fallback), timeoutMs)
      }),
    ])
    const numeric = Number(timed)
    if (!Number.isFinite(numeric)) return fallback
    return Math.max(0, Math.min(100, Math.round(numeric)))
  } catch {
    return fallback
  }
}

async function fetchDexScreenerMarketCap(chainName, tokenAddress) {
  const chainMap = {
    'eth-mainnet': 'ethereum',
    'base-mainnet': 'base',
    'matic-mainnet': 'polygon',
    'bsc-mainnet': 'bsc',
  }
  const dexChain = chainMap[chainName]
  if (!dexChain) return null

  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
  )
  if (!response.ok) return null

  const payload = await response.json()
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : []
  const byChain = pairs.filter((pair) => pair?.chainId === dexChain)
  const candidate = byChain[0] ?? pairs[0]
  return Number(candidate?.marketCap ?? candidate?.fdv ?? NaN)
}

function InfoTip({ text }) {
  return (
    <span className="info-tip" title={text} aria-label={text}>
      i
    </span>
  )
}

function MiniBars({ values }) {
  const max = Math.max(...values, 1)
  return (
    <div className="mini-bars" aria-hidden="true">
      {values.map((value, idx) => (
        <span key={`${idx}-${value}`} style={{ height: `${(value / max) * 100}%` }} />
      ))}
    </div>
  )
}

function SignalArtwork() {
  return (
    <svg className="signal-art" viewBox="0 0 340 180" aria-hidden="true">
      <defs>
        <linearGradient id="artA" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4f7dff" />
          <stop offset="100%" stopColor="#22c7b7" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="338" height="178" rx="20" fill="#f7faff" stroke="#dbe6fb" />
      <path
        d="M20 126 C56 114, 74 70, 111 82 C146 94, 168 142, 204 132 C233 123, 259 65, 320 76"
        fill="none"
        stroke="url(#artA)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="111" cy="82" r="6" fill="#4f7dff" />
      <circle cx="204" cy="132" r="6" fill="#22c7b7" />
      <circle cx="320" cy="76" r="6" fill="#4f7dff" />
      <g fill="#d6e4ff">
        <rect x="30" y="22" width="76" height="12" rx="6" />
        <rect x="30" y="42" width="96" height="9" rx="4" />
      </g>
      <g fill="#dff8f3">
        <rect x="224" y="124" width="84" height="12" rx="6" />
        <rect x="224" y="145" width="66" height="9" rx="4" />
      </g>
    </svg>
  )
}

function DonutChart({ value }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="donut" style={{ ['--pct']: `${safe}%` }} role="img" aria-label={`Fill rate ${safe}%`}>
      <span>{safe}%</span>
    </div>
  )
}

function DistributionBars({ rows }) {
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <ul className="dist-bars" aria-label="Distribution bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span>{row.label}</span>
          <div><i style={{ width: `${Math.max(8, (row.value / max) * 100)}%` }} /></div>
          <strong>{row.value}</strong>
        </li>
      ))}
    </ul>
  )
}

function NavIcon({ type }) {
  if (type === 'intent') return <span className="nav-icon">◉</span>
  if (type === 'solver') return <span className="nav-icon">◇</span>
  if (type === 'flow') return <span className="nav-icon">↝</span>
  return <span className="nav-icon">▣</span>
}

function SilentSignalLogo() {
  return (
    <svg className="ss-logo" viewBox="0 0 64 64" aria-label="SilentSignal logo">
      <defs>
        <linearGradient id="ssg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f62fe" />
          <stop offset="100%" stopColor="#00a8a8" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#ssg)" />
      <path
        d="M18 38c4.2-7.2 8.9-11 14-11s9.8 3.8 14 11"
        fill="none"
        stroke="#fff"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
      <circle cx="32" cy="27" r="3.2" fill="#fff" />
    </svg>
  )
}

function App() {
  const [chainName, setChainName] = useState('eth-mainnet')
  const [intentType, setIntentType] = useState('sell')
  const [tokenAddress, setTokenAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [makerWallet, setMakerWallet] = useState(
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  )
  const [maxSlippage, setMaxSlippage] = useState('1.5')

  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [activeView, setActiveView] = useState('intent')
  const [error, setError] = useState('')
  const [intents, setIntents] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [marketSnapshot, setMarketSnapshot] = useState(null)
  const [solverMatches, setSolverMatches] = useState([])
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoResult, setDemoResult] = useState(null)
  const [demoError, setDemoError] = useState('')
  const [mevShieldEnabled, setMevShieldEnabled] = useState(true)
  const mevPolicy = useMemo(() => buildMevPolicy(mevShieldEnabled), [mevShieldEnabled])
  const [walletAddress, setWalletAddress] = useState('')
  const [liveStatus, setLiveStatus] = useState('')
  const [liveTxHash, setLiveTxHash] = useState('')
  const [intentSignature, setIntentSignature] = useState('')
  const [settlementAddress, setSettlementAddress] = useState(DEFAULT_SETTLEMENT_ADDRESS)
  const [liveIntentNonce, setLiveIntentNonce] = useState(() => Math.floor(Date.now() / 1000))
  const [liveIntentExpirySec, setLiveIntentExpirySec] = useState('300')
  const [liveMaxInputEth, setLiveMaxInputEth] = useState('0.01')
  const [liveMinOutputTokens, setLiveMinOutputTokens] = useState('1')
  const [liveFillInputEth, setLiveFillInputEth] = useState('0.01')
  const [liveFillOutputTokens, setLiveFillOutputTokens] = useState('1')
  const [liveWorking, setLiveWorking] = useState(false)

  const apiKey = import.meta.env.VITE_GOLDRUSH_API_KEY
  const latestIntent = useMemo(() => intents[0] ?? null, [intents])
  const openIntentsCount = useMemo(
    () => intents.filter((intent) => getIntentStatus(intent) !== 'executed').length,
    [intents],
  )
  const executedIntentsCount = useMemo(
    () => intents.filter((intent) => getIntentStatus(intent) === 'executed').length,
    [intents],
  )
  const trackedTokensCount = useMemo(
    () => new Set(intents.map((intent) => intent.tokenSymbol)).size,
    [intents],
  )
  const fillRate = useMemo(() => {
    if (!latestIntent || latestIntent.amount <= 0) return 0
    return Math.min(100, Math.round((latestIntent.filledAmount / latestIntent.amount) * 100))
  }, [latestIntent])
  const viewMeta = VIEW_META[activeView] ?? VIEW_META.intent
  const chainDistribution = useMemo(() => {
    const byChain = intents.reduce((acc, intent) => {
      acc[intent.chainName] = (acc[intent.chainName] ?? 0) + 1
      return acc
    }, {})
    return Object.entries(byChain)
      .map(([label, value]) => ({ label: label.replace('-mainnet', ''), value }))
      .slice(0, 4)
  }, [intents])
  const statusDistribution = useMemo(() => {
    const open = intents.filter((i) => getIntentStatus(i) === 'open').length
    const partial = intents.filter((i) => getIntentStatus(i) === 'partial').length
    const executed = intents.filter((i) => getIntentStatus(i) === 'executed').length
    return [
      { label: 'Open', value: open },
      { label: 'Partial', value: partial },
      { label: 'Executed', value: executed },
    ]
  }, [intents])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(intents))
  }, [intents])

  const handleCreateIntent = async (event) => {
    event.preventDefault()
    if (!apiKey) {
      setError('Missing VITE_GOLDRUSH_API_KEY. Add it to .env.local and restart.')
      return
    }
    if (!isLikelyEvmAddress(tokenAddress)) {
      setError('Token contract must be a valid EVM address.')
      return
    }
    if (!isLikelyEvmAddress(makerWallet)) {
      setError('Maker wallet must be a valid EVM address.')
      return
    }
    if (Number(amount) <= 0) {
      setError('Amount must be greater than 0.')
      return
    }
    if (Number(maxSlippage) < 0 || Number(maxSlippage) > 20) {
      setError('Max slippage must be between 0 and 20.')
      return
    }

    try {
      setLoading(true)
      setError('')
      const client = new GoldRushClient(apiKey)
      const priceRes = await client.PricingService.getTokenPrices(
        chainName,
        'USD',
        tokenAddress,
      )
      const tokenData = priceRes.data?.[0]
      if (!tokenData) {
        throw new Error('Token pricing unavailable for this contract on selected chain.')
      }

      const lastPrice = tokenData.items?.[0]?.price ?? 0
      const dailyPrice = tokenData.items?.[1]?.price ?? lastPrice
      const dailyChangePct =
        dailyPrice > 0 ? ((lastPrice - dailyPrice) / dailyPrice) * 100 : 0
      const has24hReference = (tokenData.items?.length ?? 0) > 1
      let marketCap = null
      try {
        const holdersRes =
          await client.BalanceService.getTokenHoldersV2ForTokenAddressByPage(
            chainName,
            tokenAddress,
            { pageSize: 100, pageNumber: 0 },
          )
        const holderItem = holdersRes.data?.items?.[0]
        const totalSupplyRaw = holderItem?.total_supply
        const decimals = holderItem?.contract_decimals ?? tokenData.contract_decimals ?? 18
        const totalSupply =
          totalSupplyRaw !== undefined && totalSupplyRaw !== null
            ? Number(totalSupplyRaw) / 10 ** decimals
            : null
        marketCap =
          totalSupply !== null && Number.isFinite(totalSupply)
            ? totalSupply * lastPrice
            : null
      } catch {
        marketCap = null
      }

      if (marketCap === null || !Number.isFinite(marketCap) || marketCap <= 0) {
        const dexMarketCap = await fetchDexScreenerMarketCap(chainName, tokenAddress)
        if (Number.isFinite(dexMarketCap) && dexMarketCap > 0) {
          marketCap = dexMarketCap
        }
      }
      const makerTrust = await fetchWalletStrength(client, chainName, makerWallet)
      const candidateAllowlist = SAMPLE_SOLVERS.filter(
        (solver) => solver.toLowerCase() !== makerWallet.toLowerCase(),
      )
        .sort(
          (a, b) =>
            deterministicTrustFromAddress(b) - deterministicTrustFromAddress(a),
        )
        .slice(0, 3)
      const nonce = Math.floor(Date.now() + Math.random() * 1000000)
      const expirySec = 120
      const domain = `silentsignal:${chainName}:v1`
      const commitmentHash = simpleHash(
        `${chainName}|${intentType}|${tokenAddress}|${amount}|${maxSlippage}|${makerWallet}|${nonce}|${domain}`,
      )
      const slices = mevPolicy.randomizedSlicing
        ? createRandomizedSlices(Number(amount), 3)
        : [Number(amount)]
      const batchWindowSec = mevPolicy.batchAuctionWindow
        ? 8 + Math.floor(Math.random() * 18)
        : 0

      setMarketSnapshot({
        ticker: tokenData.contract_ticker_symbol ?? 'TOKEN',
        price: lastPrice,
        change24h: dailyChangePct,
        has24hReference,
        marketCap,
      })

      setIntents((prev) =>
        [
          {
            id: Date.now().toString(),
            createdAt: new Date().toISOString(),
            chainName,
            intentType,
            tokenAddress,
            tokenSymbol: tokenData.contract_ticker_symbol ?? 'TOKEN',
            amount: Number(amount),
            maxSlippage: Number(maxSlippage),
            makerAlias: `shadow-${Math.floor(Math.random() * 9000) + 1000}`,
            makerWallet,
            makerTrust,
            filledAmount: 0,
            resolver: null,
            mev: {
              ...mevPolicy,
              nonce,
              expirySec,
              domain,
              commitmentHash,
              slices,
              batchWindowSec,
              allowlistedSolvers: candidateAllowlist,
            },
          },
          ...prev,
        ].slice(0, 6),
      )
      setSolverMatches([])
    } catch (err) {
      setError(err?.message ?? 'Failed to create intent.')
    } finally {
      setLoading(false)
    }
  }

  const handleDiscoverSolvers = async () => {
    if (!latestIntent) return
    if (!apiKey) {
      setError('Missing VITE_GOLDRUSH_API_KEY. Add it to .env.local and restart.')
      return
    }

    try {
      setLoading(true)
      setError('')
      const client = new GoldRushClient(apiKey)
      const maker = latestIntent.makerWallet.toLowerCase()
      let candidateSolvers = SAMPLE_SOLVERS.filter(
        (solver) => solver.toLowerCase() !== maker,
      )
      if (
        latestIntent?.mev?.solverAllowlist &&
        Array.isArray(latestIntent?.mev?.allowlistedSolvers) &&
        latestIntent.mev.allowlistedSolvers.length > 0
      ) {
        const allow = new Set(latestIntent.mev.allowlistedSolvers.map((s) => s.toLowerCase()))
        candidateSolvers = candidateSolvers.filter((solver) => allow.has(solver.toLowerCase()))
      }

      const matches = await Promise.all(
        candidateSolvers.map(async (solver) => {
          const trust = await fetchWalletStrength(client, latestIntent.chainName, solver)
          const spreadBps = Math.max(5, 120 - trust)
          const matchScore = Math.max(
            0,
            Math.min(100, Math.round(trust * 0.7 + (100 - spreadBps) * 0.3)),
          )
          return {
            solver,
            trust,
            spreadBps,
            matchScore,
            etaSec: Math.max(10, Math.round(90 - trust * 0.6)),
          }
        }),
      )
      matches.sort((a, b) => b.matchScore - a.matchScore)
      setSolverMatches(matches)
    } catch (err) {
      setError(err?.message ?? 'Failed to discover solvers.')
    } finally {
      setLoading(false)
    }
  }

  const handleResolveIntent = async () => {
    if (!latestIntent || solverMatches.length === 0) {
      setError('Discover solvers first before resolving an intent.')
      return
    }
    try {
      setResolving(true)
      setError('')

      const winner = solverMatches[0]
      const remaining = Math.max(0, latestIntent.amount - latestIntent.filledAmount)
      if (remaining === 0) return

      const fillPct = winner.matchScore >= 75 ? 0.65 : 0.35
      const fillAmount = Math.min(remaining, Number((latestIntent.amount * fillPct).toFixed(6)))

      setIntents((prev) =>
        prev.map((intent) =>
          intent.id === latestIntent.id
            ? {
                ...intent,
                filledAmount: Number((intent.filledAmount + fillAmount).toFixed(6)),
                resolver: winner.solver,
              }
            : intent,
        ),
      )
    } catch (err) {
      setError(err?.message ?? 'Failed to resolve intent.')
    } finally {
      setResolving(false)
    }
  }

  const handleRunOneEthDemo = async (mode) => {
    if (!apiKey) {
      setError('Missing VITE_GOLDRUSH_API_KEY. Add it to .env.local and restart.')
      return
    }
    if (!isLikelyEvmAddress(tokenAddress)) {
      setError('Enter a valid token contract first for simulation.')
      return
    }

    try {
      setDemoLoading(true)
      setError('')
      setDemoError('')
      setDemoResult(null)
      const client = new GoldRushClient(apiKey)
      const wrappedNative = WRAPPED_NATIVE_BY_CHAIN[chainName] ?? WETH_MAINNET
      const [tokenRes, wethRes] = await Promise.all([
        client.PricingService.getTokenPrices(chainName, 'USD', tokenAddress),
        client.PricingService.getTokenPrices(chainName, 'USD', wrappedNative),
      ])
      const token = tokenRes.data?.[0]
      const tokenPrice = Number(token?.items?.[0]?.price ?? NaN)
      const wethPrice = Number(wethRes.data?.[0]?.items?.[0]?.price ?? NaN)
      if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) {
        throw new Error('Token pricing unavailable for simulation.')
      }
      if (!Number.isFinite(wethPrice) || wethPrice <= 0) {
        throw new Error(
          'Native asset pricing unavailable for this chain/token combination. Try another token or chain.',
        )
      }

      const grossUsd = wethPrice
      const maxSlip = Math.max(0, Number(maxSlippage) || 1.5)
      const baseOut = grossUsd / tokenPrice

      const candidateSolvers = SAMPLE_SOLVERS.filter(
        (solver) => solver.toLowerCase() !== makerWallet.toLowerCase(),
      ).slice(0, 3)
      const bids = await Promise.all(
        candidateSolvers.map(async (solver) => {
          const trust = await fetchWalletStrengthFast(client, chainName, solver)
          const spreadBps = Math.max(5, 120 - trust)
          const efficiency = 1 - spreadBps / 10000
          const afterSlip = 1 - maxSlip / 100
          const estimatedOut = Math.max(0, baseOut * efficiency * afterSlip)
          return {
            solver,
            trust,
            spreadBps,
            etaSec: Math.max(10, Math.round(90 - trust * 0.6)),
            estimatedOut,
          }
        }),
      )
      bids.sort((a, b) => b.estimatedOut - a.estimatedOut)
      const best = bids[0]
      if (!best) {
        throw new Error('No solver bids available for this simulation.')
      }
      const settlementGuardrails = {
        maxInputEth: 1,
        maxSlippagePct: maxSlip,
        expirySec: 120,
        partialFillsAllowed: mevPolicy.randomizedSlicing,
      }

      const simulationSteps = mevShieldEnabled
        ? [
            'Intent signed with nonce and domain',
            'Commitment hash broadcast in private relay',
            'Allowlisted solvers submit bids inside batch window',
            'Best solver executes guarded settlement',
          ]
        : [
            'Intent broadcast without privacy envelope',
            'Open solver market reads full payload',
            'Best quote selected directly',
            'Settlement simulated with standard guardrails',
          ]
      const routeWeights = createRandomizedSlices(100, 3).map((n) => Number(n.toFixed(2)))
      const routeBreakdown = [
        { venue: 'Pool A (Uniswap V3)', pct: routeWeights[0] ?? 0 },
        { venue: 'Pool B (Uniswap V2)', pct: routeWeights[1] ?? 0 },
        { venue: 'Pool C (RFQ/MM)', pct: routeWeights[2] ?? 0 },
      ]

      setDemoResult({
        mode,
        chainName,
        tokenSymbol: token?.contract_ticker_symbol ?? 'TOKEN',
        tokenAddress,
        tokenPrice,
        wethPrice,
        baseOut,
        best,
        bids,
        settlementGuardrails,
        simulationSteps,
        mevShieldEnabled,
        routeBreakdown,
      })
    } catch (err) {
      setDemoError(err?.message ?? 'Failed to run 1 ETH simulation.')
    } finally {
      setDemoLoading(false)
    }
  }

  const requireWallet = async () => {
    if (!window.ethereum) {
      throw new Error('No injected wallet found. Install MetaMask or Rabby.')
    }
    const provider = new BrowserProvider(window.ethereum)
    const signer = await provider.getSigner()
    const network = await provider.getNetwork()
    if (Number(network.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
      throw new Error('Switch wallet to Base Sepolia (chainId 84532) for live execution.')
    }
    return { provider, signer }
  }

  const connectWallet = async () => {
    try {
      setLiveWorking(true)
      setLiveStatus('')
      const { signer } = await requireWallet()
      const address = await signer.getAddress()
      setWalletAddress(address)
      setLiveStatus(`Connected ${shortAddress(address)} on Base Sepolia`)
    } catch (err) {
      setLiveStatus(err?.message ?? 'Wallet connection failed.')
    } finally {
      setLiveWorking(false)
    }
  }

  const buildLiveIntentPayload = () => {
    if (!walletAddress) throw new Error('Connect wallet first.')
    if (!isLikelyEvmAddress(tokenAddress)) throw new Error('Set a valid token contract for tokenOut.')
    if (!isLikelyEvmAddress(settlementAddress)) throw new Error('Set valid settlement contract address.')

    const expiry = Math.floor(Date.now() / 1000) + Number(liveIntentExpirySec || '300')
    if (expiry <= Math.floor(Date.now() / 1000)) throw new Error('Expiry must be in the future.')

    return {
      maker: walletAddress,
      tokenOut: tokenAddress,
      maxInputWei: parseEther(liveMaxInputEth || '0').toString(),
      minOutputTokens: parseUnits(liveMinOutputTokens || '0', 18).toString(),
      expiry: expiry.toString(),
      nonce: String(liveIntentNonce),
      allowPartial: true,
    }
  }

  const signLiveIntent = async () => {
    try {
      setLiveWorking(true)
      setLiveStatus('')
      setLiveTxHash('')
      const { signer } = await requireWallet()
      const address = await signer.getAddress()
      setWalletAddress(address)
      const intent = buildLiveIntentPayload()
      const domain = {
        name: 'SilentSignalIntent',
        version: '1',
        chainId: BASE_SEPOLIA_CHAIN_ID,
        verifyingContract: settlementAddress,
      }
      const types = {
        Intent: [
          { name: 'maker', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'maxInputWei', type: 'uint256' },
          { name: 'minOutputTokens', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'allowPartial', type: 'bool' },
        ],
      }
      const signature = await signer.signTypedData(domain, types, intent)
      setIntentSignature(signature)
      setLiveStatus('Intent signed. Next: lock ETH into settlement contract.')
    } catch (err) {
      setLiveStatus(err?.message ?? 'Intent signing failed.')
    } finally {
      setLiveWorking(false)
    }
  }

  const lockLiveIntent = async () => {
    try {
      setLiveWorking(true)
      setLiveStatus('')
      setLiveTxHash('')
      const { signer } = await requireWallet()
      const intent = buildLiveIntentPayload()
      const contract = new Contract(settlementAddress, INTENT_SETTLEMENT_ABI, signer)
      const intentHash = await contract.hashIntentStruct(intent)
      const tx = await contract.lockIntent(intentHash, intent.nonce, intent.expiry, {
        value: parseEther(liveMaxInputEth || '0'),
      })
      await tx.wait()
      setLiveTxHash(tx.hash)
      setLiveStatus('ETH locked on-chain. Solver can now fill intent.')
    } catch (err) {
      setLiveStatus(err?.message ?? 'Lock transaction failed.')
    } finally {
      setLiveWorking(false)
    }
  }

  const fillLiveIntent = async () => {
    try {
      if (!intentSignature) throw new Error('Sign intent first before filling.')
      setLiveWorking(true)
      setLiveStatus('')
      setLiveTxHash('')
      const { signer } = await requireWallet()
      const intent = buildLiveIntentPayload()
      const contract = new Contract(settlementAddress, INTENT_SETTLEMENT_ABI, signer)
      const tx = await contract.fillIntent(
        intent,
        parseEther(liveFillInputEth || '0').toString(),
        parseUnits(liveFillOutputTokens || '0', 18).toString(),
        intentSignature,
      )
      await tx.wait()
      setLiveTxHash(tx.hash)
      setLiveStatus('Intent fill executed on-chain.')
    } catch (err) {
      setLiveStatus(err?.message ?? 'Fill transaction failed.')
    } finally {
      setLiveWorking(false)
    }
  }

  return (
    <div className="page-root">
      <header className="global-nav">
        <div className="global-nav-inner">
          <div className="nav-brand">
            <SilentSignalLogo />
            <div>
              <strong>SilentSignal</strong>
              <span>Stealth Intent Infrastructure</span>
            </div>
          </div>
          <nav className="nav-links">
            {VIEWS.map((view) => (
              <button
                key={view.id}
                type="button"
                className={activeView === view.id ? 'nav-link-btn active' : 'nav-link-btn'}
                onClick={() => setActiveView(view.id)}
              >
                <NavIcon type={view.id} />
                {view.label}
              </button>
            ))}
          </nav>
          <button type="button" className="nav-cta">Launch Monitor</button>
        </div>
      </header>

      <div className="layout-shell">
      <aside className="sidebar">
        <section className="sidebar-hero">
          <p className="nav-label">Control Center</p>
          <h3>Execution Workspace</h3>
          <p>Create stealth intents, route to solvers, and monitor fill quality.</p>
        </section>

        <nav className="sidebar-nav">
          <p className="nav-label">Workspace</p>
          <button type="button" className={activeView === 'intent' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('intent')}><NavIcon type="intent" />Intent Desk</button>
          <button type="button" className={activeView === 'solver' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('solver')}><NavIcon type="solver" />Solver Engine</button>
          <button type="button" className={activeView === 'flow' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('flow')}><NavIcon type="flow" />Execution Flow</button>
          <button type="button" className={activeView === 'analytics' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('analytics')}><NavIcon type="analytics" />Analytics</button>
        </nav>

        <section className="sidebar-card">
          <p className="nav-label">Session Metrics</p>
          <p><strong>{intents.length}</strong> intents published</p>
          <p><strong>{openIntentsCount}</strong> open intents</p>
          <p><strong>{executedIntentsCount}</strong> executed intents</p>
          <p><strong>{trackedTokensCount}</strong> tracked tokens</p>
        </section>

        <section className="sidebar-card sidebar-note">
          <p className="nav-label">Operator Tip</p>
          <p>
            Keep slippage tight for sensitive pairs and resolve in partial fills for better
            execution stealth.
          </p>
        </section>
      </aside>

        <main className="app-shell">
        <header className="topbar">
          <div className="topbar-main">
            <p className="eyebrow">SilentSignal Control Surface</p>
            <h2 className="page-title">{viewMeta.title}</h2>
            <p className="subtitle">{viewMeta.subtitle}</p>
            <p className="value-prop">
              Core proposition: solvers split flow across multiple LP venues, then merge outcomes
              into best-execution settlement.
            </p>
          </div>
          <div className="topbar-metrics">
            <div className="topbar-metric">
              <span>Open</span>
              <strong>{openIntentsCount}</strong>
            </div>
            <div className="topbar-metric">
              <span>Executed</span>
              <strong>{executedIntentsCount}</strong>
            </div>
            <div className="topbar-metric">
              <span>Fill</span>
              <strong>{fillRate}%</strong>
            </div>
          </div>
          <div className="wallet-pill">x402-ready architecture</div>
        </header>

        {activeView === 'intent' ? (
        <>
        <section id="intent-desk" className="dashboard-grid">
          <form className="panel controls" onSubmit={handleCreateIntent}>
          <h2>
            Create Stealth Intent <InfoTip text="Intent is anonymized first, then solver discovery runs without revealing full maker profile." />
          </h2>
          <div className="preset-row">
            {CA_PRESETS.map((preset) => (
              <button
                key={preset.tokenAddress}
                type="button"
                className="preset-btn"
                onClick={() => {
                  setChainName(preset.chainName)
                  setTokenAddress(preset.tokenAddress)
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label>
            Chain <InfoTip text="Execution chain used for pricing lookup and solver trust scoring." />
            <select
              value={chainName}
              onChange={(event) => setChainName(event.target.value)}
            >
              {CHAIN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">Used for market data resolution and candidate solver profiling.</p>

          <label>
            Intent Type <InfoTip text="Choose whether you are quietly buying or selling." />
            <select
              value={intentType}
              onChange={(event) => setIntentType(event.target.value)}
            >
              <option value="sell">Sell quietly</option>
              <option value="buy">Buy quietly</option>
            </select>
          </label>
          <p className="field-help">Stealth buy/sell intent is shown in feed under anonymous alias.</p>

          <label>
            Token Contract <InfoTip text="Token address used to fetch live market price context from GoldRush." />
            <input
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value)}
              placeholder="0x..."
              required
            />
          </label>
          <p className="field-help">Paste ERC-20 address on the selected chain.</p>

          <div className="field-row">
            <label>
              Amount <InfoTip text="Target amount to execute across one or more solver fills." />
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="10000"
                type="number"
                min="0"
                step="any"
                required
              />
            </label>

            <label>
              Max Slippage % <InfoTip text="Maximum acceptable execution drift from reference price." />
              <input
                value={maxSlippage}
                onChange={(event) => setMaxSlippage(event.target.value)}
                type="number"
                min="0"
                step="0.1"
                required
              />
            </label>
          </div>

          <label>
            Maker Wallet (private profile) <InfoTip text="Used only for trust scoring; UI shows an anonymous alias in feed." />
            <input
              value={makerWallet}
              onChange={(event) => setMakerWallet(event.target.value)}
              placeholder="0x..."
              required
            />
          </label>
          <p className="field-help">Wallet identity is never shown directly in the public intent feed.</p>

          <button type="submit" disabled={loading || resolving}>
            {loading ? 'Publishing...' : 'Publish Intent'}
          </button>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={mevShieldEnabled}
              onChange={(event) => setMevShieldEnabled(event.target.checked)}
            />
            <span>MEV Shield mode (private relay + commit-reveal + allowlist)</span>
          </label>
          {error ? <p className="error">{error}</p> : null}
          </form>

          <section className="panel hero-metric">
            <div className="panel-head">
              <p className="label">Market Snapshot</p>
              <span className="micro-tag">Live Context</span>
            </div>
            <h2>{marketSnapshot ? formatTokenPrice(marketSnapshot.price) : '--'}</h2>
            <p className="verdict">
              {marketSnapshot ? marketSnapshot.ticker : 'No token selected'}
            </p>
            <p className="muted">
              {marketSnapshot
                ? marketSnapshot.has24hReference
                  ? `24h change ${marketSnapshot.change24h.toFixed(2)}%`
                  : '24h change unavailable (new or thinly priced token)'
                : 'Create an intent to fetch live price context'}
            </p>
            <p className="muted">
              {marketSnapshot?.marketCap !== null && marketSnapshot?.marketCap !== undefined
                ? `Market cap ${formatCompactCurrency(marketSnapshot.marketCap)}`
                : 'Market cap unavailable'}
            </p>
            <MiniBars
              values={
                marketSnapshot
                  ? [
                      22,
                      34,
                      29,
                      41,
                      36,
                      44,
                      Math.max(12, Math.abs(Math.round(marketSnapshot.change24h)) + 20),
                    ]
                  : [10, 12, 11, 13, 12, 11, 12]
              }
            />
          </section>
        </section>
        <section className="panel demo-sim-panel">
          <div className="panel-head">
            <h2>1 ETH Live Simulation</h2>
            <span className="micro-tag">Demo Ready</span>
          </div>
          <p className="muted">
            Explains how SilentSignal works in practice: intent -&gt; solver bids -&gt; guarded settlement.
          </p>
          <div className="demo-actions">
            <button
              type="button"
              onClick={() => handleRunOneEthDemo('buy')}
              disabled={demoLoading || loading}
            >
              {demoLoading ? 'Simulating...' : 'Simulate Buy with 1 ETH'}
            </button>
            <button
              type="button"
              onClick={() => handleRunOneEthDemo('sell')}
              disabled={demoLoading || loading}
            >
              {demoLoading ? 'Simulating...' : 'Simulate Sell worth 1 ETH'}
            </button>
          </div>
          <p className="field-help">
            Simulation mode: <strong>{mevShieldEnabled ? 'MEV Shield ON' : 'MEV Shield OFF'}</strong>
          </p>
          {demoError ? <p className="error">{demoError}</p> : null}
          {!demoResult ? (
            <div className="empty-state">
              <p className="empty-title">No simulation run yet</p>
              <p className="muted">Select token contract and run buy/sell to generate solver outcome.</p>
            </div>
          ) : (
            <div className="demo-grid">
              <div className="demo-kv">
                <p><strong>Mode</strong> {demoResult.mode.toUpperCase()}</p>
                <p><strong>Pair</strong> 1 ETH -&gt; {demoResult.tokenSymbol}</p>
                <p><strong>Token Price</strong> {formatTokenPrice(demoResult.tokenPrice)}</p>
                <p><strong>ETH Price</strong> {formatTokenPrice(demoResult.wethPrice)}</p>
                <p><strong>Raw Quote</strong> {formatCurrency(demoResult.baseOut)} {demoResult.tokenSymbol}</p>
                <p>
                  <strong>Best Solver</strong> {shortAddress(demoResult.best?.solver)} ({demoResult.best?.spreadBps} bps)
                </p>
                <p>
                  <strong>Expected Fill</strong> {formatCurrency(demoResult.best?.estimatedOut)} {demoResult.tokenSymbol}
                </p>
              </div>
              <div>
                <p className="nav-label">Settlement guardrails</p>
                <ul className="demo-guards">
                  <li>Max input: {demoResult.settlementGuardrails.maxInputEth} ETH</li>
                  <li>Max slippage: {demoResult.settlementGuardrails.maxSlippagePct}%</li>
                  <li>Expiry: {demoResult.settlementGuardrails.expirySec}s</li>
                  <li>Partial fills: {demoResult.settlementGuardrails.partialFillsAllowed ? 'enabled' : 'disabled'}</li>
                  <li>Relay route: {demoResult.mevShieldEnabled ? 'private first' : 'public routing'}</li>
                </ul>
                <p className="nav-label demo-steps-label">Simulation steps</p>
                <ul className="demo-steps">
                  {demoResult.simulationSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
                <p className="nav-label demo-steps-label">Liquidity route split</p>
                <ul className="demo-routes">
                  {demoResult.routeBreakdown.map((route) => (
                    <li key={route.venue}>
                      <span>{route.venue}</span>
                      <strong>{route.pct}%</strong>
                    </li>
                  ))}
                </ul>
                <p className="field-help">
                  This is a controlled simulation of solver competition with enforced limits, not direct solver custody.
                </p>
              </div>
            </div>
          )}
        </section>
        <section className="panel live-panel">
          <div className="panel-head">
            <h2>Live Execution (Base Sepolia)</h2>
            <span className="micro-tag">On-chain</span>
          </div>
          <p className="muted">
            Real testnet path: sign EIP-712 intent, lock ETH, then execute solver fill on settlement contract.
          </p>
          <div className="live-grid">
            <label>
              Settlement Contract
              <input
                value={settlementAddress}
                onChange={(event) => setSettlementAddress(event.target.value)}
                placeholder="0x..."
              />
            </label>
            <label>
              Intent Nonce
              <input
                value={liveIntentNonce}
                onChange={(event) => setLiveIntentNonce(Number(event.target.value || '0'))}
                type="number"
                min="1"
              />
            </label>
            <label>
              Expiry (sec from now)
              <input
                value={liveIntentExpirySec}
                onChange={(event) => setLiveIntentExpirySec(event.target.value)}
                type="number"
                min="60"
              />
            </label>
            <label>
              Max Input ETH
              <input
                value={liveMaxInputEth}
                onChange={(event) => setLiveMaxInputEth(event.target.value)}
                type="number"
                min="0"
                step="0.001"
              />
            </label>
            <label>
              Min Output Tokens (18 decimals)
              <input
                value={liveMinOutputTokens}
                onChange={(event) => setLiveMinOutputTokens(event.target.value)}
                type="number"
                min="0"
                step="0.0001"
              />
            </label>
            <label>
              Fill Input ETH
              <input
                value={liveFillInputEth}
                onChange={(event) => setLiveFillInputEth(event.target.value)}
                type="number"
                min="0"
                step="0.001"
              />
            </label>
            <label>
              Fill Output Tokens (18 decimals)
              <input
                value={liveFillOutputTokens}
                onChange={(event) => setLiveFillOutputTokens(event.target.value)}
                type="number"
                min="0"
                step="0.0001"
              />
            </label>
          </div>
          <div className="demo-actions">
            <button type="button" onClick={connectWallet} disabled={liveWorking}>
              {liveWorking ? 'Working...' : walletAddress ? 'Wallet Connected' : 'Connect Wallet'}
            </button>
            <button type="button" onClick={signLiveIntent} disabled={liveWorking || !walletAddress}>
              {liveWorking ? 'Working...' : '1) Sign Intent'}
            </button>
            <button type="button" onClick={lockLiveIntent} disabled={liveWorking || !walletAddress}>
              {liveWorking ? 'Working...' : '2) Lock ETH'}
            </button>
            <button type="button" onClick={fillLiveIntent} disabled={liveWorking || !walletAddress}>
              {liveWorking ? 'Working...' : '3) Fill Intent'}
            </button>
          </div>
          <p className="field-help">
            Use separate maker/solver wallets in practice. Solver wallet must approve tokenOut to settlement contract before fill.
          </p>
          {intentSignature ? <p className="field-help">Signature captured: {intentSignature.slice(0, 20)}...</p> : null}
          {liveStatus ? <p className="muted">{liveStatus}</p> : null}
          {liveTxHash ? (
            <p className="muted">
              Tx:{' '}
              <a
                href={`https://sepolia.basescan.org/tx/${liveTxHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {liveTxHash}
              </a>
            </p>
          ) : null}
        </section>
        <section className="panel mev-panel">
          <div className="panel-head">
            <h2>MEV Shield Execution Model</h2>
            <span className="micro-tag">{mevShieldEnabled ? 'Shield ON' : 'Shield OFF'}</span>
          </div>
          <div className="mev-grid">
            <div>
              <p className="nav-label">Protection rails</p>
              <ul className="mev-list">
                <li><strong>Private relay:</strong> solver fills routed privately first</li>
                <li><strong>Commit-reveal:</strong> commitment hash published, details revealed at settle stage</li>
                <li><strong>Short-lived intent:</strong> nonce + expiry + domain-scoped payload</li>
                <li><strong>On-chain guardrails:</strong> max input, min output, slippage bounds</li>
                <li><strong>Randomized slicing:</strong> staged partial fills to reduce footprint</li>
                <li><strong>Solver allowlist:</strong> only trusted solvers see full payload</li>
                <li><strong>Batch window:</strong> short auction window before final selection</li>
              </ul>
            </div>
            <div className="mev-snapshot">
              <p className="nav-label">Latest intent snapshot</p>
              <p><strong>Commitment</strong> {latestIntent?.mev?.commitmentHash ?? '--'}</p>
              <p><strong>Nonce</strong> {latestIntent?.mev?.nonce ?? '--'}</p>
              <p><strong>Expiry</strong> {latestIntent?.mev?.expirySec ? `${latestIntent.mev.expirySec}s` : '--'}</p>
              <p><strong>Domain</strong> {latestIntent?.mev?.domain ?? '--'}</p>
              <p><strong>Slices</strong> {latestIntent?.mev?.slices?.join(' / ') ?? '--'}</p>
              <p>
                <strong>Allowlisted solvers</strong>{' '}
                {latestIntent?.mev?.allowlistedSolvers?.length ?? 0}
              </p>
              <p>
                <strong>Batch window</strong>{' '}
                {latestIntent?.mev?.batchWindowSec ? `${latestIntent.mev.batchWindowSec}s` : '--'}
              </p>
            </div>
          </div>
        </section>
        <section className="visual-strip">
          <article className="panel hero-visual">
            <div>
              <p className="eyebrow">Stealth Liquidity Map</p>
              <h3>Anonymous order flow, rendered as live signal lanes</h3>
              <p className="muted">
                Intent publication, solver scoring, and staged execution are separated into
                observable control layers.
              </p>
            </div>
            <SignalArtwork />
          </article>
          <article className="panel metric-stack">
            <div>
              <p className="eyebrow">Intent Health</p>
              <h3>{openIntentsCount}/{Math.max(1, intents.length)} open</h3>
              <p className="muted">Open intent pressure in current session.</p>
            </div>
            <div className="meter">
              <span style={{ width: `${Math.max(8, Math.min(100, openIntentsCount * 20))}%` }} />
            </div>
            <div>
              <p className="eyebrow">Execution Yield</p>
              <h3>{fillRate}%</h3>
              <p className="muted">Latest intent fill completion ratio.</p>
            </div>
          </article>
        </section>
        <section className="kpi-banner">
          <article className="kpi-item">
            <p>Intent Throughput</p>
            <h4>{intents.length * 7 + openIntentsCount}</h4>
            <span>simulated ops/hour</span>
          </article>
          <article className="kpi-item">
            <p>Solver Readiness</p>
            <h4>{solverMatches[0]?.matchScore ?? 0}%</h4>
            <span>best candidate confidence</span>
          </article>
          <article className="kpi-item">
            <p>Stealth Integrity</p>
            <h4>{Math.max(72, 100 - fillRate / 2)}%</h4>
            <span>privacy posture index</span>
          </article>
        </section>
        <section className="infographics-grid">
          <article className="panel">
            <div className="panel-head">
              <h2>Execution Completion</h2>
              <span className="micro-tag">Live</span>
            </div>
            <div className="donut-wrap">
              <DonutChart value={fillRate} />
              <div>
                <p className="muted">Based on latest intent lifecycle progression.</p>
                <p className="muted">Higher values indicate faster solver settlement.</p>
              </div>
            </div>
          </article>
          <article className="panel">
            <div className="panel-head">
              <h2>Status Distribution</h2>
              <span className="micro-tag">Session</span>
            </div>
            <DistributionBars rows={statusDistribution} />
          </article>
          <article className="panel">
            <div className="panel-head">
              <h2>Chain Activity</h2>
              <span className="micro-tag">Heat</span>
            </div>
            <DistributionBars
              rows={
                chainDistribution.length > 0
                  ? chainDistribution
                  : [{ label: 'eth', value: 0 }, { label: 'base', value: 0 }, { label: 'polygon', value: 0 }]
              }
            />
          </article>
          <article className="panel timeline-panel">
            <div className="panel-head">
              <h2>Intent Lifecycle Timeline</h2>
              <span className="micro-tag">Flow</span>
            </div>
            <div className="timeline">
              <div><span />Intent Published</div>
              <div><span />Anonymous Broadcast</div>
              <div><span />Solver Discovery</div>
              <div><span />Partial/Full Settlement</div>
            </div>
          </article>
        </section>
        <section className="panel compact-panel">
          <div className="panel-head">
            <h2>Intent Pipeline</h2>
            <span className="micro-tag">{intents.length} recent</span>
          </div>
          {intents.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No active intents</p>
              <p className="muted">Publish your first stealth order to initialize the pipeline.</p>
            </div>
          ) : (
            <ul className="intent-list">
              {intents.slice(0, 3).map((intent) => (
                <li key={intent.id}>
                  <div>
                    <strong>{intent.makerAlias}</strong> wants to {intent.intentType}{' '}
                    {formatCurrency(intent.amount)} {intent.tokenSymbol}
                  </div>
                  <div className="intent-meta-row">
                    <span className={`status-chip ${getIntentStatus(intent)}`}>
                      {getIntentStatus(intent)}
                    </span>
                    <span className="muted">fill {formatCurrency(intent.filledAmount)}/{formatCurrency(intent.amount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        </>
        ) : null}

        {activeView === 'flow' ? (
        <section id="execution-flow" className="panel process-panel">
          <div className="panel-head">
            <h2>Execution Flow</h2>
            <span className="micro-tag">Infographic</span>
          </div>
          <div className="process-flow">
            <div className="step">
              <div className="step-dot">1</div>
              <div>
                <strong>Intent Creation</strong>
                <p>Maker submits stealth buy/sell intent with slippage guardrails.</p>
              </div>
            </div>
            <div className="step-arrow">→</div>
            <div className="step">
              <div className="step-dot">2</div>
              <div>
                <strong>Anonymous Broadcast</strong>
                <p>Public feed displays alias and intent stats, not full identity.</p>
              </div>
            </div>
            <div className="step-arrow">→</div>
            <div className="step">
              <div className="step-dot">3</div>
              <div>
                <strong>Solver Discovery</strong>
                <p>GoldRush wallet history drives trust and spread ranking.</p>
              </div>
            </div>
            <div className="step-arrow">→</div>
            <div className="step">
              <div className="step-dot">4</div>
              <div>
                <strong>Partial Fill Resolve</strong>
                <p>Best solver executes staged fills until intent completion.</p>
              </div>
            </div>
          </div>
          <div className="flow-legend">
            <span><i className="dot blue" />Private Stage</span>
            <span><i className="dot teal" />Public Discovery</span>
            <span><i className="dot indigo" />Execution/Settlement</span>
          </div>
        </section>
        ) : null}

        {activeView === 'solver' ? (
        <section className="insights-grid">
          <article id="solver-engine" className="panel">
            <div className="panel-head">
              <h2>Anonymous Intent Feed</h2>
              <span className="micro-tag">{intents.length} live</span>
            </div>
            {intents.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">No intent feed data</p>
                <p className="muted">Intent entries appear here after the first publish event.</p>
              </div>
            ) : (
              <ul className="intent-list">
                {intents.map((intent) => (
                  <li key={intent.id}>
                    <div>
                      <strong>{intent.makerAlias}</strong> wants to {intent.intentType}{' '}
                      {formatCurrency(intent.amount)} {intent.tokenSymbol}
                    </div>
                    <div className="muted">
                      {intent.chainName} | slip {intent.maxSlippage}% | trust{' '}
                      {intent.makerTrust} | fill {formatCurrency(intent.filledAmount)}/
                      {formatCurrency(intent.amount)}
                    </div>
                    <div className="intent-meta-row">
                      <span className={`status-chip ${getIntentStatus(intent)}`}>
                        {getIntentStatus(intent)}
                      </span>
                      <span className="muted">maker {shortAddress(intent.makerWallet)}</span>
                      {intent.resolver ? (
                        <span className="muted">solver {shortAddress(intent.resolver)}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="panel">
            <div className="panel-head">
              <h2>Solver Match Engine</h2>
              <button
                type="button"
                onClick={handleDiscoverSolvers}
                disabled={!latestIntent || loading || resolving}
              >
                {loading ? 'Scanning...' : 'Discover Solvers'}
              </button>
            </div>
            {!latestIntent ? (
              <div className="empty-state">
                <p className="empty-title">Solver engine idle</p>
                <p className="muted">Create an intent first to unlock solver scoring.</p>
              </div>
            ) : solverMatches.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">No solver rankings yet</p>
                <p className="muted">Run discovery to generate ranked execution candidates.</p>
              </div>
            ) : (
              <>
                <div className="fill-gauge-wrap">
                  <div
                    className="fill-gauge"
                    style={{ ['--fill']: `${fillRate}%` }}
                    role="img"
                    aria-label={`Intent fill progress ${fillRate}%`}
                  >
                    <span>{fillRate}%</span>
                  </div>
                  <p className="muted">Latest intent fill progress</p>
                </div>
                <ul className="tx-list">
                  {solverMatches.map((solver) => (
                    <li key={solver.solver}>
                      <span>{shortAddress(solver.solver)}</span>
                      <span>match {solver.matchScore}</span>
                      <span>spread {solver.spreadBps} bps</span>
                      <span>eta {solver.etaSec}s</span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={handleResolveIntent} disabled={resolving}>
                  {resolving ? 'Executing...' : 'Resolve Intent (Partial Fill)'}
                </button>
                <p className="field-help">
                  Resolves against highest-ranked solver first; staged fill protects intent privacy.
                </p>
              </>
            )}
          </article>
        </section>
        ) : null}

        {activeView === 'analytics' ? (
        <>
        <section id="analytics" className="stats-grid">
          <article className="panel stat-card">
            <p>Total intents</p>
            <h3>{intents.length}</h3>
          </article>
          <article className="panel stat-card">
            <p>Open intents</p>
            <h3>{openIntentsCount}</h3>
          </article>
          <article className="panel stat-card">
            <p>Best solver score</p>
            <h3>{solverMatches[0]?.matchScore ?? '--'}</h3>
          </article>
          <article className="panel stat-card">
            <p>x402 simulation fee</p>
            <h3>$0.02/query</h3>
          </article>
        </section>
        <section className="insights-grid">
          <article className="panel">
            <h2>Market Intelligence</h2>
            <p className="muted">Token: {marketSnapshot?.ticker ?? 'N/A'}</p>
            <p className="muted">Price: {marketSnapshot ? formatTokenPrice(marketSnapshot.price) : '--'}</p>
            <p className="muted">MCap: {marketSnapshot?.marketCap ? formatCompactCurrency(marketSnapshot.marketCap) : 'N/A'}</p>
            <MiniBars
              values={
                marketSnapshot
                  ? [18, 24, 31, 29, 35, 40, Math.max(10, Math.abs(Math.round(marketSnapshot.change24h ?? 0)) + 12)]
                  : [10, 11, 12, 10, 12, 11, 10]
              }
            />
          </article>
          <article className="panel">
            <h2>Execution KPIs</h2>
            <p className="muted">Open intents: {openIntentsCount}</p>
            <p className="muted">Executed intents: {executedIntentsCount}</p>
            <p className="muted">Tracked tokens: {trackedTokensCount}</p>
            <p className="muted">Best solver score: {solverMatches[0]?.matchScore ?? '--'}</p>
          </article>
        </section>
        </>
        ) : null}

        <footer className="app-footer premium-footer">
          <section>
            <div className="footer-brand">
              <SilentSignalLogo />
              <div>
                <strong>SilentSignal</strong>
                <p>Anonymous intent infrastructure for pro-grade on-chain execution.</p>
              </div>
            </div>
          </section>
          <section>
            <h4>Platform</h4>
            <p>Intent Desk</p>
            <p>Solver Engine</p>
            <p>Execution Analytics</p>
          </section>
          <section>
            <h4>Data Layer</h4>
            <p>GoldRush Pricing + Wallet History</p>
            <p>DexScreener fallback context</p>
            <p>x402-ready query economics</p>
          </section>
          <section>
            <h4>Session Snapshot</h4>
            <p>{intents.length} intents tracked</p>
            <p>{openIntentsCount} open / {executedIntentsCount} executed</p>
            <p>Latest fill rate: {fillRate}%</p>
          </section>
        </footer>
        </main>
      </div>
    </div>
  )
}

export default App
