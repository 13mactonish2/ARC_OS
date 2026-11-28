// REDSEC 5.0 — branded app logos for the communication suite.
// Hand-drawn SVG marks (crisp at any size) used by AppIcon, the mobile hub
// and the desktop start menu. Colors match APP_META so tiles stay coherent.
'use client'

import React from 'react'

interface LogoProps {
  size?: number
  className?: string
}

/** Video Call — camera body + lens, two broadcast waves (emerald) */
export function LogoVideoCall({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Video Call logo">
      <defs>
        <linearGradient id="vcg" x1="8" y1="10" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      {/* broadcast waves */}
      <path d="M44 14c7 2.5 11 9 11 16s-4 13.5-11 16" fill="none" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
      <path d="M47.5 20.5c4.5 2 7 5.7 7 9.5s-2.5 7.5-7 9.5" fill="none" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      {/* camera body */}
      <rect x="6" y="17" width="34" height="30" rx="8" fill="url(#vcg)" />
      {/* lens */}
      <circle cx="23" cy="32" r="8.5" fill="#03211d" opacity="0.92" />
      <circle cx="23" cy="32" r="4.2" fill="#7dd3fc" />
      <circle cx="20.8" cy="29.6" r="1.5" fill="#f0f9ff" />
      {/* viewfinder prism */}
      <path d="M42 27l12-7c1.8-1 4 .2 4 2.3v19.4c0 2.1-2.2 3.3-4 2.3l-12-7z" fill="#0ea5e9" />
    </svg>
  )
}

/** Chat — rounded bubble with a security keyhole + typing dots tail (violet) */
export function LogoChat({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Chat logo">
      <defs>
        <linearGradient id="chg" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <path
        d="M32 8c13.8 0 25 9.6 25 21.6S45.8 51.2 32 51.2c-2.9 0-5.7-.4-8.3-1.2L11 56l3.4-10.6C9.3 41.2 7 35.7 7 29.6 7 17.6 18.2 8 32 8z"
        fill="url(#chg)"
      />
      {/* keyhole lock = encrypted rooms */}
      <circle cx="32" cy="26" r="5" fill="#f5f3ff" opacity="0.95" />
      <path d="M28.5 29h7l1.8 12H26.7z" fill="#f5f3ff" opacity="0.95" />
      {/* typing dots */}
      <circle cx="18.5" cy="29.5" r="2.4" fill="#ede9fe" opacity="0.85" />
      <circle cx="45.5" cy="29.5" r="2.4" fill="#ede9fe" opacity="0.85" />
    </svg>
  )
}

/** Mail — envelope with a shield-check badge (amber) */
export function LogoMail({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Mail logo">
      <defs>
        <linearGradient id="mlg" x1="8" y1="14" x2="56" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <rect x="6" y="14" width="46" height="34" rx="7" fill="url(#mlg)" />
      {/* flap */}
      <path d="M9 19l17.6 13.4c3.2 2.4 7.6 2.4 10.8 0L55 19" fill="none" stroke="#fffbeb" strokeWidth="3.4" strokeLinecap="round" opacity="0.9" />
      {/* shield badge */}
      <path d="M46 30l9 3.2v7.2c0 6.3-3.9 10.9-9 12.6-5.1-1.7-9-6.3-9-12.6v-7.2z" fill="#0f172a" opacity="0.92" />
      <path d="M41.6 41.6l3.4 3.4 6.2-6.6" fill="none" stroke="#fde68a" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}


/** GPU — VXR-5 card: violet PCB, golden die, fan coils, pcie fingers */
export function LogoGpu({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="GPU logo">
      <defs>
        <linearGradient id="gpug" x1="8" y1="14" x2="56" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      {/* PCB */}
      <rect x="6" y="16" width="52" height="32" rx="7" fill="url(#gpug)" />
      {/* bracket screws */}
      <circle cx="12" cy="22" r="1.6" fill="#ddd6fe" opacity="0.8" />
      <circle cx="52" cy="42" r="1.6" fill="#ddd6fe" opacity="0.8" />
      {/* die */}
      <rect x="24" y="24" width="16" height="16" rx="3" fill="#fbbf24" />
      <rect x="28" y="28" width="8" height="8" rx="1.5" fill="#78350f" opacity="0.85" />
      {/* fan coils */}
      <circle cx="16" cy="32" r="6" fill="none" stroke="#ede9fe" strokeWidth="2" opacity="0.9" />
      <circle cx="48" cy="32" r="6" fill="none" stroke="#ede9fe" strokeWidth="2" opacity="0.9" />
      {/* pcie fingers */}
      <rect x="14" y="48" width="5" height="5" rx="1" fill="#8b5cf6" />
      <rect x="21" y="48" width="5" height="5" rx="1" fill="#8b5cf6" />
      <rect x="28" y="48" width="5" height="5" rx="1" fill="#8b5cf6" />
      <rect x="35" y="48" width="5" height="5" rx="1" fill="#8b5cf6" />
    </svg>
  )
}

/** Velikan — heir of Security Core: crimson shield + scan sweep */
export function LogoRedShield({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Velikan logo">
      <defs>
        <linearGradient id="rsg" x1="12" y1="6" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f87171" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
      </defs>
      {/* shield body */}
      <path d="M32 5l21 7.5v16.2C53 44.6 44.6 54.6 32 59 19.4 54.6 11 44.6 11 28.7V12.5z" fill="url(#rsg)" />
      {/* inner sweep */}
      <path d="M32 11.5l15.5 5.5v13.4c0 10.9-5.6 17.9-15.5 21.6V11.5z" fill="#450a0a" opacity="0.35" />
      {/* checkmark core */}
      <path d="M22.5 32.5l6.5 6.5 13-13.5" fill="none" stroke="#fecaca" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* scan tick */}
      <rect x="16" y="18" width="32" height="3" rx="1.5" fill="#fee2e2" opacity="0.5" />
    </svg>
  )
}

/** Mobile Link — REDSEC-red phone silhouette + link waves (Task 16) */
export function LogoMobileLink({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Mobile Link logo">
      <defs>
        <linearGradient id="mlg" x1="20" y1="8" x2="46" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="1" stopColor="#9f1239" />
        </linearGradient>
      </defs>
      {/* phone body (RedSec slab) */}
      <rect x="19" y="6" width="26" height="52" rx="6" fill="url(#mlg)" />
      <rect x="22" y="12" width="20" height="36" rx="2" fill="#1a0510" opacity="0.85" />
      {/* screen glow */}
      <rect x="24" y="14" width="16" height="14" rx="1.5" fill="#fda4af" opacity="0.5" />
      {/* BB-style 7-dot logo on the screen */}
      <circle cx="29" cy="34" r="2.2" fill="#fecdd3" />
      <circle cx="35" cy="34" r="2.2" fill="#fecdd3" />
      <circle cx="41" cy="34" r="0" fill="#fecdd3" />
      <circle cx="32" cy="39" r="2.2" fill="#fecdd3" />
      <circle cx="38" cy="39" r="2.2" fill="#fecdd3" />
      {/* link waves */}
      <path d="M52 22c4 2.5 4 9.5 0 12" fill="none" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
      <path d="M56 18c6.5 4.5 6.5 16.5 0 21" fill="none" stroke="#fda4af" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
      <path d="M12 22c-4 2.5-4 9.5 0 12" fill="none" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
      {/* chin */}
      <rect x="28" y="51" width="8" height="2.5" rx="1.25" fill="#fecdd3" opacity="0.8" />
    </svg>
  )
}

/** Cone Player — the VLC-class traffic cone, orange with a white band (Task 53) */
export function LogoCone({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Cone Player logo">
      <defs>
        <linearGradient id="cpg" x1="22" y1="8" x2="44" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fdba74" />
          <stop offset="0.55" stopColor="#f97316" />
          <stop offset="1" stopColor="#c2410c" />
        </linearGradient>
      </defs>
      {/* base plate */}
      <rect x="8" y="52" width="48" height="6" rx="3" fill="#9a3412" />
      <rect x="8" y="52" width="48" height="2.6" rx="1.3" fill="#fdba74" opacity="0.55" />
      {/* cone body */}
      <path d="M32 7c1.9 0 3.4 1.1 4.2 2.9L45.8 47c.8 2-.6 4-2.8 4H21c-2.2 0-3.6-2-2.8-4L27.8 9.9C28.6 8.1 30.1 7 32 7z" fill="url(#cpg)" />
      {/* white reflective band */}
      <path d="M25.1 28.6h13.8l1.9 7.4H23.2z" fill="#fff7ed" opacity="0.92" />
      <path d="M24.2 25.2h15.6l-.9 3.4H25.1z" fill="#ffedd5" opacity="0.7" />
      {/* play glyph on the cone tip */}
      <circle cx="32" cy="17.5" r="4.6" fill="#1c1002" opacity="0.85" />
      <path d="M30.4 14.9l5.2 2.6-5.2 2.6z" fill="#fdba74" />
    </svg>
  )
}

/** M/Ø Video — kdenlive-class editor: rose clapperboard with an open striped
 *  slate, play core and a timeline clip strip (matches APP_META #f43f5e) */
export function LogoMVideo({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="M/Ø Video logo">
      <defs>
        <linearGradient id="mvvg" x1="10" y1="10" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="1" stopColor="#9f1239" />
        </linearGradient>
      </defs>
      {/* open slate — tilted up around the left hinge */}
      <path d="M7 24 L55 10.5 L57.5 18.5 L9.5 32 Z" fill="url(#mvvg)" />
      {/* reflective slate stripes */}
      <path d="M16.6 21.3 L19.5 20.5 L24.9 27.7 L22 28.5 Z" fill="#fff1f2" opacity="0.9" />
      <path d="M26.2 18.6 L29.1 17.8 L34.5 25 L31.6 25.8 Z" fill="#fff1f2" opacity="0.9" />
      <path d="M35.8 15.9 L38.7 15.1 L44.1 22.2 L41.2 23 Z" fill="#fff1f2" opacity="0.9" />
      {/* body */}
      <rect x="6" y="28" width="52" height="28" rx="7" fill="url(#mvvg)" />
      {/* play core */}
      <path d="M27 34.5 L41.5 42 L27 49.5 Z" fill="#fff1f2" />
      {/* timeline clip strip */}
      <rect x="12" y="51.5" width="9" height="3" rx="1.2" fill="#fecdd3" opacity="0.75" />
      <rect x="23" y="51.5" width="9" height="3" rx="1.2" fill="#fecdd3" opacity="0.75" />
      <rect x="34" y="51.5" width="9" height="3" rx="1.2" fill="#fecdd3" opacity="0.75" />
      {/* hinge pin */}
      <circle cx="9.5" cy="26.2" r="2.2" fill="#fecdd3" />
    </svg>
  )
}

/** Enna E/Dtor — Krita-class studio: fuchsia paint splat with wells and a
 *  loaded round brush crossing it (matches APP_META #e879f9) */
export function LogoEnna({ size = 24, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Enna E/Dtor logo">
      <defs>
        <linearGradient id="ennag" x1="10" y1="8" x2="52" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
      </defs>
      {/* satellite droplets */}
      <circle cx="10" cy="10" r="3" fill="#e879f9" />
      <circle cx="55" cy="50" r="3.5" fill="#e879f9" />
      {/* paint splat body */}
      <path
        d="M30 6 C40 6 50 12 51 24 C52 34 44 42 34 45 C24 48 12 44 8 34 C4 24 10 12 20 8 C23 6.6 26 6 30 6 Z"
        fill="url(#ennag)"
      />
      {/* palette wells */}
      <circle cx="20" cy="23" r="3.6" fill="#4a044e" opacity="0.5" />
      <circle cx="30" cy="31" r="3.6" fill="#4a044e" opacity="0.5" />
      <circle cx="39" cy="21" r="3.6" fill="#4a044e" opacity="0.5" />
      {/* sheen */}
      <ellipse cx="25" cy="14" rx="6" ry="2.8" fill="#ffffff" opacity="0.22" />
      {/* wooden handle */}
      <path d="M18 54 L42 20" stroke="#b45309" strokeWidth="5" strokeLinecap="round" />
      {/* ferrule */}
      <path d="M42 20 L46 14.5" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
      {/* bristles loaded with paint */}
      <path d="M45 15 C47 11 50 7.5 54 5 C53.5 10 51 14.5 47.5 17 Z" fill="#701a35" />
    </svg>
  )
}

/** registry used by AppIcon + mobile hub */
export const BRAND_LOGOS: Record<string, React.ComponentType<LogoProps>> = {
  videocall: LogoVideoCall,
  chat: LogoChat,
  mail: LogoMail,
  gpu: LogoGpu,
  shield: LogoRedShield,
  mobilelink: LogoMobileLink,
  coneplayer: LogoCone,
  mvideo: LogoMVideo,
  photoeditor: LogoEnna,
}
