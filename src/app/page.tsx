import { OSRoot } from '@/components/os/OSRoot'

/* The OS is a living app — the HTML shell must never be pinned by CDN/gateway
   caches (every build ships a new page-chunk hash; a stale shell = "nothing
   changed" for the user). JS chunks under /_next/static stay immutable-cached. */
export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <OSRoot />
    </main>
  )
}
