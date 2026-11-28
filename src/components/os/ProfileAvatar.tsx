// REDSEC v5.1 — ProfileAvatar: the user's personal photo (Settings → Security)
// with a letter-avatar fallback. Used on the lock screen, login screen and the
// Start button so one upload personalizes the whole OS.
'use client'

import { useOS } from '@/lib/os/store'
import { useSkinUrl } from '@/lib/os/skin'

export function ProfileAvatar({ size = 64, ring = true }: { size?: number; ring?: boolean }) {
  const photo = useOS((s) => s.profilePhoto)
  const username = useOS((s) => s.username)
  const url = useSkinUrl(photo)
  if (url) {
    return (
      <img
        src={url}
        alt={username || 'Profile'}
        draggable={false}
        className={`shrink-0 rounded-full object-cover ${ring ? 'ring-4 ring-white/15' : ''}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-teal-600 font-bold text-white ${ring ? 'ring-4 ring-white/15' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-label={username || 'User avatar'}
    >
      {(username || 'U').slice(0, 1).toUpperCase()}
    </div>
  )
}
