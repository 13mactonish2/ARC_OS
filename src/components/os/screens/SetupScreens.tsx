// REDSEC v5.0 (REDSEC native base) — Welcome screen (extensions) + Setup wizard + Ads welcome + RedSecDM login
'use client'

import React, { useState } from 'react'
import { ShieldMark } from '../ShieldMark'
import { useOS, osNow } from '@/lib/os/store'
import { useWallpaperUrl } from '../useWallpaper'
import { useClock } from '../apps/_shared'
import { REDSEC } from '@/lib/os/redsec'
import { RECOMMENDED_EXTENSIONS, detectBrowserId } from '@/lib/os/extensions'
import { CustomExtCards, ExtUploadForm, useCustomExtLinks } from '../ExtensionLinks'
import { ProfileAvatar } from '../ProfileAvatar'
import { UnlockMethods } from '../LockMethods'
import {
  ArrowRight, ArrowLeft, User, Lock, Globe2,
  Check, Sparkles, Camera, Keyboard, Eye, EyeOff, Power, Wifi, WifiOff, BatteryFull, Puzzle,
} from 'lucide-react'

const CONTINENTS = [
  { id: 'asia', name: 'Asia', emoji: '🌏' },
  { id: 'africa', name: 'Africa', emoji: '🌍' },
  { id: 'north-america', name: 'North America', emoji: '🌎' },
  { id: 'south-america', name: 'South America', emoji: '🌎' },
  { id: 'antarctica', name: 'Antarctica', emoji: '🧊' },
  { id: 'europe', name: 'Europe', emoji: '🌍' },
  { id: 'australia', name: 'Australia / Oceania', emoji: '🏝️' },
]

const AD_POINTS = [
  { icon: Sparkles, text: 'The new local desktop made on HTML, CSS, JS, JSON, TSX, SQL, Java, Py' },
  { icon: Camera, text: 'Press P for screenshot • Press V for screen record (with mic & sound)' },
  { icon: Keyboard, text: 'Press K for on-screen keyboard • Press M for voice command' },
  { icon: Check, text: 'All app features — no bloatwares, built-in apps & powerful tools' },
  { icon: Check, text: 'App Store: upload any HTML-based app or game — merged, one file, runs instantly' },
  { icon: Check, text: 'Free, full privacy, fully open source, built for developers, fully independent OS' },
]

/* ---------------- Welcome (extensions) ---------------- */
export function WelcomeScreen() {
  const setPhase = useOS((s) => s.setPhase)
  const notify = useOS((s) => s.notify)
  const [tab, setTab] = useState(detectBrowserId())
  const group = RECOMMENDED_EXTENSIONS.find((g) => g.id === tab) || RECOMMENDED_EXTENSIONS[0]
  const { add, remove, forBrowser } = useCustomExtLinks()
  const [uploadOpen, setUploadOpen] = useState(false)
  const customRows = forBrowser(tab as 'chrome' | 'firefox' | 'edge')
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center overflow-auto bg-gradient-to-b from-[#0a1120] via-[#0b1224] to-[#05070c] p-6 text-slate-200 select-none">
      <ShieldMark size={72} />
      <h1 className="mt-4 text-2xl font-bold">Welcome to {REDSEC.distro} {REDSEC.version} — {REDSEC.codename}</h1>
      <p className="mt-1 text-xs font-medium uppercase tracking-widest text-rose-400">REDSEC Native base · free &amp; open source</p>
      <p className="mt-2 max-w-lg text-center text-sm text-slate-400">
        A fully secured open-source desktop OS with pre-built anti-virus. Before we begin, install the recommended
        extensions for your browser so every embedded app runs without frame errors.
      </p>
      <div className="mt-6 flex gap-2">
        {RECOMMENDED_EXTENSIONS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setTab(g.id)}
            className={`flex h-9 items-center gap-2 rounded-lg border px-4 text-xs font-semibold transition-colors ${
              tab === g.id ? 'border-sky-400/40 bg-sky-500/15 text-sky-300' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
            {g.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex w-full max-w-2xl flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setUploadOpen((v) => !v)}
          className={`flex h-9 items-center gap-2 rounded-lg border px-4 text-xs font-semibold transition-colors ${
            uploadOpen ? 'border-sky-400/40 bg-sky-500/15 text-sky-300' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          <span className="text-sm leading-none">＋</span> Upload extension link
        </button>
        <span className="text-[10.5px] text-slate-500">saved forever — survives factory reset · shared with every OS user</span>
      </div>
      <div className="w-full max-w-2xl">
        <ExtUploadForm
          open={uploadOpen}
          defaultBrowser={tab as 'chrome' | 'firefox' | 'edge'}
          add={(i) => add(i)}
          onClose={() => setUploadOpen(false)}
          onSaved={(n) => notify({ title: 'Extension link saved forever', body: `“${n}” is now visible to every OS user and survives a factory reset.`, kind: 'success', emoji: '🧩' })}
        />
      </div>
      <div className="mt-4 grid w-full max-w-2xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {group.items.map((ext) => {
          const unavailable = !ext.url
          return (
            <a
              key={ext.name}
              href={ext.url || undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={unavailable}
              onClick={(e) => {
                if (unavailable) e.preventDefault()
              }}
              className={`group rounded-2xl border border-white/10 bg-white/5 p-5 transition-all ${
                unavailable ? 'opacity-60' : 'hover:-translate-y-0.5 hover:border-sky-400/40 hover:bg-white/8'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `${ext.color}22`, color: ext.color }}>
                    <Puzzle className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{ext.name}</div>
                    <div className="text-[11px] text-slate-500">{group.name}</div>
                  </div>
                </div>
                {unavailable && <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-bold text-slate-400">N/A</span>}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">{ext.desc}</p>
              {!unavailable && <div className="mt-3 text-[11px] font-medium text-sky-400 group-hover:underline">Install extension →</div>}
            </a>
          )
        })}
        <CustomExtCards
          rows={customRows}
          showRemove
          onRemove={(id) => {
            void remove(id)
            notify({ title: 'Extension link removed', body: 'The uploaded link was deleted for every OS user.', kind: 'info', emoji: '🧩' })
          }}
        />
      </div>
      <button
        onClick={() => setPhase('setup')}
        className="mt-9 flex items-center gap-2 rounded-xl bg-sky-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/40 transition-all hover:bg-sky-500"
      >
        Next <ArrowRight className="h-4 w-4" />
      </button>
      <div className="mt-4 text-[11px] text-slate-600">Tip: pick your browser tab above — links open the official store.</div>
    </div>
  )
}

/* ---------------- Setup wizard ---------------- */

export function SetupWizard() {
  const { completeSetup, notify } = useOS()
  const setPhase = useOS((s) => s.setPhase)
  const [step, setStep] = useState(0)
  const [continent, setContinent] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const STEPS = 3

  const next = () => {
    setErr('')
    if (step === 0 && !continent) return setErr('Please select your continent.')
    if (step === 1 && username.trim().length < 2) return setErr('Enter a username (2+ characters). It is saved forever.')
    if (step === 2 && password && password.length < 3) return setErr('Password must be 3+ characters, or skip it.')
    setStep((s) => s + 1)
  }

  const finish = () => {
    completeSetup({ username: username.trim(), password: password || null, continent })
    notify({ title: `Welcome, ${username.trim()}!`, body: 'Setup complete — your desktop is ready.', kind: 'success' })
    setPhase('ossetup')
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-auto bg-gradient-to-b from-[#0a1120] to-[#05070c] p-4 text-slate-200 select-none">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/4 p-8 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <ShieldMark size={40} glow={false} />
          <div>
            <div className="text-lg font-bold">{REDSEC.distro} {REDSEC.version} Setup</div>
            <div className="text-[11px] text-slate-500">Secure Edition · REDSEC native base · Step {step + 1} of {STEPS}</div>
          </div>
        </div>
        <div className="mt-4 flex gap-1.5">
          {Array.from({ length: STEPS }, (_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-sky-400' : 'bg-white/10'}`} />
          ))}
        </div>

        {step === 0 && (
          <div className="mt-7">
            <div className="flex items-center gap-2 text-sm font-semibold"><Globe2 className="h-4 w-4 text-sky-400" /> Which continent are you from?</div>
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {CONTINENTS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setContinent(c.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-xs font-medium transition-all ${
                    continent === c.id ? 'border-sky-400 bg-sky-400/10 text-sky-200' : 'border-white/10 bg-white/4 text-slate-300 hover:bg-white/8'
                  }`}
                >
                  <span className="text-2xl">{c.emoji}</span>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-7">
            <div className="flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4 text-sky-400" /> Choose your username</div>
            <p className="mt-1.5 text-xs text-slate-500">It will be saved for all time on this OS.</p>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && next()}
              placeholder="e.g. redsec_user"
              className="mt-4 w-full rounded-xl border border-white/12 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400"
            />
          </div>
        )}

        {step === 2 && (
          <div className="mt-7">
            <div className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-sky-400" /> Create a password</div>
            <p className="mt-1.5 text-xs text-slate-500">Optional — you can skip. No password needed, the OS runs smoothly. If you set one, you&apos;ll unlock the OS with it.</p>
            <div className="relative mt-4">
              <input
                autoFocus
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && next()}
                placeholder="Type a password (or leave empty)"
                className="w-full rounded-xl border border-white/12 bg-black/30 px-4 py-3 pr-11 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400"
              />
              <button onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Toggle password visibility">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              That&apos;s everything — after this step the OS is configured and your desktop is built. Add a PIN or a draw
              pattern (Settings&nbsp;▸&nbsp;Security) to unlock with them too. Pair a phone later from the Mobile&nbsp;Link
              app, and pick a bigger storage plan any time in Settings&nbsp;▸&nbsp;Storage (all plans are free).
            </p>
          </div>
        )}

        {err && <div className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>}

        <div className="mt-7 flex justify-between">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-0">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < STEPS - 1 ? (
            <button onClick={next} className="flex items-center gap-2 rounded-xl bg-sky-600 px-7 py-2.5 text-sm font-semibold hover:bg-sky-500">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={finish} className="flex items-center gap-2 rounded-xl bg-sky-600 px-7 py-2.5 text-sm font-semibold hover:bg-sky-500">
              <Check className="h-4 w-4" /> Finish setup
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Ads welcome (after 30s OS setup) ---------------- */
export function AdsWelcomeScreen() {
  const setPhase = useOS((s) => s.setPhase)
  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-auto bg-gradient-to-br from-[#071018] via-[#0a1626] to-[#05070c] p-4 text-slate-200 select-none">
      <div className="w-full max-w-2xl rounded-3xl border border-sky-400/20 bg-black/40 p-8 shadow-[0_0_80px_rgba(14,165,233,0.12)] backdrop-blur">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-sky-400">
          <Sparkles className="h-3.5 w-3.5" /> Welcome on Window Screen
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-snug">
          The new <span className="text-sky-300">local desktop</span> — made on HTML, CSS, JS, JSON, TSX, SQL, Java, Py
        </h1>
        <div className="mt-6 grid gap-2.5">
          {AD_POINTS.map((p, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/4 px-4 py-2.5">
              <p.icon className="mt-0.5 h-4 w-4 flex-none text-sky-400" />
              <span className="text-xs leading-relaxed text-slate-300">{p.text}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-xl border border-white/10 bg-white/4 p-4 text-center text-xs text-slate-400">
          All your files, apps and settings are saved forever — even after shutdown or restart.
          <div className="mt-1.5 font-mono text-[11px] text-sky-400/90">{REDSEC.distro} {REDSEC.version} · {REDSEC.kernel} · REDSEC Native kernel {REDSEC.qnxVersion}</div>
        </div>
        <button
          onClick={() => setPhase('desktop')}
          className="mt-6 w-full rounded-xl bg-sky-600 py-3.5 text-sm font-bold tracking-wide hover:bg-sky-500"
        >
          DONE
        </button>
      </div>
    </div>
  )
}

/* ---------------- Login ---------------- */
export function LoginScreen() {
  const { username, login, shutdown, wifi, autoTime, manualClock } = useOS()
  const wallpaper = useWallpaperUrl()
  useClock(1000)
  const d = osNow(autoTime, manualClock)

  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#0a1120] to-[#05070c] text-slate-200 select-none">
      {/* blurred wallpaper backdrop */}
      {wallpaper && (
        <>
          <div className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-45 blur-2xl" style={{ backgroundImage: `url(${wallpaper})` }} />
          <div className="pointer-events-none absolute inset-0 bg-black/35" />
        </>
      )}

      {/* top clock */}
      <div className="absolute top-10 flex flex-col items-center">
        <div className="text-5xl font-bold tabular-nums tracking-tight text-white/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
          {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="mt-1 text-sm text-white/70">
          {d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center rounded-3xl border border-white/12 bg-black/30 px-12 py-9 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <ShieldMark size={44} />
        <div className="mt-5">
          <ProfileAvatar size={80} />
        </div>
        <div className="mt-3 text-lg font-semibold">{username}</div>
        <div className="mt-5 flex min-h-44 flex-col items-center justify-center gap-3">
          <UnlockMethods onSuccess={login} noAuthLabel="Sign in" />
        </div>
      </div>

      {/* GDM3-style bottom status strip */}
      <div className="absolute bottom-6 left-6 z-10 flex items-center gap-3 text-xs text-white/70">
        <span className="flex items-center gap-1.5 rounded-full border border-white/12 bg-black/35 px-3 py-1.5 backdrop-blur">
          {wifi ? <Wifi className="h-3.5 w-3.5 text-sky-300" /> : <WifiOff className="h-3.5 w-3.5" />}
          {wifi ? 'Connected' : 'Offline'}
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-white/12 bg-black/35 px-3 py-1.5 backdrop-blur">
          <BatteryFull className="h-3.5 w-3.5 text-sky-300" /> 87%
        </span>
        <span className="hidden items-center gap-1.5 rounded-full border border-white/12 bg-black/35 px-3 py-1.5 font-mono text-[11px] backdrop-blur sm:flex">
          {REDSEC.hostname} · {REDSEC.distro} {REDSEC.version} · REDSEC Native kernel {REDSEC.qnxVersion}
        </span>
      </div>
      <button onClick={shutdown} title="Shut down" className="absolute bottom-6 right-6 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/35 text-slate-300 backdrop-blur hover:bg-rose-600/25 hover:text-rose-300">
        <Power className="h-5 w-5" />
      </button>
    </div>
  )
}
