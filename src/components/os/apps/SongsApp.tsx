// REDSEC 6.0 — Audio Fly — the OS music app. UNLIMITED EDITION.
// "Listen unlimited songs without any ads" — that is the whole pitch.
// REAL-TIME search, REAL full-length songs, OFFICIAL artist verification,
// and the UNLIMITED radio-chain: every list pages forever (50 official
// tracks per hop, each with its official VIEW and LIKE counts). Likes are
// stored without any cap. The home feed is a Windows-Phone-8 METRO grid of
// uniform MEDIUM squares — no extra-large tiles — flat, clean, zero bloat.
// UI v2 — premium streaming look: deep charcoal surfaces, signature green
// accents, circular green play buttons, a time-based greeting and an
// autoplay queue that never stops (the radio chain keeps feeding it). The
// app presents itself as Audio Fly, the music app — nothing else.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck, ChevronLeft, Heart, House, ListMusic, Loader2, Music, Pause, Play,
  Repeat, RotateCw, Search as SearchIcon, Shuffle, SkipBack, SkipForward,
  MonitorPlay, Volume2, VolumeX,
} from 'lucide-react'
import { AppShell, TBtn, Toolbar, WifiGate, useVoiceTyping } from './_shared'
import { useOS } from '@/lib/os/store'
import type { YtmAlbum, YtmArtist, YtmArtistPage, YtmHomeResult, YtmSearchResult, YtmTrack, YtmVerified } from '@/lib/os/ytm'

/* ---------------- YouTube IFrame API types ---------------- */
interface YTPlayer {
  loadVideoById(id: string): void
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setVolume(v: number): void
  mute(): void
  unMute(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  destroy(): void
}
interface YTEvent { data: number; target: YTPlayer }
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
    __audiofly?: Record<string, unknown>
  }
}

const LIKES_KEY = 'redsec5.audiofly.likes.v2'

const MOODS = [
  'Pop hits', 'Hip-hop hits', 'Chill lo-fi', 'Rock anthems', 'EDM party',
  'R&B slow jams', 'Workout energy', 'Jazz cafe', 'K-pop now', 'Country road',
]

const fmtTime = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
const parseDur = (d: string): number => {
  const p = d.split(':').map(Number)
  if (p.some(Number.isNaN) || !p.length) return 0
  return p.reduce((acc, n) => acc * 60 + n, 0)
}

/** time-based greeting — the streaming-app signature */
const greeting = (): string => {
  const h = new Date().getHours()
  if (h < 5) return 'Late night listening'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** keep lists clean — one entry per videoId, order preserved */
const dedupe = (list: YtmTrack[]): YtmTrack[] => {
  const seen = new Set<string>()
  const out: YtmTrack[] = []
  for (const t of list) {
    if (!t?.videoId || seen.has(t.videoId)) continue
    seen.add(t.videoId)
    out.push(t)
  }
  return out
}

/** official views/likes line for a track — real YouTube numbers, never capped, never faked */
const viewsLine = (t: YtmTrack): string => {
  const parts: string[] = []
  if (t.views) parts.push(t.views)
  else if (t.extra) parts.push(t.extra.replace(/\bplays?\b/i, 'views'))
  if (t.likes) parts.push(t.likes)
  return parts.join(' · ')
}

function loadLikes(): YtmTrack[] {
  try {
    const raw = localStorage.getItem(LIKES_KEY)
    const arr = raw ? (JSON.parse(raw) as YtmTrack[]) : []
    /* NO cap — every like is kept forever, exactly as the user left it */
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.videoId === 'string') : []
  } catch {
    return []
  }
}

export default function SongsApp() {
  const notify = useOS((s) => s.notify)

  /* ---------- data state ---------- */
  const [tab, setTab] = useState<'home' | 'search' | 'artist' | 'liked'>('home')
  const [prevTab, setPrevTab] = useState<'home' | 'search' | 'liked'>('home')
  /* Task 80 — the home feed is a Windows-Phone-8 METRO grid by default; the
     classic list stays one toggle away. */
  const [homeStyle, setHomeStyle] = useState<'metro' | 'list'>('metro')
  const [query, setQuery] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [homeTracks, setHomeTracks] = useState<YtmTrack[]>([])
  const [res, setRes] = useState<YtmSearchResult | null>(null)
  const [artistView, setArtistView] = useState<YtmArtistPage | null>(null)
  const [artistLoading, setArtistLoading] = useState(false)
  const [verified, setVerified] = useState<Record<string, YtmVerified>>({})
  const [likes, setLikes] = useState<YtmTrack[]>(() => loadLikes())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  /* ---------- player state ---------- */
  const [queue, setQueue] = useState<YtmTrack[]>([])
  const [qIdx, setQIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(0.85)
  const [muted, setMuted] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [streamErr, setStreamErr] = useState(false)
  const [apiDead, setApiDead] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [showVideo, setShowVideo] = useState(false)

  /* ---------- unlimited engine state ---------- */
  const [homeSeed, setHomeSeed] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)
  const [likedLimit, setLikedLimit] = useState(300)

  const ytMountRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const apiLoadRef = useRef<Promise<YTNamespace> | null>(null)
  const pendingRef = useRef<string | null>(null)
  const advanceRef = useRef<(dir: 1 | -1, fromEnded?: boolean) => void>(() => {})

  const current = qIdx >= 0 && qIdx < queue.length ? queue[qIdx] : null
  const likedIds = useMemo(() => new Set(likes.map((l) => l.videoId)), [likes])
  const isVerified = useCallback(
    (name: string | undefined) => (name ? verified[name.toLowerCase()]?.verified === true : false),
    [verified]
  )

  /* refs the player callbacks read at event time — declared up front */
  const queueRef = useRef<YtmTrack[]>([])
  const qIdxRef = useRef(-1)
  const playingRef = useRef(false)
  const stuckRef = useRef(0)
  const blockedRef = useRef(false)
  const errStreakRef = useRef(0)
  const pinnedRef = useRef(false)
  const blockedNotifiedRef = useRef(false)
  useEffect(() => {
    queueRef.current = queue
    qIdxRef.current = qIdx
  }, [queue, qIdx])
  useEffect(() => {
    playingRef.current = playing
  }, [playing])
  const streamErrRef = useRef(false)
  useEffect(() => {
    streamErrRef.current = streamErr
  }, [streamErr])

  /* auto-show the player pane when YouTube needs a check; auto-hide on play */
  useEffect(() => {
    if (playing && !pinnedRef.current) setShowVideo(false)
  }, [playing])

  const toggleVideoPane = useCallback(() => {
    setShowVideo((v) => {
      const next = !v
      pinnedRef.current = next
      return next
    })
  }, [])

  /* ---------- YouTube IFrame API loader ---------- */
  const loadYT = useCallback((): Promise<YTNamespace> => {
    if (apiLoadRef.current) return apiLoadRef.current
    apiLoadRef.current = new Promise<YTNamespace>((resolve, reject) => {
      if (window.YT?.Player) {
        resolve(window.YT)
        return
      }
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        try {
          prev?.()
        } catch { /* previous handler */ }
        if (window.YT?.Player) resolve(window.YT)
        else reject(new Error('YT namespace missing'))
      }
      if (!document.getElementById('yt-iframe-api')) {
        const s = document.createElement('script')
        s.id = 'yt-iframe-api'
        s.src = 'https://www.youtube.com/iframe_api'
        s.async = true
        s.onerror = () => reject(new Error('YT api unreachable'))
        document.head.appendChild(s)
      }
      window.setTimeout(() => {
        if (!window.YT?.Player) reject(new Error('YT api timeout'))
      }, 15000)
    }).catch((e) => {
      apiLoadRef.current = null
      throw e
    })
    return apiLoadRef.current
  }, [])

  /* ---------- player lifecycle ---------- */
  const ensurePlayer = useCallback(
    (videoId: string) => {
      pendingRef.current = videoId
      void loadYT()
        .then((YT) => {
          if (playerRef.current) {
            try {
              playerRef.current.loadVideoById(pendingRef.current || videoId)
              playerRef.current.playVideo()
            } catch { /* replaced below */ }
            return
          }
          const mount = ytMountRef.current
          if (!mount) return
          const host = document.createElement('div')
          mount.replaceChildren(host)
          playerRef.current = new YT.Player(host, {
            height: '180',
            width: '320',
            videoId: pendingRef.current || videoId,
            playerVars: {
              autoplay: 1,
              playsinline: 1,
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              rel: 0,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: (e: YTEvent) => {
                try {
                  e.target.setVolume(muted ? 0 : Math.round(vol * 100))
                  if (pendingRef.current) e.target.loadVideoById(pendingRef.current)
                  e.target.playVideo()
                } catch { /* autoplay guard */ }
              },
              onStateChange: (e: YTEvent) => {
                if (e.data === 1) {
                  setPlaying(true)
                  setBuffering(false)
                  setStreamErr(false)
                  setApiDead(false)
                  errStreakRef.current = 0
                } else if (e.data === 2) {
                  setPlaying(false)
                } else if (e.data === 3) {
                  setBuffering(true)
                } else if (e.data === 0) {
                  advanceRef.current(1, true)
                }
              },
              onError: (e: YTEvent) => {
                const why =
                  e.data === 101 || e.data === 150
                    ? 'The rights owner blocked embedding for this one'
                    : e.data === 100
                      ? 'That track is no longer available'
                      : 'Playback hiccup'
                setBuffering(false)
                setStreamErr(true)
                errStreakRef.current += 1
                const t = queueRef.current[qIdxRef.current]
                if (errStreakRef.current >= 3) {
                  /* YouTube is gating playback (bot-check / rights) — stop burning
                     the queue and surface the real player so the user can act */
                  blockedRef.current = true
                  setBlocked(true)
                  pinnedRef.current = true
                  setShowVideo(true)
                  if (!blockedNotifiedRef.current) {
                    blockedNotifiedRef.current = true
                    notify({
                      title: 'Audio Fly — player check',
                      body: 'Playback needs a quick confirmation. Use the player window that just opened, then press play.',
                      kind: 'warn',
                      emoji: '🎵',
                    })
                  }
                  return
                }
                if (t) {
                  notify({ title: 'Audio Fly — skip', body: `${why}. Moving to the next track…`, kind: 'warn', emoji: '🎵' })
                  window.setTimeout(() => advanceRef.current(1), 450)
                }
              },
            },
          })
        })
        .catch(() => {
          setApiDead(true)
          setBuffering(false)
        })
    },
    [muted, vol, notify]
  )

  /* drive the player when the queue pointer changes */
  useEffect(() => {
    if (!current) return
    setCur(0)
    setDur(parseDur(current.duration))
    setBuffering(true)
    setStreamErr(false)
    setPlaying(true)
    stuckRef.current = 0
    blockedRef.current = false
    setBlocked(false)
    ensurePlayer(current.videoId)
  }, [current?.videoId])

  useEffect(() => {
    const p = playerRef.current
    if (!p?.setVolume) return
    try {
      p.setVolume(muted ? 0 : Math.round(vol * 100))
      if (muted) p.mute()
      else p.unMute()
    } catch { /* not ready */ }
  }, [vol, muted])

  /* real-time progress + stuck watchdog + QA hook */
  useEffect(() => {
    const iv = window.setInterval(() => {
      const p = playerRef.current
      if (!p?.getCurrentTime) return
      try {
        const t = p.getCurrentTime() || 0
        const d = p.getDuration() || 0
        const st = p.getPlayerState?.() ?? -1
        setCur(t)
        if (d) setDur(d)
        /* watchdog: expected-playing but still UNSTARTED/CUED → nudge, retry, report */
        if (playingRef.current && (st === -1 || st === 5) && !streamErrRef.current) {
          stuckRef.current += 500
          if (stuckRef.current === 6000) {
            try {
              p.playVideo()
            } catch { /* nudging */ }
          } else if (stuckRef.current === 13000) {
            const vid = queueRef.current[qIdxRef.current]?.videoId
            if (vid) {
              try {
                p.loadVideoById(vid)
                p.playVideo()
              } catch { /* retrying */ }
            }
          } else if (stuckRef.current >= 20000 && !blockedRef.current) {
            blockedRef.current = true
            setBlocked(true)
            pinnedRef.current = true
            setShowVideo(true)
            if (!blockedNotifiedRef.current) {
              blockedNotifiedRef.current = true
              notify({
                title: 'Audio Fly — player check',
                body: 'Playback needs a quick confirmation. Use the player window that just opened.',
                kind: 'warn',
                emoji: '🎵',
              })
            }
          }
        } else if (st >= 2) {
          stuckRef.current = 0
          if (blockedRef.current) {
            blockedRef.current = false
            setBlocked(false)
            blockedNotifiedRef.current = false
          }
        }
        window.__audiofly = {
          title: queueRef.current[qIdxRef.current]?.title ?? '',
          videoId: queueRef.current[qIdxRef.current]?.videoId ?? '',
          state: st,
          cur: Math.round(t),
          dur: Math.round(d),
        }
      } catch { /* player mid-teardown */ }
    }, 500)
    return () => window.clearInterval(iv)
  }, [])

  /* teardown */
  useEffect(() => {
    return () => {
      try {
        playerRef.current?.destroy()
      } catch { /* already gone */ }
      playerRef.current = null
      ytMountRef.current?.replaceChildren()
    }
  }, [])

  /* ---------- transport ---------- */
  const playTrack = useCallback((list: YtmTrack[], idx: number) => {
    if (!list[idx]) return
    setQueue(list)
    setQIdx(idx)
  }, [])

  const nextIdx = useCallback(
    (dir: 1 | -1): number => {
      const q = queueRef.current
      const i = qIdxRef.current
      if (!q.length) return -1
      if (shuffle && dir === 1 && q.length > 1) {
        let n = i
        while (n === i) n = Math.floor(Math.random() * q.length)
        return n
      }
      const n = i + dir
      if (n >= q.length) return repeat ? 0 : -1
      if (n < 0) return 0
      return n
    },
    [shuffle, repeat]
  )

  /* streaming-style autoplay — when the queue runs dry, the radio chain
     appends a fresh page of similar tracks and the music keeps going */
  const extendingRef = useRef(false)
  const extendAndPlay = useCallback(
    async (seedVideoId: string) => {
      if (extendingRef.current) return
      extendingRef.current = true
      try {
        const r = await fetch(`/api/music?mode=radio&v=${encodeURIComponent(seedVideoId)}`)
        const j = (await r.json()) as YtmHomeResult
        const songs = j.songs || []
        if (!songs.length) {
          setPlaying(false)
          setBuffering(false)
          return
        }
        const merged = dedupe([...queueRef.current, ...songs])
        queueRef.current = merged
        setQueue(merged)
        playTrack(merged, Math.min(qIdxRef.current + 1, merged.length - 1))
      } catch {
        setPlaying(false)
        setBuffering(false)
      } finally {
        extendingRef.current = false
      }
    },
    [playTrack]
  )

  const advance = useCallback(
    (dir: 1 | -1, fromEnded = false) => {
      const n = nextIdx(dir)
      if (n < 0) {
        /* autoplay: end of queue → extend it with the radio chain and continue */
        const last = queueRef.current[qIdxRef.current]
        if (dir === 1 && last?.videoId) {
          setBuffering(true)
          void extendAndPlay(last.videoId)
          return
        }
        setPlaying(false)
        if (fromEnded) setCur(0)
        return
      }
      playTrack(queueRef.current, n)
    },
    [nextIdx, playTrack, extendAndPlay]
  )
  advanceRef.current = advance

  const togglePlay = () => {
    const p = playerRef.current
    if (!p || !current) return
    try {
      if (playing) {
        p.pauseVideo()
        setPlaying(false)
      } else {
        p.playVideo()
        setPlaying(true)
      }
    } catch { /* not ready */ }
  }

  const seek = (frac: number) => {
    const p = playerRef.current
    if (!p || !dur) return
    const target = Math.min(1, Math.max(0, frac)) * dur
    try {
      p.seekTo(target, true)
      setCur(target)
    } catch { /* not ready */ }
  }

  /* ---------- data ---------- */
  const loadHome = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await fetch('/api/music?mode=home')
      const j = (await r.json()) as YtmHomeResult
      setHomeTracks(j.songs || [])
      setHomeSeed(j.seed || '')
      if (!j.ok) setErr(j.error || 'The music service is unreachable right now.')
    } catch {
      setErr('The music service is unreachable — check the connection and retry.')
    } finally {
      setLoading(false)
    }
  }, [])

  const runSearch = useCallback(async (q: string) => {
    setLoading(true)
    setErr('')
    try {
      const r = await fetch(`/api/music?mode=search&q=${encodeURIComponent(q)}`)
      const j = (await r.json()) as YtmSearchResult & { error?: string }
      setRes(j)
      if (!j.ok) setErr(j.error || 'The search could not reach the music service.')
    } catch {
      setErr('The search could not reach the music service — retry in a moment.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'home') void loadHome()
  }, [tab, loadHome])

  /* live (debounced) search — real-time */
  useEffect(() => {
    if (tab !== 'search' || !searchQ.trim()) return
    const t = window.setTimeout(() => void runSearch(searchQ.trim()), 450)
    return () => window.clearTimeout(t)
  }, [searchQ, tab, runSearch])

  const doSearch = (q?: string) => {
    const term = (q ?? query).trim()
    if (!term) return
    setQuery(term)
    setSearchQ(term)
    setTab('search')
  }

  /* ---------- verified artists (Official Artist Channel badges) ---------- */
  const verifiedRef = useRef<Record<string, YtmVerified>>({})
  useEffect(() => {
    verifiedRef.current = verified
  }, [verified])

  const fetchVerified = useCallback(async (names: string[]) => {
    const fresh = names
      .filter((n) => n && n !== 'Unknown artist' && !(n.toLowerCase() in verifiedRef.current))
      .slice(0, 8)
    if (!fresh.length) return
    try {
      const r = await fetch(`/api/music?mode=verify&ids=${encodeURIComponent(fresh.join(','))}`)
      const j = (await r.json()) as { ok?: boolean; verified?: Record<string, YtmVerified> }
      if (j.ok && j.verified) {
        setVerified((prev) => {
          const next = { ...prev }
          for (const [name, v] of Object.entries(j.verified || {})) next[name.toLowerCase()] = v
          return next
        })
      }
    } catch { /* badges are decorative — never block the app */ }
  }, [])

  const openArtist = useCallback(
    async (a: YtmArtist) => {
      setPrevTab(tab === 'artist' ? prevTab : tab === 'liked' ? 'liked' : tab)
      setTab('artist')
      setArtistLoading(true)
      setArtistView(null)
      setErr('')
      try {
        const r = await fetch(`/api/music?mode=artist&id=${encodeURIComponent(a.id)}`)
        const j = (await r.json()) as YtmArtistPage
        setArtistView(j.ok ? j : null)
        if (!j.ok) setErr('The artist page could not be loaded.')
        if (j.ok && j.artist.name) void fetchVerified([j.artist.name])
      } catch {
        setErr('The artist page could not be loaded — retry in a moment.')
      } finally {
        setArtistLoading(false)
      }
    },
    [tab, prevTab, fetchVerified]
  )

  const searchArtistNames = useMemo(() => {
    if (!res) return []
    const names = new Set<string>()
    if (res.top?.kind === 'artist') names.add(res.top.artist.name)
    res.artists.forEach((a) => names.add(a.name))
    res.songs.slice(0, 15).forEach((s) => names.add(s.artist))
    return [...names].filter(Boolean).slice(0, 8)
  }, [res])

  useEffect(() => {
    if (searchArtistNames.length) void fetchVerified(searchArtistNames)
  }, [searchArtistNames.join('|')])

  /* ---------- likes (NO cap — unlimited, saved forever) ---------- */
  const toggleLike = (t: YtmTrack) => {
    setLikes((prev) => {
      const next = prev.some((l) => l.videoId === t.videoId) ? prev.filter((l) => l.videoId !== t.videoId) : [t, ...prev]
      try {
        localStorage.setItem(LIKES_KEY, JSON.stringify(next))
      } catch { /* storage full — likes stay in memory for the session */ }
      return next
    })
  }

  /* ---------- UNLIMITED — the radio-chain engine ----------
     Every list pages FOREVER through the real YouTube Music autoplay queue
     (youtubei/v1 next, RDAMVM radio): 50 official tracks per hop, each one
     carrying its official view + like counts. The sentinel fires near the
     bottom of the scroll; a visible button backs it up. Likes tab renders
     in growing chunks so thousands of likes stay butter-smooth. */
  const loadMore = useCallback(async () => {
    if (tab === 'liked') {
      setLikedLimit((l) => l + 400)
      return
    }
    if (loadingMoreRef.current || loading) return
    const seed = tab === 'home' ? homeSeed : tab === 'search' ? res?.seed || '' : tab === 'artist' ? artistView?.seed || '' : ''
    if (!seed) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const r = await fetch(`/api/music?mode=radio&v=${encodeURIComponent(seed)}`)
      const j = (await r.json()) as YtmHomeResult
      const songs = j.songs || []
      const next = j.seed || (songs.length ? songs[songs.length - 1].videoId : '')
      if (j.ok && songs.length) {
        if (tab === 'home') {
          setHomeTracks((prev) => dedupe([...prev, ...songs]))
          setHomeSeed(next)
        } else if (tab === 'search') {
          setRes((prev) => (prev ? { ...prev, songs: dedupe([...prev.songs, ...songs]), seed: next } : prev))
        } else if (tab === 'artist') {
          setArtistView((prev) => (prev ? { ...prev, songs: dedupe([...prev.songs, ...songs]), seed: next } : prev))
        }
      } else {
        /* hop failed — park the seed; the user can retry via the button */
        if (tab === 'home') setHomeSeed('')
        else if (tab === 'search') setRes((prev) => (prev ? { ...prev, seed: '' } : prev))
        else if (tab === 'artist') setArtistView((prev) => (prev ? { ...prev, seed: '' } : prev))
      }
    } catch {
      /* network hiccup — the sentinel will fire again on the next scroll */
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [tab, homeSeed, res, artistView, loading])

  const loadMoreRef = useRef<() => void>(() => {})
  loadMoreRef.current = () => void loadMore()

  /* auto-load the next radio page when the sentinel scrolls into view */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current()
      },
      { root: scrollRef.current, rootMargin: '900px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useVoiceTyping(
    useCallback((text: string) => {
      setQuery((prev) => `${prev} ${text}`.trim())
    }, [])
  )

  /* ---------- shared row rendering ---------- */
  const VerifiedTag = ({ name, className = '' }: { name: string | undefined; className?: string }) =>
    isVerified(name) ? (
      <BadgeCheck
        className={`h-3.5 w-3.5 flex-none text-sky-400 ${className}`}
        aria-label={`${name} is a verified artist`}
      />
    ) : null

  const renderList = (list: YtmTrack[], emptyNote: string) => {
    if (!list.length) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <span className="text-4xl opacity-60">🎵</span>
          <div className="text-sm font-medium text-slate-300">{emptyNote}</div>
        </div>
      )
    }
    return (
      <ul className="space-y-0.5 px-2 pb-4">
        {list.map((t, i) => {
          const active = current?.videoId === t.videoId
          return (
            <li key={`${t.videoId}-${i}`}>
              <div
                className={`group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors ${active ? 'bg-[#1DB954]/15 ring-1 ring-[#1DB954]/40' : 'hover:bg-white/[0.06]'}`}
              >
                <button
                  type="button"
                  onClick={() => playTrack(list, i)}
                  className="relative h-11 w-11 flex-none overflow-hidden rounded-lg bg-white/10"
                  aria-label={`Play ${t.title} by ${t.artist}`}
                >
                  {t.thumb ? (
                    <img src={t.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-slate-400"><Music className="h-4 w-4" /></span>
                  )}
                  <span className={`absolute inset-0 flex items-center justify-center bg-black/55 text-white transition-opacity ${active && !playing ? 'opacity-100' : active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    {active && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </span>
                </button>
                <button type="button" onClick={() => playTrack(list, i)} className="min-w-0 flex-1 text-left">
                  <div className={`truncate text-[12.5px] font-semibold ${active ? 'text-[#1DB954]' : 'text-slate-100'}`}>
                    {t.title}
                    {t.kind === 'video' && <span className="ml-1.5 rounded bg-sky-400/15 px-1 py-px align-middle text-[8.5px] font-bold tracking-wide text-sky-300">VIDEO</span>}
                  </div>
                  <div className="flex items-center gap-1 truncate text-[10.5px] text-slate-500">
                    <span className="truncate">{t.artist}</span>
                    <VerifiedTag name={t.artist} />
                    {t.album ? <span className="truncate">· {t.album}</span> : null}
                    {viewsLine(t) ? <span className="truncate">· {viewsLine(t)}</span> : null}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => toggleLike(t)}
                  className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-colors ${
                    likedIds.has(t.videoId) ? 'text-[#1DB954] hover:bg-[#1DB954]/15' : 'text-slate-500 opacity-0 hover:bg-white/10 hover:text-[#1DB954] group-hover:opacity-100'
                  }`}
                  aria-label={likedIds.has(t.videoId) ? `Unlike ${t.title}` : `Like ${t.title}`}
                >
                  <Heart className={`h-4 w-4 ${likedIds.has(t.videoId) ? 'fill-[#1DB954]' : ''}`} />
                </button>
                <span className="w-10 flex-none text-right font-mono text-[10.5px] tabular-nums text-slate-500">
                  {t.duration || (active && dur ? fmtTime(dur) : '—')}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  const skeletons = (
    <div className="space-y-1.5 px-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl bg-white/[0.04] p-2.5">
          <div className="h-11 w-11 flex-none rounded-lg bg-white/10" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-2.5 w-2/3 rounded bg-white/10" />
            <div className="h-2 w-1/3 rounded bg-white/[0.07]" />
          </div>
          <div className="h-2 w-8 rounded bg-white/[0.07]" />
        </div>
      ))}
    </div>
  )

  /* ================= METRO TILES — Windows Phone 8, MEDIUM squares =================
     One uniform grid: every tile the SAME medium square — no extra-large
     hero tiles. Flat saturated accent colors, album art under the color,
     title, artist and the official views/likes right on the tile. */
  const METRO_COLORS = ['#e81123', '#c30052', '#bf1e4b', '#8c0095', '#6a00ff', '#0050ef', '#008a00', '#00b294', '#00a300', '#a4c400', '#f09609', '#d80073', '#7e3878', '#603cba']
  const metroTiles = (list: YtmTrack[], emptyNote: string) => {
    if (!list.length) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <span className="text-4xl opacity-60">🎵</span>
          <div className="text-sm font-medium text-slate-300">{emptyNote}</div>
        </div>
      )
    }
    return (
      <div className="px-3 pb-4">
        <div className="grid grid-cols-3 gap-2 @[460px]:grid-cols-4 @[660px]:grid-cols-5 @[920px]:grid-cols-6">
          {list.map((t, i) => {
            const active = current?.videoId === t.videoId
            const color = METRO_COLORS[i % METRO_COLORS.length]
            const vline = viewsLine(t)
            return (
              <div
                key={`${t.videoId}-m-${i}`}
                role="group"
                className={`group relative overflow-hidden text-left shadow-md transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] ${active ? 'ring-2 ring-white/80' : ''}`}
                style={{ aspectRatio: '1 / 1', background: color }}
              >
                {/* album art — flat, slightly transparent under the accent color */}
                {t.thumb ? (
                  <img
                    src={t.thumb}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover opacity-40 transition-opacity group-hover:opacity-60"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => playTrack(list, i)}
                  className="absolute inset-0 flex flex-col justify-between p-2.5 text-left"
                  aria-label={`Play ${t.title} by ${t.artist}`}
                >
                  <span className="line-clamp-3 text-[12px] font-bold leading-snug text-white drop-shadow">{t.title}</span>
                  <span className="block">
                    <span className="block truncate text-[10px] font-semibold text-white/90">{t.artist}</span>
                    <span className="mt-0.5 block truncate text-[8.5px] font-bold text-white/70">
                      {vline || t.duration || '▶'}
                    </span>
                  </span>
                </button>
                {/* now playing sheen */}
                {active && (
                  <span className="pointer-events-none absolute inset-0 bg-white/10">
                    <span className="absolute bottom-1.5 left-2 flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-white">
                      {playing ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />} NOW PLAYING
                    </span>
                  </span>
                )}
                {/* like corner */}
                <button
                  type="button"
                  onClick={() => toggleLike(t)}
                  className={`absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/35 transition-colors hover:bg-black/55 ${
                    likedIds.has(t.videoId) ? 'text-[#1DB954]' : 'text-white/70 opacity-0 group-hover:opacity-100'
                  }`}
                  aria-label={likedIds.has(t.videoId) ? `Unlike ${t.title}` : `Like ${t.title}`}
                >
                  <Heart className={`h-3.5 w-3.5 ${likedIds.has(t.videoId) ? 'fill-[#1DB954] text-[#1DB954]' : ''}`} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  /* ---------- render ---------- */
  const topArtist = res?.top?.kind === 'artist' ? res.top.artist : null
  const topSong = res?.top?.kind === 'song' ? res.top.song : res?.top?.kind === 'video' ? res.top.video : null
  /* the header stays clean: a greeting up top, no counts, no labels */
  const subTitle =
    tab === 'liked'
      ? `${likes.length} songs`
      : tab === 'artist'
        ? artistView?.artist.audience || ''
        : ''

  return (
    <WifiGate app="Audio Fly">
      <AppShell>
        {/* YouTube IFrame player — hidden audio mode by default, pops up when
            YouTube demands a check or the user opens the video pane */}
        <div
          aria-hidden={!showVideo}
          className={`fixed bottom-[104px] right-3 z-40 overflow-hidden transition-all duration-300 ${
            showVideo
              ? 'h-[180px] w-[320px] rounded-xl border border-white/15 bg-black shadow-2xl opacity-100'
              : 'pointer-events-none bottom-0 left-0 z-0 h-[90px] w-[160px] opacity-0'
          }`}
        >
          <div ref={ytMountRef} className="h-full w-full" />
        </div>

        <Toolbar>
          <Music className="mx-1 h-4 w-4 flex-none text-[#1DB954]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-slate-200">Audio Fly</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Listen unlimited songs without any ads
            </div>
          </div>
          <div className="relative hidden min-w-0 flex-1 sm:block">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder="Search songs, artists, moods…"
              className="h-8 w-full rounded-lg border border-white/10 bg-black/30 pl-8 pr-3 text-xs text-slate-100 outline-none focus:border-[#1DB954]/60"
              aria-label="Search songs"
            />
          </div>
          <TBtn title="Home — back to the home screen" active={tab === 'home' && homeStyle === 'metro'} onClick={() => { setTab('home'); setHomeStyle('metro') }}>
            <House className={`h-4 w-4 ${tab === 'home' ? 'text-[#1DB954]' : ''}`} />
          </TBtn>
          <TBtn title="Search" active={tab === 'search'} onClick={() => doSearch()}>
            <SearchIcon className="h-4 w-4" />
          </TBtn>
          <TBtn title="Quick picks" active={tab === 'home'} onClick={() => setTab('home')}>
            <ListMusic className="h-4 w-4" />
          </TBtn>
          <TBtn title="Liked songs" active={tab === 'liked'} onClick={() => setTab('liked')}>
            <Heart className={`h-4 w-4 ${tab === 'liked' ? 'fill-[#1DB954] text-[#1DB954]' : ''}`} />
          </TBtn>
        </Toolbar>

        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto os-scroll">
          {/* search bar (mobile) */}
          {tab !== 'artist' && (
            <div className="relative px-3 pt-3 sm:hidden">
              <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                placeholder="Search songs, artists…"
                className="h-9 w-full rounded-lg border border-white/10 bg-black/30 pl-8 pr-3 text-xs text-slate-100 outline-none focus:border-[#1DB954]/60"
                aria-label="Search songs"
              />
            </div>
          )}

          {/* mood chips (home) */}
          {tab === 'home' && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
              {MOODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => doSearch(m)}
                  className="rounded-full bg-white/6 px-3 py-1 text-[10.5px] font-semibold text-slate-300 transition-colors hover:bg-white/12"
                >
                  {m}
                </button>
              ))}
              {/* Task 80 — metro ↔ list toggle lives with the moods */}
              <button
                type="button"
                onClick={() => setHomeStyle((s) => (s === 'metro' ? 'list' : 'metro'))}
                className="ml-auto rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10.5px] font-semibold text-slate-300 transition-colors hover:border-[#1DB954]/50 hover:text-[#1DB954]"
                title={homeStyle === 'metro' ? 'Switch to the classic list' : 'Switch to the Metro tile grid'}
              >
                {homeStyle === 'metro' ? '▦ Metro' : '☰ List'}
              </button>
            </div>
          )}

          {/* header */}
          <div className="flex items-end justify-between px-4 pb-2 pt-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-100">
                {tab === 'home'
                  ? greeting()
                  : tab === 'liked'
                    ? 'Liked songs'
                    : tab === 'artist'
                      ? (artistView?.artist.name || 'Artist')
                      : searchQ
                        ? `Results for “${searchQ}”`
                        : 'Search'}
              </div>
              {subTitle ? <div className="text-[10.5px] text-slate-500">{subTitle}</div> : null}
            </div>
            {tab !== 'artist' && tab !== 'liked' && (
              <TBtn
                title="Refresh"
                onClick={() => void (tab === 'search' && searchQ ? runSearch(searchQ) : loadHome())}
              >
                <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </TBtn>
            )}
          </div>

          {err ? (
            <div className="px-4">
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3 text-[11.5px] text-amber-100/85">
                {err}{' '}
                <button
                  onClick={() => void (tab === 'search' && searchQ ? runSearch(searchQ) : loadHome())}
                  className="font-bold underline-offset-2 hover:underline"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : loading && tab !== 'liked' ? (
            skeletons
          ) : tab === 'home' ? (
            homeStyle === 'metro'
              ? metroTiles(homeTracks, 'The Quick picks feed is quiet — hit refresh or search for anything.')
              : renderList(homeTracks, 'The Quick picks feed is quiet — hit refresh or search for anything.')
          ) : tab === 'liked' ? (
            renderList(likes.slice(0, likedLimit), 'Nothing liked yet — tap the heart on any track. Likes are saved forever on this OS.')
          ) : tab === 'artist' ? (
            artistLoading || !artistView ? (
              skeletons
            ) : (
              <>
                {/* artist banner */}
                <div className="relative mx-3 overflow-hidden rounded-2xl border border-white/10">
                  {artistView.artist.banner ? (
                    <img src={artistView.artist.banner} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-sm" />
                  ) : null}
                  <div className="relative flex items-center gap-3 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-3.5">
                    <div className="h-14 w-14 flex-none overflow-hidden rounded-full bg-white/10 ring-2 ring-white/20">
                      {artistView.songs[0]?.thumb || artistView.artist.banner ? (
                        <img src={artistView.songs[0]?.thumb || artistView.artist.banner} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-slate-400"><Music className="h-5 w-5" /></span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-base font-bold text-white">{artistView.artist.name}</span>
                        <VerifiedTag name={artistView.artist.name} className="!h-4 !w-4" />
                      </div>
                      <div className="truncate text-[10.5px] text-slate-300/80">
                        {isVerified(artistView.artist.name) ? 'Official Artist Channel · ' : ''}
                        {artistView.artist.audience || 'Artist'}
                      </div>
                    </div>
                    {artistView.songs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => playTrack(artistView.songs, 0)}
                        className="flex h-9 flex-none items-center gap-1.5 rounded-full bg-[#1DB954] px-4 text-[11px] font-bold text-black shadow-lg shadow-[#1DB954]/30 transition-transform hover:scale-105 active:scale-95"
                      >
                        <Play className="h-3.5 w-3.5" /> Play
                      </button>
                    )}
                  </div>
                  {artistView.artist.description ? (
                    <div className="relative border-t border-white/10 bg-black/30 px-3.5 py-2 text-[10.5px] leading-relaxed text-slate-300/80 line-clamp-2">
                      {artistView.artist.description}
                    </div>
                  ) : null}
                </div>
                {artistView.songs.length ? (
                  <div className="mt-2 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Top songs</div>
                ) : null}
                {renderList(artistView.songs, 'No songs found on the artist page.')}
              </>
            )
          ) : (
            <>
              {/* top result card */}
              {(topArtist || topSong) && (
                <div className="px-3 pb-2">
                  {topArtist ? (
                    <button
                      type="button"
                      onClick={() => void openArtist(topArtist)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-left transition-colors hover:bg-white/[0.08]"
                    >
                      <div className="h-14 w-14 flex-none overflow-hidden rounded-full bg-white/10 ring-2 ring-white/15">
                        {topArtist.thumb ? <img src={topArtist.thumb} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-slate-400"><Music className="h-5 w-5" /></span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Top result · Artist</div>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[14px] font-bold text-white">{topArtist.name}</span>
                          <VerifiedTag name={topArtist.name} className="!h-4 !w-4" />
                        </div>
                        <div className="truncate text-[10.5px] text-slate-500">
                          {isVerified(topArtist.name) ? 'Official Artist Channel · ' : ''}
                          {topArtist.audience || 'tap to open the artist page'}
                        </div>
                      </div>
                      <ChevronLeft className="h-4 w-4 flex-none rotate-180 text-slate-500" />
                    </button>
                  ) : topSong ? (
                    <div className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                      <div className="relative h-14 w-14 flex-none overflow-hidden rounded-xl bg-white/10">
                        {topSong.thumb ? <img src={topSong.thumb} alt="" className="h-full w-full object-cover" /> : null}
                        <button
                          type="button"
                          onClick={() => playTrack([topSong, ...(res?.songs || []).filter((s) => s.videoId !== topSong.videoId)], 0)}
                          className="absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-colors hover:bg-black/30"
                          aria-label={`Play ${topSong.title}`}
                        >
                          <Play className="h-5 w-5" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Top result · {topSong.kind === 'video' ? 'Video' : 'Song'}</div>
                        <div className="truncate text-[14px] font-bold text-white">{topSong.title}</div>
                        <div className="flex items-center gap-1 truncate text-[10.5px] text-slate-500">
                          {topSong.artist}
                          <VerifiedTag name={topSong.artist} />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* artists row */}
              {res && res.artists.length > 0 && (
                <div className="pb-1">
                  <div className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Artists</div>
                  <div className="flex gap-3 overflow-x-auto px-4 pb-2 os-scroll">
                    {res.artists.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => void openArtist(a)}
                        className="group flex w-[84px] flex-none flex-col items-center gap-1.5 text-center"
                      >
                        <span className="relative block h-16 w-16 overflow-hidden rounded-full bg-white/10 ring-2 ring-white/10 transition-all group-hover:ring-[#1DB954]/50">
                          {a.thumb ? <img src={a.thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full w-full items-center justify-center text-slate-400"><Music className="h-5 w-5" /></span>}
                          {isVerified(a.name) && (
                            <span className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 ring-1 ring-white/20">
                              <BadgeCheck className="h-3.5 w-3.5 text-sky-400" />
                            </span>
                          )}
                        </span>
                        <span className="w-full truncate text-[10.5px] font-semibold text-slate-200">{a.name}</span>
                        <span className="w-full truncate text-[9px] text-slate-500">{verified[a.name.toLowerCase()]?.subs || a.audience || ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* albums row */}
              {res && res.albums.length > 0 && (
                <div className="pb-1">
                  <div className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Albums & singles</div>
                  <div className="flex gap-2.5 overflow-x-auto px-4 pb-2 os-scroll">
                    {res.albums.map((al: YtmAlbum) => (
                      <button
                        key={al.id}
                        type="button"
                        onClick={() => doSearch(`${al.title} ${al.artist}`)}
                        className="w-[104px] flex-none rounded-xl bg-white/[0.04] p-2 text-left transition-colors hover:bg-white/[0.08]"
                      >
                        <div className="mb-1.5 h-[88px] w-full overflow-hidden rounded-lg bg-white/10">
                          {al.thumb ? <img src={al.thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                        </div>
                        <div className="truncate text-[10.5px] font-semibold text-slate-200">{al.title}</div>
                        <div className="truncate text-[9px] text-slate-500">{[al.artist, al.year].filter(Boolean).join(' · ')}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* songs */}
              {res && res.songs.length > 0 && (
                <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Songs · live</div>
              )}
              {renderList(res?.songs || [], searchQ ? `No songs found for “${searchQ}”.` : 'Type something to search every song — unlimited, ad-free.')}
            </>
          )}

          {/* UNLIMITED engine — sentinel + visible load-more. The IntersectionObserver
              streams the next radio page in near the bottom; the button backs it up. */}
          <div ref={sentinelRef} className="h-1" />
          {!loading && (tab === 'liked'
            ? likes.length > likedLimit
            : tab === 'home' ? !!homeSeed : tab === 'search' ? !!res?.seed : tab === 'artist' ? !!artistView?.seed : false) && (
            <div className="flex justify-center px-4 pb-6 pt-1">
              <button
                type="button"
                onClick={() => loadMoreRef.current()}
                className="flex items-center gap-2 rounded-full bg-white/[0.07] px-5 py-2 text-[11px] font-bold text-slate-200 transition-colors hover:bg-white/[0.13]"
              >
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                {tab === 'liked' ? 'Show more liked songs' : 'Load more — unlimited'}
              </button>
            </div>
          )}
        </div>

        {/* ------- player bar ------- */}
        <div className="flex-none border-t border-white/10 bg-[#181818]/95 backdrop-blur">
          <div className="px-3 pt-2">
            <div className="flex items-center gap-2">
              <span className="w-9 flex-none text-right font-mono text-[9.5px] tabular-nums text-slate-500">{fmtTime(cur)}</span>
              <div
                className="relative h-1.5 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/10"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  seek((e.clientX - rect.left) / rect.width)
                }}
                role="slider"
                aria-label="Seek"
                aria-valuenow={Math.round(cur)}
                aria-valuemin={0}
                aria-valuemax={Math.round(dur)}
              >
                <div className="h-full rounded-full bg-[#1DB954] transition-[width] duration-150" style={{ width: dur ? `${(cur / dur) * 100}%` : '0%' }} />
              </div>
              <span className="w-9 flex-none font-mono text-[9.5px] tabular-nums text-slate-500">{fmtTime(dur)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2.5 pt-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-none sm:basis-1/3">
              <div className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-white/10">
                {current?.thumb ? (
                  <img src={current.thumb} alt="" className={`h-full w-full object-cover ${playing ? 'animate-[spin_14s_linear_infinite] rounded-full' : ''}`} />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-slate-500"><Music className="h-4 w-4" /></span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11.5px] font-semibold text-slate-100">{current ? current.title : 'Nothing playing'}</div>
                <div className="flex items-center gap-1 truncate text-[10px] text-slate-500">
                  {current ? current.artist : 'pick a track — listen unlimited, ad-free'}
                  {current && <VerifiedTag name={current.artist} />}
                </div>
              </div>
            </div>
            <div className="flex flex-none items-center justify-center gap-1">
              <TBtn title="Shuffle" active={shuffle} onClick={() => setShuffle((s) => !s)}><Shuffle className="h-3.5 w-3.5" /></TBtn>
              <TBtn title="Previous" onClick={() => advance(-1)}><SkipBack className="h-4 w-4" /></TBtn>
              <button
                type="button"
                onClick={togglePlay}
                disabled={!current}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1DB954] text-black shadow-lg shadow-[#1DB954]/30 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {buffering && playing ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
              <TBtn title="Next" onClick={() => advance(1)}><SkipForward className="h-4 w-4" /></TBtn>
              <TBtn title="Repeat" active={repeat} onClick={() => setRepeat((r) => !r)}><Repeat className="h-3.5 w-3.5" /></TBtn>
            </div>
            <div className="hidden flex-none items-center gap-1.5 sm:flex sm:basis-1/3 sm:justify-end">
              <TBtn title="Video pane" active={showVideo} onClick={toggleVideoPane}><MonitorPlay className="h-3.5 w-3.5" /></TBtn>
              <button type="button" onClick={() => setMuted((m) => !m)} className="text-slate-400 hover:text-white" aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || vol === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={muted ? 0 : Math.round(vol * 100)}
                onChange={(e) => {
                  setVol(Number(e.target.value) / 100)
                  setMuted(false)
                }}
                className="h-1 w-24 cursor-pointer accent-[#1DB954]"
                aria-label="Volume"
              />
              {streamErr && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">SKIPPED</span>}
              {blocked && <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">TAP ▶ TO START</span>}
              {apiDead && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-300">PLAYER OFFLINE</span>}
            </div>
          </div>
        </div>
      </AppShell>
    </WifiGate>
  )
}
