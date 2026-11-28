// REDSEC v5.0 — Task 26 + Task 36: OpenCode live-preview overlay.
// Modal sandboxed iframe + Refresh / Close controls — and (Task 36) the
// "Turn into…" export bar that turns the running web code into REAL OS files:
// 📸 photo (PNG) · 🔊 sound (WAV of everything the page plays) ·
// 🎬 media (8 s WebM clip of the canvas) · 🎮 game (standalone playable .html).
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, FileDown, Monitor, Music4, RefreshCw, Video, X } from 'lucide-react'
import { injectBridge, parseExportData, saveWebExport, saveWebGame } from '@/lib/os/webexport'

export interface PreviewState {
  srcdoc: string
  name: string
  needsInternet: boolean
}

export default function PreviewOverlay({ preview, onClose }: { preview: PreviewState; onClose: () => void }) {
  const [key, setKey] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [recKind, setRecKind] = useState<'sound' | 'media' | null>(null)
  const [recSecs, setRecSecs] = useState(0)

  /* the bridged document — the OS export bridge runs before user code */
  const bridgedDoc = React.useMemo(() => injectBridge(preview.srcdoc), [preview.srcdoc])

  /* live seconds counter while recording */
  useEffect(() => {
    if (!recKind) return
    const t0 = Date.now()
    const reset = window.setTimeout(() => setRecSecs(0), 0)
    const iv = setInterval(() => setRecSecs(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => {
      clearTimeout(reset)
      clearInterval(iv)
    }
  }, [recKind])

  /* receive the real files back from the bridge */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const { file, err } = parseExportData(e.data)
      if (file) {
        setRecKind(null)
        void saveWebExport(file, preview.name.replace(/\.[^.]+$/, ''))
      } else if (err) {
        setRecKind(null)
        import('@/lib/os/store').then(({ useOS }) =>
          useOS.getState().notify({ title: 'Export failed', body: err.msg, kind: 'error' }),
        )
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [preview.name])

  const send = useCallback((op: string) => {
    frameRef.current?.contentWindow?.postMessage({ __osExport: op }, '*')
  }, [])

  const takePhoto = useCallback(() => {
    send('photo')
    import('@/lib/os/store').then(({ useOS }) =>
      useOS.getState().notify({ title: 'Capturing photo…', body: 'Snapshotting the running page', kind: 'info', emoji: '📸' }),
    )
  }, [send])

  const toggleSound = useCallback(() => {
    if (recKind === 'sound') send('sound-stop')
    else {
      setRecKind('sound')
      send('sound-start')
    }
  }, [recKind, send])

  const toggleMedia = useCallback(() => {
    if (recKind === 'media') send('media-stop')
    else {
      setRecKind('media')
      send('media-start')
      window.setTimeout(() => {
        setRecKind((k) => {
          if (k === 'media') {
            send('media-stop')
            return null
          }
          return k
        })
      }, 8000)
    }
  }, [recKind, send])

  const exportGame = useCallback(() => {
    void saveWebGame(preview.srcdoc, preview.name.replace(/\.html?$/i, '').replace(/\.[^.]+$/, ''))
  }, [preview.srcdoc, preview.name])

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-label={`Live preview of ${preview.name}`}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0d1117] shadow-2xl">
        <div className="flex h-10 flex-none items-center gap-2 border-b border-white/10 bg-[#161b28] px-3">
          <Monitor className="h-4 w-4 text-sky-400" />
          <span className="truncate text-xs font-medium text-slate-200">Live preview — {preview.name}</span>
          {preview.needsInternet && (
            <span className="flex-none rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300" title="This preview loads a runtime from a CDN">
              needs internet
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setKey((k) => k + 1)}
              className="flex h-7 items-center gap-1 rounded-md bg-white/5 px-2 text-[10px] text-slate-300 hover:bg-white/10"
              title="Reload the preview"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 items-center gap-1 rounded-md bg-white/5 px-2 text-[10px] text-slate-300 hover:bg-white/10"
              title="Close the preview"
            >
              <X className="h-3 w-3" /> Close
            </button>
          </div>
        </div>

        {/* Task 36 — turn this web code into real OS files */}
        <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#10141f] px-3 py-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Turn into</span>
          <button
            type="button"
            onClick={takePhoto}
            className="flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2 text-[10.5px] font-medium text-slate-200 hover:bg-white/10"
            title="Snapshot the running page as a real PNG → File Manager ▸ Photos"
          >
            <Camera className="h-3 w-3 text-sky-300" /> Photo
          </button>
          <button
            type="button"
            onClick={toggleSound}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[10.5px] font-medium transition-colors ${
              recKind === 'sound' ? 'border-rose-400/40 bg-rose-500/20 text-rose-200' : 'border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/10'
            }`}
            title="Record everything the page plays as a real WAV → File Manager ▸ Music"
          >
            <Music4 className="h-3 w-3 text-sky-300" />
            {recKind === 'sound' ? `Sound ${String(recSecs).padStart(2, '0')}s — stop` : 'Sound'}
            {recKind === 'sound' && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-400" /></span>}
          </button>
          <button
            type="button"
            onClick={toggleMedia}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[10.5px] font-medium transition-colors ${
              recKind === 'media' ? 'border-rose-400/40 bg-rose-500/20 text-rose-200' : 'border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/10'
            }`}
            title="Record an 8-second WebM clip of the canvas → File Manager ▸ Videos"
          >
            <Video className="h-3 w-3 text-sky-300" />
            {recKind === 'media' ? `Clip ${String(recSecs).padStart(2, '0')}s — stop` : 'Media clip'}
            {recKind === 'media' && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-400" /></span>}
          </button>
          <button
            type="button"
            onClick={exportGame}
            className="flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2 text-[10.5px] font-medium text-slate-200 hover:bg-white/10"
            title="Package the code as a standalone playable .html game → File Manager ▸ Documents"
          >
            🎮 Game file
          </button>
          <span className="ml-auto hidden items-center gap-1 text-[9.5px] text-slate-500 sm:flex">
            <FileDown className="h-3 w-3" /> files land in the File Manager & open for real
          </span>
        </div>

        <iframe
          key={key}
          ref={frameRef}
          title="OpenCode live preview"
          srcDoc={bridgedDoc}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          className="min-h-0 flex-1 bg-white"
        />
      </div>
    </div>
  )
}
