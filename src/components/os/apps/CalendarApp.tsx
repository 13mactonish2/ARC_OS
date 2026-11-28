// REDSEC 5.0 — Calendar (month view, persisted events, agenda)
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, Trash2 } from 'lucide-react'
import { AppShell, Toolbar, TBtn, EmptyState } from './_shared'
import { useOS } from '@/lib/os/store'
import type { AppProps } from '@/lib/os/types'

/** persisted at localStorage "redsec5.cal.events" — JSON array of CalEvent */
const EVENTS_KEY = 'redsec5.cal.events'

const EVENT_COLORS = {
  rose: { dot: 'bg-rose-400', text: 'text-rose-300', hex: '#fb7185' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-300', hex: '#fbbf24' },
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', hex: '#34d399' },
  sky: { dot: 'bg-sky-400', text: 'text-sky-300', hex: '#38bdf8' },
} as const
type EventColor = keyof typeof EVENT_COLORS

interface CalEvent {
  id: string
  date: string // 'YYYY-MM-DD'
  title: string
  time: string // 'HH:MM'
  color: EventColor
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseKey = (s: string) => new Date(`${s}T00:00:00`)
const parseDT = (e: CalEvent) => new Date(`${e.date}T${e.time}:00`)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isCalEvent(v: unknown): v is CalEvent {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.date === 'string' && DATE_RE.test(e.date) &&
    typeof e.title === 'string' && e.title.length > 0 &&
    typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time) &&
    (e.color === 'rose' || e.color === 'amber' || e.color === 'emerald' || e.color === 'sky')
  )
}

function loadEvents(): CalEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(isCalEvent)
  } catch {
    return []
  }
}

export default function CalendarApp({ winId, args }: AppProps) {
  const argDate = typeof args?.date === 'string' && DATE_RE.test(args.date) ? args.date : null

  const [view, setView] = useState<Date>(() => (argDate ? parseKey(argDate) : new Date()))
  const [selected, setSelected] = useState<string>(() => argDate ?? keyOf(new Date()))
  const [events, setEvents] = useState<CalEvent[]>([])
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('09:00')
  const [color, setColor] = useState<EventColor>('rose')
  const loaded = useRef(false)

  /* re-sync when this window gains focus → edits from another Calendar window show up */
  const focusedWin = useOS((s) => s.focusedWin)
  useEffect(() => {
    if (focusedWin === winId) setEvents(loadEvents())
  }, [focusedWin, winId])

  /* initial load */
  useEffect(() => {
    setEvents(loadEvents())
    loaded.current = true
  }, [])

  /* persist */
  useEffect(() => {
    if (!loaded.current) return
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(events))
    } catch {
      /* storage unavailable */
    }
  }, [events])

  /* month cells (6 weeks, always) */
  const cells = useMemo(() => {
    const y = view.getFullYear()
    const m = view.getMonth()
    const first = new Date(y, m, 1)
    const start = new Date(y, m, 1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [view])

  const byDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {}
    for (const e of events) {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    }
    return map
  }, [events])

  const todayKey = keyOf(new Date())
  const dayEvents = (byDate[selected] || []).slice().sort((a, b) => a.time.localeCompare(b.time))

  /* next 5 future events across all dates */
  const upcoming = useMemo(() => {
    const now = Date.now()
    return events
      .map((e) => ({ e, at: parseDT(e).getTime() }))
      .filter((x) => Number.isFinite(x.at) && x.at >= now)
      .sort((a, b) => a.at - b.at)
      .slice(0, 5)
  }, [events])

  const shiftMonth = (delta: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1))
  const goToday = () => {
    const now = new Date()
    setView(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelected(keyOf(now))
  }

  const addEvent = () => {
    const t = title.trim()
    if (!t) return
    const ev: CalEvent = {
      id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      date: selected,
      title: t,
      time,
      color,
    }
    setEvents((prev) => [...prev, ev])
    setTitle('')
    useOS.getState().notify({
      title: 'Event added',
      body: `${t} — ${parseKey(selected).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`,
      kind: 'success',
      emoji: '📅',
    })
  }

  const delEvent = (id: string) => setEvents((prev) => prev.filter((e) => e.id !== id))

  return (
    <AppShell>
      <Toolbar className="flex-wrap">
        <TBtn onClick={() => shiftMonth(-1)} title="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </TBtn>
        <div className="min-w-[150px] text-center text-sm font-semibold text-slate-100">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </div>
        <TBtn onClick={() => shiftMonth(1)} title="Next month">
          <ChevronRight className="h-4 w-4" />
        </TBtn>
        <TBtn onClick={goToday} title="Jump to today" className="ml-1">
          Today
        </TBtn>
        <span className="ml-auto rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-rose-300">
          REDSEC Calendar 5.0
        </span>
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        {/* ---- month grid ---- */}
        <div className="flex min-w-0 flex-1 flex-col p-2">
          <div className="grid grid-cols-7 pb-1">
            {DOWS.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {d}
              </div>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5">
            {cells.map((d) => {
              const k = keyOf(d)
              const evs = byDate[k] || []
              const other = d.getMonth() !== view.getMonth()
              const isToday = k === todayKey
              const isSel = k === selected
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelected(k)}
                  title={evs.length ? `${evs.length} event(s)` : undefined}
                  className={`flex flex-col items-start p-1.5 text-left transition-colors ${
                    other ? 'bg-[#0d1119] hover:bg-[#12161f]' : 'bg-[#131826] hover:bg-[#1b2234]'
                  } ${isSel ? '!bg-rose-500/15' : ''} ${isToday ? 'shadow-[inset_0_0_0_1.5px_#fb7185]' : ''}`}
                >
                  <span className={`text-[11px] font-semibold ${isToday ? 'text-rose-300' : other ? 'text-slate-600' : 'text-slate-300'}`}>
                    {d.getDate()}
                  </span>
                  <span className="mt-auto flex gap-0.5 pt-1">
                    {evs.slice(0, 3).map((e) => (
                      <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS[e.color].dot}`} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ---- agenda panel ---- */}
        <div className="flex w-[272px] flex-none flex-col border-l border-white/10 bg-[#121724]">
          <div className="border-b border-white/10 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
              <CalendarDays className="h-3.5 w-3.5 flex-none text-rose-400" />
              {parseKey(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {dayEvents.length} event{dayEvents.length === 1 ? '' : 's'} · {upcoming.length} upcoming
            </div>
          </div>

          {/* add-event form */}
          <div className="border-b border-white/10 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Add event</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addEvent()
              }}
              placeholder="Event title"
              aria-label="Event title"
              className="mt-1.5 h-7 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-rose-500/50"
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 flex-none text-slate-500" />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-label="Event time"
                className="h-7 w-[96px] rounded-md border border-white/10 bg-black/30 px-1.5 text-xs text-slate-200 outline-none [color-scheme:dark] focus:border-rose-500/50"
              />
              <div className="ml-auto flex items-center gap-1">
                {(Object.keys(EVENT_COLORS) as EventColor[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={`${c} event`}
                    aria-label={`${c} color`}
                    onClick={() => setColor(c)}
                    className={`h-4 w-4 rounded-full ${EVENT_COLORS[c].dot} transition-transform ${
                      color === c ? 'scale-125 ring-2 ring-white/70' : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={addEvent}
              disabled={!title.trim()}
              className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded-md bg-rose-600/80 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Add event
            </button>
          </div>

          {/* agenda list */}
          <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {dayEvents.length === 0 ? (
              <EmptyState icon="📅" title="No events" sub="Nothing planned for this day yet — add one with the form above." />
            ) : (
              dayEvents.map((e) => (
                <div
                  key={e.id}
                  className="group mb-1 flex items-center gap-2 rounded-lg border-l-2 bg-white/[0.04] px-2 py-1.5 hover:bg-white/[0.08]"
                  style={{ borderLeftColor: EVENT_COLORS[e.color].hex }}
                >
                  <span className="w-9 flex-none font-mono text-[10px] text-slate-400">{e.time}</span>
                  <span className={`min-w-0 flex-1 truncate text-xs font-medium ${EVENT_COLORS[e.color].text}`}>{e.title}</span>
                  <button
                    type="button"
                    onClick={() => delEvent(e.id)}
                    aria-label={`Delete ${e.title}`}
                    className="rounded p-1 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ---- upcoming strip ---- */}
      <div className="flex flex-none items-center gap-2 border-t border-white/10 bg-[#0e1320] px-3 py-2">
        <span className="flex-none text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">Upcoming</span>
        <div className="os-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {upcoming.length === 0 ? (
            <span className="text-[11px] text-slate-600">No upcoming events — add one from the agenda panel</span>
          ) : (
            upcoming.map(({ e }) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  const d = parseKey(e.date)
                  setView(new Date(d.getFullYear(), d.getMonth(), 1))
                  setSelected(e.date)
                }}
                className="flex flex-none items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] transition-colors hover:border-rose-500/40 hover:bg-white/10"
                title="Jump to this date"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS[e.color].dot}`} />
                <span className="max-w-[130px] truncate text-slate-200">{e.title}</span>
                <span className="text-slate-500">
                  {parseKey(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {e.time}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </AppShell>
  )
}
