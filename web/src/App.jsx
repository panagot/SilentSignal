import { useEffect, useMemo, useState } from 'react'
import { GoldRushClient } from '@covalenthq/client-sdk'
import './App.css'

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
]

const STORAGE_KEY = 'silentsignal-intents-v1'

function formatCurrency(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function shortAddress(address) {
  if (!address) return 'anonymous'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
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

  const apiKey = import.meta.env.VITE_GOLDRUSH_API_KEY
  const latestIntent = useMemo(() => intents[0] ?? null, [intents])
  const openIntentsCount = useMemo(
    () => intents.filter((intent) => getIntentStatus(intent) !== 'executed').length,
    [intents],
  )

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
      const makerTrust = await fetchWalletStrength(client, chainName, makerWallet)

      setMarketSnapshot({
        ticker: tokenData.contract_ticker_symbol ?? 'TOKEN',
        price: lastPrice,
        change24h: dailyChangePct,
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
      const matches = await Promise.all(
        SAMPLE_SOLVERS.map(async (solver) => {
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>SilentSignal</h1>
          <p className="subtitle">
            Anonymous on-chain intent marketplace powered by GoldRush.
          </p>
        </div>
        <div className="wallet-pill">x402-ready architecture</div>
      </header>

      <section className="dashboard-grid">
        <form className="panel controls" onSubmit={handleCreateIntent}>
          <h2>Create Stealth Intent</h2>
          <label>
            Chain
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

          <label>
            Intent Type
            <select
              value={intentType}
              onChange={(event) => setIntentType(event.target.value)}
            >
              <option value="sell">Sell quietly</option>
              <option value="buy">Buy quietly</option>
            </select>
          </label>

          <label>
            Token Contract
            <input
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value)}
              placeholder="0x..."
              required
            />
          </label>

          <label>
            Amount
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
            Max Slippage %
            <input
              value={maxSlippage}
              onChange={(event) => setMaxSlippage(event.target.value)}
              type="number"
              min="0"
              step="0.1"
              required
            />
          </label>

          <label>
            Maker Wallet (private profile)
            <input
              value={makerWallet}
              onChange={(event) => setMakerWallet(event.target.value)}
              placeholder="0x..."
              required
            />
          </label>

          <button type="submit" disabled={loading || resolving}>
            {loading ? 'Publishing...' : 'Publish Intent'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>

        <section className="panel hero-metric">
          <p className="label">Market Snapshot</p>
          <h2>{marketSnapshot ? `$${formatCurrency(marketSnapshot.price)}` : '--'}</h2>
          <p className="verdict">{marketSnapshot ? marketSnapshot.ticker : 'No token selected'}</p>
          <p className="muted">
            {marketSnapshot
              ? `24h change ${marketSnapshot.change24h.toFixed(2)}%`
              : 'Create an intent to fetch live price context'}
          </p>
        </section>
      </section>

      <section className="insights-grid">
        <article className="panel">
          <div className="panel-head">
            <h2>Anonymous Intent Feed</h2>
            <span className="micro-tag">{intents.length} live</span>
          </div>
          {intents.length === 0 ? (
            <p className="muted">No intents yet. Publish the first stealth intent.</p>
          ) : (
            <ul className="intent-list">
              {intents.map((intent) => (
                <li key={intent.id}>
                  <div>
                    <strong>{intent.makerAlias}</strong> wants to {intent.intentType}{' '}
                    {formatCurrency(intent.amount)} {intent.tokenSymbol}
                  </div>
                  <div className="muted">
                    {intent.chainName} | slip {intent.maxSlippage}% | trust {intent.makerTrust}{' '}
                    | fill {formatCurrency(intent.filledAmount)}/{formatCurrency(intent.amount)}
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
            <p className="muted">Create an intent first to score solver candidates.</p>
          ) : solverMatches.length === 0 ? (
            <p className="muted">Run discovery to generate best execution candidates.</p>
          ) : (
            <>
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
            </>
          )}
        </article>
      </section>

      <section className="stats-grid">
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
    </main>
  )
}

export default App
