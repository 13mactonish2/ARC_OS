// REDSEC v5.0 — Power dialogs: Run (Win+R), Clipboard history (Win+V), Emoji panel (Win+.), Volume mixer
'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X, Pin, PinOff, Clipboard as ClipIcon, Play, Trash2, Search, Sparkles, SlidersHorizontal, Volume2, VolumeX, Volume1, RotateCcw, Headphones } from 'lucide-react'
import { useOS, resolveRunTarget, APP_META } from '@/lib/os/store'
import { panelPx } from '@/lib/os/types'
import { osSound } from '@/lib/os/sound'
import { applyMixer, countControllableMedia } from '@/lib/os/mixer'
import { AppIcon } from './AppIcon'

/* ================================================================
   RUN DIALOG  (Win+R)
   Accepts: app names ("terminal", "notes"), aliases ("cmd", "notepad"),
   shell: verbs ("shell:apps"), URLs ("wikipedia.org"), "booster"
   ================================================================ */

function RunDialog() {
  const runOpen = useOS((s) => s.runOpen)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!runOpen) return
    queueMicrotask(() => {
      setQ('')
      setMsg(null)
      setTimeout(() => inputRef.current?.focus(), 30)
    })
  }, [runOpen])

  useEffect(() => {
    if (!runOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useOS.getState().set({ runOpen: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runOpen])

  if (!runOpen) return null

  const run = () => {
    const st = useOS.getState()
    const raw = q.trim()
    if (!raw) return
    const low = raw.toLowerCase().replace(/\s+/g, '')
    // shell: verbs
    if (low.startsWith('shell:')) {
      const verb = low.slice(6)
      if (verb === 'apps' || verb === 'start') {
        st.set({ runOpen: false, startOpen: true })
        return
      }
      if (verb === 'clipboard') {
        st.set({ runOpen: false, clipOpen: true })
        return
      }
      if (verb === 'emoji') {
        st.set({ runOpen: false, emojiOpen: true })
        return
      }
    }
    if (low === 'ms-settings:' || low === 'ms-settings') {
      st.set({ runOpen: false })
      st.openApp('settings')
      return
    }
    // alias or built-in / installed app by name
    const appId = resolveRunTarget(raw, st.installedApps)
    if (appId) {
      st.set({ runOpen: false })
      st.openApp(appId)
      return
    }
    // URL → browser
    if (/^https?:\/\//i.test(raw) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) {
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      st.set({ runOpen: false })
      st.openApp('browser', { url })
      return
    }
    setMsg({ ok: false, text: `Windows cannot find '${raw}'. Check the spelling and try again.` })
    osSound.error(useOS.getState().volume)
  }

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center" onMouseDown={(e) => e.target === e.currentTarget && useOS.getState().set({ runOpen: false })}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div className="relative w-[440px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-white/12 bg-[#161b29]/98 shadow-2xl shadow-black/80 backdrop-blur-xl animate-[popIn_0.15s_ease]">
        <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.03] px-4 py-3">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-sky-400" />
            <span className="text-sm font-semibold text-slate-100">Run</span>
          </div>
          <button onClick={() => useOS.getState().set({ runOpen: false })} className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-600 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Type the name of an app, folder, URL or shell command and REDSEC will open it for you.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Open:</span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setMsg(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="terminal · notepad · shell:apps · wikipedia.org"
              className="h-9 flex-1 rounded-lg border border-white/12 bg-black/35 px-3 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-400/60"
              spellCheck={false}
            />
          </div>
          {msg && !msg.ok && <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{msg.text}</div>}
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1.5">
              {['terminal', 'notepad', 'calc', 'shell:apps'].map((s) => (
                <button key={s} onClick={() => setQ(s)} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 transition-colors hover:bg-white/12 hover:text-slate-200">
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => useOS.getState().set({ runOpen: false })} className="h-8 rounded-lg border border-white/12 px-3.5 text-xs text-slate-300 transition-colors hover:bg-white/8">
                Cancel
              </button>
              <button onClick={run} disabled={!q.trim()} className="h-8 rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-40">
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   CLIPBOARD HISTORY  (Win+V)
   ================================================================ */
function ClipboardPanel() {
  const clipOpen = useOS((s) => s.clipOpen)
  const pb = useOS((s) => panelPx(s.taskbarTheme, s.panelSize, s.panelThickness)) + 8
  const items = useOS((s) => s.clipboardHistory)
  const [copied, setCopied] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => {
    const arr = [...items]
    arr.sort((a, b) => (a.pinned === b.pinned ? b.at - a.at : a.pinned ? -1 : 1))
    return arr
  }, [items])

  useEffect(() => {
    if (!clipOpen) return
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) useOS.getState().set({ clipOpen: false })
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useOS.getState().set({ clipOpen: false })
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [clipOpen])

  if (!clipOpen) return null

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard API may be blocked — still show feedback */
    }
    setCopied(id)
    osSound.tick(useOS.getState().volume)
    setTimeout(() => setCopied(null), 900)
  }

  return (
    <div ref={panelRef} className="fixed left-1/2 z-[10060] w-[420px] max-w-[calc(100vw-16px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/12 bg-[#161b29]/98 shadow-2xl shadow-black/80 backdrop-blur-xl animate-[slideUp_0.16s_ease]" style={{ bottom: pb }}>
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ClipIcon className="h-4 w-4 text-sky-400" />
          <span className="text-xs font-semibold text-slate-100">Clipboard history</span>
          <kbd className="rounded bg-white/8 px-1 py-px text-[9px] text-slate-400">Win+V</kbd>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => useOS.getState().clearClipboard()} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-slate-200">
            <Trash2 className="h-3 w-3" /> Clear
          </button>
          <button onClick={() => useOS.getState().set({ clipOpen: false })} className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-rose-600 hover:text-white">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="os-scroll max-h-[46vh] overflow-y-auto p-2">
        {sorted.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ClipIcon className="h-7 w-7 text-slate-600" />
            <div className="text-[11px] text-slate-500">Nothing here yet</div>
            <div className="text-[10px] text-slate-600">Copy text anywhere in REDSEC (Ctrl+C) and it will appear here. Copy from Notes, Terminal, Word…</div>
          </div>
        )}
        {sorted.map((c) => (
          <div key={c.id} className="group relative mb-1.5 rounded-xl border border-white/8 bg-white/[0.04] transition-colors hover:border-sky-400/30 hover:bg-white/[0.07]">
            <button onClick={() => copy(c.id, c.text)} className="block w-full px-3 py-2.5 pr-14 text-left">
              <div className="line-clamp-2 text-[11px] leading-snug text-slate-200">{c.text}</div>
              <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-600">
                {c.pinned && <span className="font-semibold text-amber-400">📌 Pinned</span>}
                <span>{new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {copied === c.id && <span className="font-semibold text-sky-400">✓ Copied</span>}
              </div>
            </button>
            <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button onClick={() => useOS.getState().togglePinClipboard(c.id)} title={c.pinned ? 'Unpin' : 'Pin'} className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/12 hover:text-amber-300">
                {c.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </button>
              <button onClick={() => useOS.getState().removeClipboard(c.id)} title="Remove" className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-rose-600/80 hover:text-white">
                <X className="h-3 w-3" />
              </button>
            </div>
            {c.pinned && <span className="absolute left-0 top-2.5 h-[calc(100%-20px)] w-[3px] rounded-r bg-amber-400/80" />}
          </div>
        ))}
      </div>
      <div className="border-t border-white/8 px-4 py-2 text-[10px] text-slate-600">Click an item to copy it back · Pin to keep it forever</div>
    </div>
  )
}

/* ================================================================
   EMOJI PANEL  (Win+.) — searchable, inserts into focused editable
   ================================================================ */
const EMOJI_GROUPS: { name: string; emojis: string[] }[] = [
  { name: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👋','🤚','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏'] },
  { name: 'Nature', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦂','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎍','🍃','🍂','🍁','🌾','🌺','🌻','🌹','🌷','🌼','🌸','💐','🍄','🌍','🌎','🌏','🌙','⭐','🌟','✨','⚡','🔥','🌈','☀️','⛅','☁️','🌧️','⛈️','🌨️','❄️','💧','🌊'] },
  { name: 'Food', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🧀','🥚','🍳','🧇','🥞','🧈','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍚','🍘','🍥','🥠','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧃','🥤','🍺','🍻','🥂','🍷','🥃','🍸','🍹'] },
  { name: 'Activity', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🥊','🥋','⛳','⛸️','🎣','🤿','🎽','🎿','🛷','🥌','🎯','🪁','🎮','🕹️','🎲','🧩','🎰','🎳','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','♟️','🎯','🎰','🧗','🏄','🏊','🤽','🚣','🧘'] },
  { name: 'Objects', emojis: ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','💽','💾','💿','📀','📷','📹','🎥','📞','☎️','📟','📠','📺','📻','🎙️','⏰','⌛','📡','🔋','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💰','🧾','💎','⚖️','🔧','🔨','⛏️','🔩','⚙️','🧲','🔫','💊','💉','🩹','🚪','🪑','🛏️','🚽','🚿','🧴','🧷','🧹','🧺','🧻','🧼','🪥','🔑','🗝️','🔒','🔓','📌','📎','📏','📐','✂️','🗃️','🗂️','📁','📂','📃','📄','📅','📅','📆','🗒️','📇','📈','📉','📊','📋','📌','📍','🖇️','🖊️','🖊️','🖌️','📝','✏️','🔍','🔎','🔏','🔐'] },
  { name: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔥','✨','🌟','💫','💥','💢','💨','🕳️','💬','💭','🗯️','♻️','⚠️','🚫','⛔','💯','✅','❌','❎','➕','➖','➗','✖️','♾️','‼️','⁉️','❓','❔','❗','〰️','🔗','💠','🔹','🔸','🔺','🔻','🔲','🔳','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🏆'] },
]

const POPULAR = ['😀','😘','😂','🥹','😎','🤩','😭','🤯','🔥','❤️','👍','🎉','✨','🍕','🎮','💚','🌟','😅','🥰','😇','🙂','😋','🤗','🤔','😴','🥳','😤','😢','😡','💀','🌈','☀️','🌙','⭐','☕','🍔','🎸','⚽','🏆','💡','📞','💻','🚗','✈️','🚀','🌍','🎁','🔔']

function EmojiPanel() {
  const emojiOpen = useOS((s) => s.emojiOpen)
  const pb = useOS((s) => panelPx(s.taskbarTheme, s.panelSize, s.panelThickness)) + 8
  const recents = useOS((s) => s.emojiRecents)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!emojiOpen) return
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) useOS.getState().set({ emojiOpen: false })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useOS.getState().set({ emojiOpen: false })
    }
    const t = setTimeout(() => {
      window.addEventListener('mousedown', close)
      inputRef.current?.focus()
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [emojiOpen])

  if (!emojiOpen) return null

  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string, caret: number) => {
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    desc?.set?.call(el, value)
    el.setSelectionRange(caret, caret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  }

  const pick = (e: string) => {
    const st = useOS.getState()
    // 1. insert into focused editable
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const next = el.value.slice(0, start) + e + el.value.slice(end)
      setNativeValue(el, next, start + e.length)
    }
    // 2. clipboard + recents
    try {
      navigator.clipboard.writeText(e).catch(() => {})
    } catch {}
    st.pushClipboard(e)
    if (!recents.includes(e)) st.set({ emojiRecents: [e, ...recents].slice(0, 12) })
    osSound.tick(st.volume)
  }

  const searching = q.trim().length > 0
  const shown = searching
    ? EMOJI_GROUPS.flatMap((g) => g.emojis).slice(0, 200) // broad grid when searching
    : EMOJI_GROUPS[group].emojis

  return (
    <div ref={panelRef} className="fixed right-[64px] z-[10060] w-[360px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-white/12 bg-[#161b29]/98 shadow-2xl shadow-black/80 backdrop-blur-xl animate-[slideUp_0.16s_ease]" style={{ bottom: pb }}>
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2.5">
        <Search className="h-3.5 w-3.5 text-slate-500" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search emoji…"
          className="h-7 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
        />
        <kbd className="rounded bg-white/8 px-1 py-px text-[9px] text-slate-400">Win+.</kbd>
        <button onClick={() => useOS.getState().set({ emojiOpen: false })} className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-rose-600 hover:text-white">
          <X className="h-3 w-3" />
        </button>
      </div>
      {recents.length > 0 && !searching && (
        <div className="border-b border-white/6 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            <Sparkles className="h-2.5 w-2.5" /> Recent
          </div>
          <div className="flex flex-wrap gap-0.5">
            {recents.map((e) => (
              <button key={e} onClick={() => pick(e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-white/8">
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
      {!searching && (
        <div className="flex gap-1 overflow-x-auto border-b border-white/6 px-2 py-1.5">
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.name}
              onClick={() => setGroup(i)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${i === group ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:bg-white/8 hover:text-slate-300'}`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
      <div className="os-scroll grid max-h-[260px] grid-cols-8 gap-0.5 overflow-y-auto p-2">
        {searching
          ? POPULAR.map((e) => (
              <button key={'s' + e} onClick={() => pick(e)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-white/8">
                {e}
              </button>
            ))
          : shown.map((e, i) => (
              <button key={e + i} onClick={() => pick(e)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-white/8">
                {e}
              </button>
            ))}
      </div>
      {searching && <div className="border-t border-white/6 px-3 py-1.5 text-[9px] text-slate-600">Showing popular emoji — click to insert &amp; copy</div>}
    </div>
  )
}

/* ================================================================
   VOLUME MIXER — master + per-app sliders (real audio routing via
   lib/os/mixer.ts; persists per app, works for same-origin content)
   ================================================================ */
function MixerPanel() {
  const mixerOpen = useOS((s) => s.mixerOpen)
  const pb = useOS((s) => panelPx(s.taskbarTheme, s.panelSize, s.panelThickness)) + 8
  const windows = useOS((s) => s.windows)
  const volume = useOS((s) => s.volume)
  const appVolumes = useOS((s) => s.appVolumes)
  const mixerSolo = useOS((s) => s.mixerSolo)
  const installedApps = useOS((s) => s.installedApps)
  const panelRef = useRef<HTMLDivElement>(null)
  const [liveMedia, setLiveMedia] = useState<Record<string, number>>({})

  /* running apps (grouped by appId, ordered by z) */
  const running = useMemo(() => {
    const seen = new Set<string>()
    const out: { appId: string; name: string }[] = []
    for (const w of [...windows].sort((a, b) => a.z - b.z)) {
      if (seen.has(w.appId)) continue
      seen.add(w.appId)
      const name = w.appId.startsWith('inst:')
        ? installedApps.find((a) => a.id === w.appId.slice(5))?.name || 'App'
        : APP_META[w.appId.split(':')[0]]?.name || w.appId
      out.push({ appId: w.appId, name: w.title || name })
    }
    return out
  }, [windows, installedApps])

  /* apps with a custom (non-default) volume that are not running — persisted leftovers */
  const dormant = useMemo(
    () =>
      Object.entries(appVolumes)
        .filter(([id, v]) => v !== 100 && !running.some((r) => r.appId === id))
        .map(([id, v]) => ({
          appId: id,
          vol: v,
          name: id.startsWith('inst:')
            ? installedApps.find((a) => a.id === id.slice(5))?.name || 'App'
            : APP_META[id.split(':')[0]]?.name || id,
        })),
    [appVolumes, running, installedApps]
  )

  /* which apps currently expose controllable media (refresh while open) */
  useEffect(() => {
    if (!mixerOpen) return
    const scan = () => {
      const next: Record<string, number> = {}
      for (const w of useOS.getState().windows) {
        next[w.appId] = (next[w.appId] || 0) + countControllableMedia(w.id)
      }
      setLiveMedia(next)
    }
    scan()
    const t = setInterval(scan, 1600)
    return () => clearInterval(t)
  }, [mixerOpen, windows])

  useEffect(() => {
    if (!mixerOpen) return
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) useOS.getState().set({ mixerOpen: false })
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useOS.getState().set({ mixerOpen: false })
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [mixerOpen])

  if (!mixerOpen) return null

  const setVol = (appId: string, v: number) => {
    useOS.getState().setAppVolume(appId, v)
    applyMixer()
  }
  const toggleSolo = (appId: string) => {
    const cur = useOS.getState().mixerSolo
    useOS.getState().set({ mixerSolo: cur === appId ? null : appId })
    osSound.tick()
    applyMixer()
  }
  const soloName = mixerSolo
    ? (running.find((r) => r.appId === mixerSolo)?.name ||
       (mixerSolo.startsWith('inst:') ? installedApps.find((a) => a.id === mixerSolo.slice(5))?.name : null) ||
       APP_META[mixerSolo.split(':')[0]]?.name ||
       mixerSolo)
    : null
  const MasterIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2

  return (
    <div ref={panelRef} className="fixed right-[64px] z-[10060] w-[380px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-white/12 bg-[#161b29]/98 shadow-2xl shadow-black/80 backdrop-blur-xl animate-[slideUp_0.16s_ease]" style={{ bottom: pb }}>
      <div className="flex items-center justify-between border-b border-white/8 bg-gradient-to-r from-sky-500/10 to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-sky-400" />
          <span className="text-xs font-semibold text-slate-100">Volume mixer</span>
        </div>
        <button onClick={() => useOS.getState().set({ mixerOpen: false })} className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-rose-600 hover:text-white">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="os-scroll max-h-[52vh] overflow-y-auto p-3">
        {/* master */}
        <div className="mb-2 rounded-xl border border-sky-400/25 bg-gradient-to-r from-sky-500/15 via-sky-500/5 to-transparent p-3">
          <div className="mb-2 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/20 ring-1 ring-sky-400/40">
              <MasterIcon className="h-4.5 w-4.5 text-sky-300" />
            </span>
            <div className="flex-1">
              <div className="text-xs font-semibold text-slate-100">Master</div>
              <div className="text-[10px] text-slate-500">System-wide output level</div>
            </div>
            <span className="w-10 text-right text-xs font-bold tabular-nums text-sky-300">{volume}%</span>
          </div>
          {mixerSolo && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-300/25 bg-amber-400/10 px-2 py-1">
              <Headphones className="h-3 w-3 flex-none text-amber-300" />
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-amber-200">Solo: {soloName} — all other apps muted</span>
              <button
                onClick={() => {
                  useOS.getState().set({ mixerSolo: null })
                  applyMixer()
                }}
                title="End solo"
                className="flex h-4 w-4 flex-none items-center justify-center rounded text-amber-300/80 hover:bg-amber-400/25 hover:text-amber-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => useOS.getState().set({ volume: parseInt(e.target.value) })}
            className="os-slider w-full"
            aria-label="Master volume"
          />
        </div>
        {/* running apps */}
        {running.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[11px] text-slate-500">
            No apps running — open something and its volume will appear here
          </div>
        )}
        {running.map((r) => {
          const v = appVolumes[r.appId] ?? 100
          const media = liveMedia[r.appId] || 0
          const isSolo = mixerSolo === r.appId
          const mutedBySolo = !!mixerSolo && !isSolo
          return (
            <div key={r.appId} className={`mb-1.5 rounded-xl border px-3 py-2.5 transition-colors ${isSolo ? 'border-amber-300/40 bg-amber-400/10 ring-1 ring-amber-300/25' : mutedBySolo ? 'border-white/8 bg-white/[0.02] opacity-70' : v === 0 ? 'border-rose-400/25 bg-rose-500/8' : 'border-white/8 bg-white/[0.04]'}`}>
              <div className="mb-1.5 flex items-center gap-2.5">
                <AppIcon appId={r.appId} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium text-slate-200">{r.name}</div>
                  <div className="text-[9.5px] text-slate-500">
                    {isSolo ? '🔊 solo — everything else muted' : mutedBySolo ? 'muted by solo' : media > 0 ? `${media} media channel${media > 1 ? 's' : ''} · live` : 'app level'}
                  </div>
                </div>
                <button
                  onClick={() => toggleSolo(r.appId)}
                  title={isSolo ? 'End solo' : 'Solo — hear only this app'}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${isSolo ? 'bg-amber-400/25 text-amber-300 hover:bg-amber-400/40' : 'bg-white/6 text-slate-400 hover:bg-white/12 hover:text-amber-200'}`}
                >
                  <Headphones className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setVol(r.appId, v === 0 ? 100 : 0)}
                  title={v === 0 ? 'Unmute' : 'Mute'}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${v === 0 ? 'bg-rose-500/25 text-rose-300 hover:bg-rose-500/40' : 'bg-white/6 text-slate-400 hover:bg-white/12 hover:text-slate-200'}`}
                >
                  {v === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
                <span className={`w-9 text-right text-[11px] font-semibold tabular-nums ${v === 0 && !mutedBySolo ? 'text-rose-300' : isSolo ? 'text-amber-200' : 'text-slate-400'}`}>{v}%</span>
              </div>
              <input type="range" min={0} max={100} value={v} onChange={(e) => setVol(r.appId, parseInt(e.target.value))} className={`os-slider w-full ${v === 0 || mutedBySolo ? 'opacity-60' : ''}`} aria-label={`${r.name} volume`} />
            </div>
          )
        })}
        {/* persisted custom levels for closed apps */}
        {dormant.length > 0 && (
          <div className="mt-2 border-t border-white/6 pt-2">
            <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wider text-slate-600">Saved levels — not running</div>
            {dormant.map((d) => (
              <div key={d.appId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/4">
                <AppIcon appId={d.appId} size={18} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{d.name}</span>
                <span className="text-[10px] tabular-nums text-slate-500">{d.vol}%</span>
                <button
                  onClick={() => setVol(d.appId, 100)}
                  title="Reset to 100%"
                  className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/10 hover:text-sky-300"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-white/8 px-4 py-2 text-[10px] text-slate-600">Levels are saved per app · 🎧 solo mutes every other app · same-origin content is routed live; external sites manage their own audio</div>
    </div>
  )

}

export function PowerDialogs() {
  return (
    <>
      <RunDialog />
      <ClipboardPanel />
      <EmojiPanel />
      <MixerPanel />
    </>
  )
}
