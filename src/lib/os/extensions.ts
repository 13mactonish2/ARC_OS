// REDSEC v5.0 — Recommended browser extensions hub (Task 18 + extension upgrade).
// The OS embeds websites & web apps, so these helper extensions are suggested
// per browser. NetMirror has no Edge build — shown as unavailable.
// Extension upgrade: "Ignore X-Frame Headers" lands for Chrome (real store
// link); the Firefox build does not exist — rendered as NOT AVAILABLE.

export interface ExtItem {
  name: string
  desc: string
  url: string | null // null = not available for this browser
  color: string
}

export interface BrowserExt {
  id: 'chrome' | 'firefox' | 'edge'
  name: string
  color: string
  items: ExtItem[]
}

export const RECOMMENDED_EXTENSIONS: BrowserExt[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    color: '#fbbc05',
    items: [
      {
        name: 'New Tab Blocker',
        desc: 'Blocks unwanted popups & forced new tabs so embedded apps never steal focus.',
        url: 'https://chromewebstore.google.com/detail/new-tab-blocker/bkanhpjdajkdnibkplooolgpidgfjfnn',
        color: '#22c55e',
      },
      {
        name: 'NetMirror Extension',
        desc: 'Required for the Mirror TV app — online movies & live TV inside the OS.',
        url: 'https://chromewebstore.google.com/detail/netmirror-extension/imeeoinlogcehkhfjcopabijecfobcod',
        color: '#ef4444',
      },
      {
        name: 'Allow X-Frame Options',
        desc: 'Lets websites embed inside the OS browser & apps without frame errors.',
        url: 'https://chromewebstore.google.com/detail/allow-x-frame-options/jfjdfokifdlmbkbncmcfbcobggohdnif',
        color: '#38bdf8',
      },
      {
        name: 'Ignore X-Frame Headers',
        desc: 'Strips X-Frame-Options & frame-ancestors headers so every site embeds inside the OS browser & apps without frame errors.',
        url: 'https://chromewebstore.google.com/detail/ignore-x-frame-headers/gleekbfjekiniecknbkamfmkohkpodhe',
        color: '#a855f7',
      },
    ],
  },
  {
    id: 'firefox',
    name: 'Mozilla Firefox',
    color: '#ff7139',
    items: [
      {
        name: 'New Tab Blocker',
        desc: 'Popup & new-tab blocker — keeps embedded apps running without interruptions.',
        url: 'https://addons.mozilla.org/en-US/firefox/addon/popup-blocker/',
        color: '#22c55e',
      },
      {
        name: 'NetMirror Web Extension',
        desc: 'Required for the Mirror TV app — online movies & live TV inside the OS.',
        url: 'https://addons.mozilla.org/en-US/firefox/addon/netmirror-web-extension/',
        color: '#ef4444',
      },
      {
        name: 'Ignore X-Frame Options',
        desc: 'Ignores X-Frame-Options headers so sites embed inside the OS browser.',
        url: 'https://addons.mozilla.org/en-US/firefox/addon/ignore-x-frame-options-header/',
        color: '#38bdf8',
      },
      {
        name: 'Ignore X-Frame Headers',
        desc: 'Not available for Firefox — this extension has no Firefox build.',
        url: null,
        color: '#64748b',
      },
    ],
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    color: '#0ea5e9',
    items: [
      {
        name: 'New Tab Blocker',
        desc: 'Blocks unwanted popups & forced new tabs inside embedded apps.',
        url: 'https://microsoftedge.microsoft.com/addons/detail/new-tab-blocker/ooikokibjmpobojhdajfcdkjokjdjikc',
        color: '#22c55e',
      },
      {
        name: 'NetMirror Extension',
        desc: 'Not available for Edge — use Chrome or Firefox for the Mirror TV app.',
        url: null,
        color: '#64748b',
      },
      {
        name: 'Allow X-Frame Options',
        desc: 'Lets websites embed inside the OS browser & apps without frame errors.',
        url: 'https://microsoftedge.microsoft.com/addons/detail/allow-xframeoptions/didlaemnndoppgpmmoglkcmaoghlicdp',
        color: '#38bdf8',
      },
    ],
  },
]

/** best-guess of which browser the user is in right now */
export function detectBrowserId(): BrowserExt['id'] {
  if (typeof navigator === 'undefined') return 'chrome'
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'edge'
  if (/Firefox\//.test(ua)) return 'firefox'
  return 'chrome'
}
