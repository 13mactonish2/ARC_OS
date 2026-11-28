// RE BlueStringRay v6.0 — Falcon logo mark (Carbon Blue gradient)
'use client'
import React from 'react'

export function FalconLogo({ size = 96, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={glow ? 'drop-shadow-[0_0_18px_rgba(56,189,248,0.5)]' : ''}>
      <defs>
        <linearGradient id="falconGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" stroke="url(#falconGrad)" strokeWidth="2.5" opacity="0.55" />
      <path
        d="M50 12 C36 26 30 34 28 46 C27 54 30 60 36 64 L30 88 L44 70 C46 72 48 73 50 73 C52 73 54 72 56 70 L70 88 L64 64 C70 60 73 54 72 46 C70 34 64 26 50 12 Z"
        fill="url(#falconGrad)"
        opacity="0.92"
      />
      <path d="M50 22 L42 48 L50 42 L58 48 Z" fill="#082f49" opacity="0.85" />
    </svg>
  )
}
