// REDSEC v5.0 — Speech engine (Web Speech API)
'use client'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
}

interface SpeechEventLike {
  resultIndex: number
  results: {
    length: number
    [i: number]: { isFinal: boolean; 0: { transcript: string } }
  }
}

export class VoiceEngine {
  private rec: SpeechRecognitionLike | null = null
  private active = false
  private onFinal: ((t: string) => void) | null = null
  private onPartial: ((t: string) => void) | null = null
  private onState: ((listening: boolean) => void) | null = null

  supported(): boolean {
    if (typeof window === 'undefined') return false
    return !!(window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
      !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  }

  start(handlers: { final: (t: string) => void; partial?: (t: string) => void; state?: (l: boolean) => void }): void {
    if (!this.supported()) return
    this.stop()
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .SpeechRecognition || (window as unknown as { webkitSpeechRecognition: new () => SpeechRecognitionLike }).webkitSpeechRecognition
    this.onFinal = handlers.final
    this.onPartial = handlers.partial || null
    this.onState = handlers.state || null
    this.active = true
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let partial = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const text = r[0].transcript.trim()
          if (text && this.onFinal) this.onFinal(text)
        } else {
          partial += r[0].transcript
        }
      }
      if (this.onPartial) this.onPartial(partial)
    }
    rec.onend = () => {
      if (this.active) {
        try {
          rec.start()
        } catch {
          /* restart race */
        }
      } else if (this.onState) this.onState(false)
    }
    rec.onerror = () => {}
    try {
      rec.start()
      this.rec = rec
      if (this.onState) this.onState(true)
    } catch {
      /* already started */
    }
  }

  stop(): void {
    this.active = false
    if (this.rec) {
      try {
        this.rec.stop()
      } catch {}
      this.rec = null
      if (this.onState) this.onState(false)
    }
  }

  isListening(): boolean {
    return this.active
  }
}

export const voiceEngine = new VoiceEngine()

export function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.02
    u.pitch = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch {}
}
