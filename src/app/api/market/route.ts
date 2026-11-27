// GET /api/market — Kalkulator's live market gateway (Stocks + Currency).
// Stocks  : ?action=quotes&symbols=AAPL,MSFT,...   → per-symbol live quotes
//           (price, change, day range, 1m sparkline) served from an in-memory
//           cache that refreshes a few symbols per call — the client polls every
//           second and every poll returns a fresh record (rolling price log).
//           ?action=chart&symbol=AAPL&range=1d&interval=5m → real OHLC candles
//           + close series (Yahoo Finance chart endpoint, server-side).
// Currency: ?action=rates → all-country exchange rates (~160 currencies,
//           exchangerate-api) with a 15-minute cache.
// Everything is JSON-only; failures degrade per-symbol instead of failing the batch.
import { NextResponse } from 'next/server'
import { clientKey, rateLimit, tooMany } from '@/lib/server/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

/* ---------------- symbol quote cache ---------------- */

interface Quote {
  symbol: string
  name: string
  currency: string
  exchange: string
  price: number
  prevClose: number
  change: number
  changePct: number
  dayHigh: number
  dayLow: number
  volume: number
  at: number
  spark: number[] // recent 1-minute closes (max 90)
}

const qCache = new Map<string, { at: number; quote: Quote | null; error?: string }>()
const QUOTE_TTL = 9_000 // each symbol re-fetches at most every ~9 s (staggered by poll flow)
const MAX_PER_CALL = 8 // outbound Yahoo calls per request — keeps the poll loop cheap

async function yahooChart(symbol: string, range: string, interval: string): Promise<{ status: number; body: unknown }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(7000),
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function quoteFromChart(symbol: string, body: unknown): Quote | null {
  const b = body as {
    chart?: { result?: Array<{
      meta?: Record<string, unknown>
      timestamp?: number[]
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> }
    }> }
  }
  const r = b?.chart?.result?.[0]
  if (!r) return null
  const meta = r.meta || {}
  const price = num(meta.regularMarketPrice) || num(meta.previousClose)
  const prev = num(meta.chartPreviousClose) || num(meta.previousClose) || price
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
  const spark = closes.slice(-90)
  return {
    symbol: String(meta.symbol || symbol).toUpperCase(),
    name: String(meta.longName || meta.shortName || meta.symbol || symbol),
    currency: String(meta.currency || 'USD'),
    exchange: String(meta.fullExchangeName || meta.exchangeName || ''),
    price,
    prevClose: prev,
    change: price - prev,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    dayHigh: num(meta.regularMarketDayHigh) || Math.max(price, ...spark.slice(-30)),
    dayLow: num(meta.regularMarketDayLow) || Math.min(price, ...spark.slice(-30)),
    volume: num(meta.regularMarketVolume),
    at: num(meta.regularMarketTime) ? num(meta.regularMarketTime) * 1000 : Date.now(),
    spark,
  }
}

async function refreshQuote(symbol: string): Promise<void> {
  try {
    const { status, body } = await yahooChart(symbol, '1d', '1m')
    const q = status === 200 ? quoteFromChart(symbol.toUpperCase(), body) : null
    qCache.set(symbol, { at: Date.now(), quote: q, error: q ? undefined : `yahoo ${status}` })
  } catch (e) {
    qCache.set(symbol, { at: Date.now(), quote: qCache.get(symbol)?.quote || null, error: e instanceof Error ? e.message : 'fetch failed' })
  }
}

/* ---------------- candle cache ---------------- */

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
const cCache = new Map<string, { at: number; candles: Candle[]; closes: { t: number; p: number }[]; meta: Record<string, unknown> | null; error?: string }>()

function candlesFromChart(body: unknown, symbol: string, interval: string): { candles: Candle[]; closes: { t: number; p: number }[]; meta: Record<string, unknown> | null } | null {
  const b = body as {
    chart?: { result?: Array<{
      meta?: Record<string, unknown>
      timestamp?: number[]
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> }
    }> }
  }
  const r = b?.chart?.result?.[0]
  if (!r || !Array.isArray(r.timestamp)) return null
  const q = r.indicators?.quote?.[0] || {}
  const candles: Candle[] = []
  const closes: { t: number; p: number }[] = []
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    if (typeof o !== 'number' || typeof h !== 'number' || typeof l !== 'number' || typeof c !== 'number') continue
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue
    candles.push({ t: r.timestamp[i] * 1000, o, h, l, c, v: typeof q.volume?.[i] === 'number' ? (q.volume[i] as number) : 0 })
    closes.push({ t: r.timestamp[i] * 1000, p: c })
  }
  return { candles, closes, meta: { symbol: String((r.meta as Record<string, unknown>)?.symbol || symbol), currency: (r.meta as Record<string, unknown>)?.currency || 'USD', interval } }
}

/* ---------------- rates cache ---------------- */

interface RatesEntry { at: number; base: string; date: string; rates: Record<string, number>; count: number }
let ratesEntry: RatesEntry | null = null
let ratesPending: Promise<RatesEntry> | null = null

async function loadRates(): Promise<RatesEntry> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`rates HTTP ${res.status}`)
  const j = (await res.json()) as { result?: string; base_code?: string; time_last_update_utc?: string; rates?: Record<string, number> }
  if (j.result !== 'success' || !j.rates) throw new Error('rates payload invalid')
  const rates: Record<string, number> = {}
  for (const [k, v] of Object.entries(j.rates)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) rates[k.toUpperCase()] = v
  return { at: Date.now(), base: j.base_code || 'USD', date: j.time_last_update_utc || new Date().toUTCString(), rates, count: Object.keys(rates).length }
}

/* ---------------- handler ---------------- */

export async function GET(req: Request) {
  const gate = rateLimit(clientKey(req, 'market'), 600, 60_000) // 1s polling by design — generous ceiling
  if (!gate.ok) return tooMany(gate.retryAfter)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'quotes'

  try {
    if (action === 'quotes') {
      const symbols = [...new Set((url.searchParams.get('symbols') || '')
        .split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.\-^=]{1,12}$/.test(s)))].slice(0, 64)
      if (!symbols.length) return NextResponse.json({ ok: false, error: 'no valid symbols' }, { status: 400 })

      const now = Date.now()
      const stale = symbols
        .filter((s) => {
          const c = qCache.get(s)
          return !c || now - c.at > QUOTE_TTL
        })
        .sort((a, b) => (qCache.get(a)?.at || 0) - (qCache.get(b)?.at || 0))
        .slice(0, MAX_PER_CALL)
      if (stale.length) {
        await Promise.allSettled(stale.map((s) => refreshQuote(s)))
      }

      const quotes: Array<Quote & { live: boolean }> = []
      const errors: Record<string, string> = {}
      for (const s of symbols) {
        const c = qCache.get(s)
        if (c?.quote) quotes.push({ ...c.quote, live: now - c.at < QUOTE_TTL * 4 })
        else errors[s] = c?.error || 'no data'
      }
      return NextResponse.json({ ok: quotes.length > 0, at: now, quotes, errors, refreshed: stale })
    }

    if (action === 'chart') {
      const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase().slice(0, 12)
      if (!/^[A-Z0-9.\-^=]{1,12}$/.test(symbol)) return NextResponse.json({ ok: false, error: 'invalid symbol' }, { status: 400 })
      const RANGE_INTERVAL: Record<string, string> = { '1d': '5m', '5d': '15m', '1mo': '1h', '3mo': '1d', '6mo': '1d', '1y': '1d', '2y': '1wk', '5y': '1wk', max: '1mo' }
      const range = url.searchParams.get('range') || '1d'
      const interval = RANGE_INTERVAL[range] ? (url.searchParams.get('interval') || RANGE_INTERVAL[range]) : '1d'
      if (!/^[0-9a-z]{1,4}$/.test(interval)) return NextResponse.json({ ok: false, error: 'invalid interval' }, { status: 400 })
      if (!/^(1d|5d|1mo|3mo|6mo|1y|2y|5y|max)$/.test(range)) return NextResponse.json({ ok: false, error: 'invalid range' }, { status: 400 })

      const key = `${symbol}|${range}|${interval}`
      const ttl = range === '1d' ? 30_000 : range === '5d' ? 60_000 : 120_000
      const hit = cCache.get(key)
      if (hit && Date.now() - hit.at < ttl && !hit.error) {
        return NextResponse.json({ ok: true, ...hit, cached: true })
      }
      const { status, body } = await yahooChart(symbol, range, interval)
      if (status !== 200) {
        if (hit) return NextResponse.json({ ok: true, ...hit, cached: true, stale: true })
        return NextResponse.json({ ok: false, error: `chart unavailable (HTTP ${status})` }, { status: 502 })
      }
      const parsed = candlesFromChart(body, symbol, interval)
      if (!parsed || !parsed.candles.length) {
        if (hit?.candles.length) return NextResponse.json({ ok: true, ...hit, cached: true, stale: true })
        return NextResponse.json({ ok: false, error: 'no chart data for this symbol/range' }, { status: 404 })
      }
      const entry = { at: Date.now(), ...parsed }
      cCache.set(key, entry)
      if (cCache.size > 200) {
        const oldest = [...cCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 60)
        for (const [k] of oldest) cCache.delete(k)
      }
      return NextResponse.json({ ok: true, ...entry, cached: false })
    }

    if (action === 'rates') {
      if (!ratesEntry || Date.now() - ratesEntry.at > 15 * 60_000) {
        if (!ratesPending) {
          ratesPending = loadRates()
            .then((r) => {
              ratesEntry = r
              ratesPending = null
              return r
            })
            .catch((e) => {
              ratesPending = null
              throw e
            })
        }
        const r = await ratesPending
        return NextResponse.json({ ok: true, ...r })
      }
      return NextResponse.json({ ok: true, ...ratesEntry, cached: true })
    }

    return NextResponse.json({ ok: false, error: 'unknown action — use quotes | chart | rates' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'market gateway failed' }, { status: 502 })
  }
}
