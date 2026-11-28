// REDSEC 6.0 — Task 68: Audio Fly × YouTube Music — shared types.
// The engine streams REAL-TIME songs straight from YouTube Music: live search
// (music.youtube.com youtubei/v1), real full-length playback via the YouTube
// IFrame player, and OFFICIAL artist verification (BADGE_STYLE_TYPE_VERIFIED_
// ARTIST — "Official Artist Channel") resolved against youtube.com channels.

export interface YtmTrack {
  videoId: string
  title: string
  artist: string
  artistId: string
  album: string
  duration: string // "3:59" — display text from YouTube Music
  thumb: string
  extra: string // "858M plays" / "1.2B views"
  /** official view count text from YouTube — "535M views" (radio engine) */
  views?: string
  /** official like count text from YouTube — "2.1M likes" (radio engine) */
  likes?: string
  kind: 'song' | 'video'
}

export interface YtmArtist {
  id: string
  name: string
  thumb: string
  audience: string // "441M monthly audience"
}

export interface YtmAlbum {
  id: string
  title: string
  artist: string
  year: string
  thumb: string
}

export interface YtmVerified {
  verified: boolean
  subs: string // "63.5M subscribers"
  handle: string // "@TaylorSwift"
}

export interface YtmSearchResult {
  ok: boolean
  query: string
  /** youtubei continuation token — pass as &ct= to stream the NEXT page of results (unlimited) */
  continuation?: string
  /** videoId seeding the radio chain — hop from here for unlimited pages */
  seed?: string
  top:
    | null
    | { kind: 'artist'; artist: YtmArtist }
    | { kind: 'song'; song: YtmTrack }
    | { kind: 'video'; video: YtmTrack }
  songs: YtmTrack[]
  videos: YtmTrack[]
  artists: YtmArtist[]
  albums: YtmAlbum[]
}

export interface YtmArtistPage {
  ok: boolean
  /** continuation token for the artist's next songs page (unlimited) */
  continuation?: string
  /** videoId seeding the radio chain for unlimited artist pages */
  seed?: string
  artist: {
    id: string
    name: string
    banner: string
    audience: string
    description: string
  }
  songs: YtmTrack[]
  albums: YtmAlbum[]
}

export interface YtmVerifyMap {
  ok: boolean
  verified: Record<string, YtmVerified>
}

export interface YtmHomeResult {
  ok: boolean
  songs: YtmTrack[]
  /** continuation token for the next Quick-picks page (unlimited) */
  continuation?: string
  /** videoId seeding the radio chain — unlimited pages */
  seed?: string
  error?: string
}
