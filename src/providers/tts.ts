// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Speech out, via the browser's built-in speechSynthesis.
//
// MERaLiON has NO text-to-speech endpoint — don't go looking for one.
//
// Because synthesis is LOCAL there is no network round trip, which is why we
// do NOT pre-generate audio at journey start (the brief asked for that to hide
// latency we no longer have). Keep this behind the interface anyway so a
// hosted voice can drop in later.
//
// ⚠️ PHASE 0 BLOCKER: run availableLangs() on the ACTUAL demo phone before
// writing anything else. If the device has no ms-MY voice, half the demo is
// dead and you need to know on hour one. See DEVPLAN.md § Phase 0.

import type { Lang } from '../core/types';
import type { TtsProvider } from './types';

/** BCP-47 tags to match against `speechSynthesis.getVoices()`. */
export const VOICE_TAGS: Record<Lang, readonly string[]> = {
  zh: ['zh-CN', 'zh-SG', 'zh-Hans-CN', 'zh'],
  ms: ['ms-MY', 'ms'],
  en: ['en-SG', 'en-GB', 'en-US', 'en'],
  ta: ['ta-IN', 'ta-SG', 'ta'],
};

/**
 * Slightly slower than the browser default (1.0) — plain, unhurried speech
 * for a 70+ listener standing outside in the heat, not a hard requirement
 * from anywhere in CONTRACTS.md. Tune this during rehearsal, not in a rush.
 */
export const SPEECH_RATE = 0.9;

/** How long to wait for Chrome's async voice list before giving up. */
const VOICE_LOAD_TIMEOUT_MS = 3_000;

function synth(): SpeechSynthesis {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    throw new Error('speechSynthesis is not available in this environment');
  }
  return window.speechSynthesis;
}

/**
 * Resolves once `getVoices()` has real entries, or after VOICE_LOAD_TIMEOUT_MS
 * — whichever comes first. Firefox/Safari often populate voices synchronously
 * (this resolves immediately); Chrome populates them asynchronously on the
 * `voiceschanged` event, which is the whole reason this function exists.
 *
 * `availableLangs()` itself stays synchronous (that's the TtsProvider
 * contract, and FixtureTts can't await anything anyway) — call this FIRST,
 * once, e.g. at app start or right after the Phase 0 voice check, so
 * `availableLangs()` has something real to report by the time anyone asks.
 */
export function waitForVoicesReady(timeoutMs = VOICE_LOAD_TIMEOUT_MS): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  const existing = s.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      s.removeEventListener('voiceschanged', onChange);
      clearTimeout(timer);
      resolve(voices);
    };
    const onChange = () => finish(s.getVoices());
    s.addEventListener('voiceschanged', onChange);
    const timer = setTimeout(() => finish(s.getVoices()), timeoutMs);
  });
}

/** Best matching voice for `lang` from whatever `getVoices()` currently has, honouring VOICE_TAGS' priority order. */
function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  const voices = synth().getVoices();
  for (const tag of VOICE_TAGS[lang]) {
    const exact = voices.find((v) => v.lang.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
  }
  // Loose fallback: any voice whose lang STARTS WITH the base tag (e.g. "zh" matches "zh-Hans-CN").
  const base = VOICE_TAGS[lang][0]?.split('-')[0]?.toLowerCase();
  return voices.find((v) => v.lang.toLowerCase().startsWith(base ?? lang)) ?? null;
}

export class BrowserTts implements TtsProvider {
  readonly name = 'browser';

  /**
   * iOS/Safari refuses to speak unless speechSynthesis was first invoked inside
   * a user gesture — and the speak() call itself must run SYNCHRONOUSLY inside
   * the gesture handler, not merely be triggered by it via a later promise
   * tick. Call this as the very first line of the big button's tap handler.
   *
   * Speaks a single space rather than a truly empty string — some engines
   * silently no-op on "" and never unlock the queue.
   */
  primeForUserGesture(): void {
    const s = synth();
    const unlock = new SpeechSynthesisUtterance(' ');
    unlock.volume = 0;
    s.speak(unlock);
    s.cancel();
  }

  /**
   * Synchronous by contract (see the file header on why) — reports whatever
   * `getVoices()` currently has. Call `waitForVoicesReady()` once at app start
   * if you need this to be reliable on the very first call, especially on
   * Chrome.
   */
  availableLangs(): Lang[] {
    const voices = synth().getVoices();
    const langs: Lang[] = ['zh', 'ms', 'en', 'ta'];
    return langs.filter((lang) =>
      VOICE_TAGS[lang].some((tag) => voices.some((v) => v.lang.toLowerCase() === tag.toLowerCase())),
    );
  }

  /**
   * Cancels any utterance already in flight first — speechSynthesis queues by
   * default, and a journey that calls speak() faster than a step finishes
   * (e.g. "I'm lost" firing mid-sentence) must never stack overlapping audio.
   * Only ever one current utterance.
   *
   * Resolves on completion. Resolves (not rejects) on a deliberate
   * cancel/interrupt — that's not a failure, someone asked for it. Rejects on
   * a genuine synthesis error so the caller can decide to retry or skip,
   * matching the "assume things fail, offer a way forward" rule elsewhere in
   * this app (see CONTRACTS.md § UI rules) rather than swallowing it silently.
   */
  async speak(text: string, lang: Lang): Promise<void> {
    const s = synth();
    s.cancel();

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(lang);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = VOICE_TAGS[lang][0] ?? lang;
      }
      utterance.rate = SPEECH_RATE;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve();
        } else {
          reject(new Error(`speechSynthesis error: ${e.error}`));
        }
      };

      s.speak(utterance);
    });
  }

  cancel(): void {
    synth().cancel();
  }
}

/** Silent no-op for tests and for running the pipeline headless. */
export class FixtureTts implements TtsProvider {
  readonly name = 'fixture';

  primeForUserGesture(): void {}
  availableLangs(): Lang[] {
    return ['zh', 'ms'];
  }
  async speak(_text: string, _lang: Lang): Promise<void> {}
  cancel(): void {}
}
