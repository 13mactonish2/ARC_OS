// REDSEC v5.0 — Shield logo mark (crimson security shield + falcon silhouette)
'use client'
import React from 'react'

export function ShieldMark({ size = 96, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={glow ? 'drop-shadow-[0_0_18px_rgba(244,63,94,0.45)]' : ''}>
      <defs>
        <linearGradient id="redsecGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" stroke="url(#redsecGrad)" strokeWidth="2.5" opacity="0.5" />
      {/* shield body */}
      <path
        d="M50 10 L82 20 V46 C82 66 70 80 50 90 C30 80 18 66 18 46 V20 Z"
        fill="url(#redsecGrad)"
        opacity="0.95"
      />
      {/* falcon silhouette inside the shield */}
      <path
        d="M50 24 C41 32 37.5 37.5 36.5 45 C36 50 38.5 54 43 56.5 L39 72 L48 61.5 C49.3 62.3 50.7 62.3 52 61.5 L61 72 L57 56.5 C61.5 54 64 50 63.5 45 C62.5 37.5 59 32 50 24 Z"
        fill="#0b0f19"
        opacity="0.88"
      />
      {/* scan check accent */}
      <path d="M38 47 L47 55 L63 36" stroke="#fecdd3" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" fill="none" />
    </svg>
  )
}
