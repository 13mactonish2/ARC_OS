// REDSEC v5.0 — Camera app (getUserMedia preview, capture, timer, camera switch)
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, RefreshCw, SwitchCamera, Timer, X, Loader2 } from 'lucide-react'
import { useOS } from '@/lib/os/store'
import { fs, fsLoad } from '@/lib/os/fs'
import type { FSNode } from '@/lib/os/types'
import { AppShell, Toolbar, TBtn, useNodeUrl } from './_shared'

type Facing = 'environment' | 'user'
type Status = 'starting' | 'ready' | 'error'

function stampName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

/** one captured-shot thumbnail (blob node) */
function ShotThumb({ node }: { node: FSNode }) {
  const url = useNodeUrl(node.id)
  return (
    <div className="relative h-14 w-20 flex-none overflow-hidden rounded-lg border border-white/15 bg-black/40">
      {url ? (
        <img src={url} alt={node.name} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-600">
          <Camera className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}

export default function CameraApp(_props: { winId: string; args?: Record<string, unknown> }) {
  const notify = useOS((s) => s.notify)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [facing, setFacing] = useState<Facing>('environment')
  const [retryTick, setRetryTick] = useState(0)
  const [status, setStatus] = useState<Status>('starting')
  const [errMsg, setErrMsg] = useState('')
  const [deviceCount, setDeviceCount] = useState(0)
  const [timerOn, setTimerOn] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [shots, setShots] = useState<FSNode[]>([])

  const refreshShots = useCallback(() => {
    fsLoad()
      .then(() => {
        const list = fs
          .children('photos')
          .filter((n) => n.kind === 'file' && n.meta?.kind === 'photo' && !n.url)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 12)
        setShots(list)
      })
      .catch(() => {})
  }, [])

  /* start / restart camera */
  useEffect(() => {
    let dead = false
    let stream: MediaStream | null = null
    const start = async () => {
      // yield so this effect body stays free of synchronous setState
      await Promise.resolve()
      if (dead) return
      setStatus('starting')
      setErrMsg('')
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API is not available in this browser.')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing === 'user' ? 'user' : { ideal: 'environment' } },
          audio: false,
        })
        if (dead) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
        setStatus('ready')
        navigator.mediaDevices
          .enumerateDevices()
          .then((ds) => {
            if (!dead) setDeviceCount(ds.filter((d) => d.kind === 'videoinput').length)
          })
          .catch(() => {})
      } catch (err) {
        if (dead) return
        const msg = err instanceof Error ? err.message : 'Unknown camera error'
        setErrMsg(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access and retry.' : msg)
        setStatus('error')
      }
    }
    void start()
    return () => {
      dead = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing, retryTick])

  /* load recent shots */
  useEffect(() => {
    refreshShots()
  }, [refreshShots])

  /* countdown → capture */
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(0)
        void captureNow()
      } else {
        setCountdown(countdown - 1)
      }
    }, 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const captureNow = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth || busy) return
    setBusy(true)
    try {
      await fsLoad()
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      if (facing === 'user') {
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(v, 0, 0)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Capture failed')
      const name = `Camera ${stampName()}.png`
      await fs.addFile('photos', name, { blob, mime: 'image/png', meta: { kind: 'photo' } })
      notify({ title: 'Photo captured', body: `${name} — saved to Photos`, kind: 'success', emoji: '📷' })
      refreshShots()
    } catch {
      notify({ title: 'Could not capture photo', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const onShutter = () => {
    if (countdown > 0) {
      setCountdown(0)
      return
    }
    if (!timerOn) {
      void captureNow()
      return
    }
    setCountdown(3)
  }

  const switchCamera = () => {
    if (status !== 'ready') return
    setFacing((f) => (f === 'user' ? 'environment' : 'user'))
  }

  const mirrored = facing === 'user'

  return (
    <AppShell className="relative">
      <Toolbar>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Camera className="h-4 w-4 flex-none text-sky-300" />
          <span className="truncate text-xs font-semibold text-slate-200">Camera</span>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-slate-400">
            {facing === 'user' ? 'Front' : 'Rear'}
          </span>
        </div>
        <TBtn title={timerOn ? 'Timer on (3s)' : 'Timer off'} active={timerOn} onClick={() => setTimerOn((t) => !t)}>
          <Timer className="h-4 w-4" /> <span className="hidden sm:inline">3s</span>
        </TBtn>
        <TBtn title="Switch camera" onClick={switchCamera} disabled={status !== 'ready' || deviceCount < 2}>
          <SwitchCamera className="h-4 w-4" /> <span className="hidden sm:inline">Switch</span>
        </TBtn>
        {status === 'error' && (
          <TBtn title="Retry" onClick={() => setRetryTick((r) => r + 1)}>
            <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Retry</span>
          </TBtn>
        )}
      </Toolbar>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {/* preview */}
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className={`h-full w-full object-cover transition-opacity ${status === 'ready' ? 'opacity-100' : 'opacity-0'} ${
            mirrored ? '-scale-x-100' : ''
          }`}
        />

        {status === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-slate-300">
            <Loader2 className="h-8 w-8 animate-spin text-sky-300" />
            <div className="text-sm">Starting camera…</div>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0c101c] p-8 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/5">
              <CameraOff className="h-9 w-9 text-rose-300" />
            </div>
            <div className="text-base font-semibold text-slate-100">Camera unavailable</div>
            <div className="max-w-xs text-xs leading-relaxed text-slate-400">{errMsg}</div>
            <button
              type="button"
              onClick={() => setRetryTick((r) => r + 1)}
              className="mt-1 flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
          </div>
        )}

        {/* countdown overlay */}
        {countdown > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-sky-400/70 bg-black/60 text-6xl font-bold text-white shadow-2xl backdrop-blur-sm">
              {countdown}
            </div>
          </div>
        )}

        {/* capture flash */}
        {busy && <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/10" />}

        {/* captured strip */}
        {shots.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-6">
            <div className="os-scroll-nobar flex items-center gap-2 overflow-x-auto pb-1">
              <span className="flex-none pr-1 text-[10px] uppercase tracking-wider text-slate-400">Recent</span>
              {shots.map((s) => (
                <ShotThumb key={s.id} node={s} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex flex-none items-center justify-center gap-6 border-t border-white/10 bg-[#161b28] py-3">
        <div className="w-16" />
        <button
          type="button"
          onClick={onShutter}
          disabled={status !== 'ready' || busy}
          title={countdown > 0 ? 'Cancel timer' : timerOn ? 'Capture with 3s timer' : 'Capture photo'}
          aria-label="Capture photo"
          className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white/80 bg-sky-600 shadow-lg shadow-sky-900/40 transition-all hover:scale-105 hover:bg-sky-500 active:scale-95 disabled:opacity-40"
        >
          {countdown > 0 ? <X className="h-6 w-6 text-white" /> : <Camera className="h-6 w-6 text-white" />}
        </button>
        <div className="flex w-16 justify-center">
          {timerOn && (
            <span className="rounded-full bg-white/8 px-2 py-1 text-[10px] font-medium text-sky-300">
              <Timer className="mr-1 inline h-3 w-3" />
              {countdown > 0 ? `${countdown}s` : '3s'}
            </span>
          )}
        </div>
      </div>
    </AppShell>
  )
}
