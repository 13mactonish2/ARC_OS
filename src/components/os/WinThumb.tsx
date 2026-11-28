// REDSEC v5.0 — Shared live window thumbnail (modern-screenshot capture, cached in media.ts)
'use client'

import { useEffect, useState } from 'react'
import { windowThumb } from '@/lib/os/media'
import { AppIcon } from './AppIcon'

export function WinThumb({ winId, appId, iconSize = 40 }: { winId: string; appId: string; iconSize?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    windowThumb(winId).then((u) => {
      if (!dead && u) setUrl(u)
    })
    return () => {
      dead = true
    }
  }, [winId])
  if (url) {
    return <img src={url} alt="Window preview" className="absolute inset-0 h-full w-full object-cover object-top" draggable={false} />
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="absolute inset-0 opacity-[0.35]" style={{ background: 'radial-gradient(circle at 30% 20%, rgba(14,165,233,0.18), transparent 55%)' }} />
      <AppIcon appId={appId} size={iconSize} />
    </div>
  )
}
