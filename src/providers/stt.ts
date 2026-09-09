// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Speech in. Primary is MERaLiON (hosted, handles Singlish / dialect /
// code-switching — this is what makes the language claim a LIVE demo rather
// than a pre-recorded clip). Web Speech is the failover so the stage demo
// never stalls on a slow or rate-limited request.

import type { Lang, LatLng, UnderstandRequest, UnderstandResponse } from '../core/types';
import type { SttProvider, Transcription } from './types';
import { blobToBase64 } from '../audio/capture';
import { FixtureStt } from './fixtures';

/**
 * If MERaLiON hasn't answered in this long, fail over to Web Speech.
 * Measured round trip is 0.6-1.0 s, so 6 s means something is actually wrong.
 */
export const MERALION_TIMEOUT_MS = 6_000;

/**
 * ⚠️ BUDGET — free tier, measured on our real key (corrected 2026-09-10 —
 * see server/meralion.ts and CONTRACTS.md § 2.1 for the live-verified
 * numbers this used to get wrong):
 *   · 200 requests/minute (NOT 5 — that figure was stale, confirmed live via
 *     GET /v1/rate-limit/status; comfortably high, never the real constraint)
 *   · flat ~334 tokens per request regardless of clip length (~337 measured)
 *   · 100k monthly token cap → **~299 requests for the WHOLE MONTH, shared
 *     across the team** — THIS is what actually binds, not the rate limit
 *
 * So: keep FixtureStt as the default while building UI, cache by audio hash
 * (server/index.ts's transcribeMemoized does this — keyed on a hash of the
 * audio, not here, since the hash needs to happen server-side to actually
 * save the request), and treat 429 as a normal condition to fail over from,
 * not an error. Check headroom: GET /v1/rate-limit/status (needs the key —
 * server/meralion.ts's rateLimitStatus()).
 */
export const MERALION_RPM_LIMIT = 200;

/**
 * Calls OUR server at POST /api/understand, which forwards to MERaLiON (and
 * also runs Gemini destination extraction — see server/index.ts). The API
 * key is server-side only — never put it in the browser.
 *
 * ⚠️ Returns only `{text, confidence}` per this provider's SttProvider
 * contract, even though `/api/understand`'s response carries a lot more
 * (`destination`, `clarify`). That's deliberate scope, not an oversight —
 * `SttProvider` is specifically "just transcribe," and the destination
 * resolution `/api/understand` also does is a separate concern the real
 * (non-demo) orchestration layer should call `/api/understand` for directly
 * rather than routing through this provider a second time. Whoever wires
 * that up: don't call this AND re-parse its result for a destination: the
 * server already did that work in the same round trip, it's just discarded
 * here to keep this provider's contract narrow and swappable with
 * WebSpeechStt/FixtureStt, which have no destination-resolution step at all.
 *
 * ⚠️ The MERaLiON API console's JavaScript sample posts to
 *    https://api.meralion.ai/audio/transcription  — that path is a 404.
 *    The real one is /v1/audio/transcriptions (plural, with /v1). This
 *    provider doesn't call MERaLiON directly at all though — it calls our
 *    own server, which is where that trap actually lives (server/meralion.ts).
 */
export class MeraLionStt implements SttProvider {
  readonly name = 'meralion';

  async transcribe(wav: Blob, lang: Lang, at: LatLng): Promise<Transcription> {
    const audioBase64 = await blobToBase64(wav);
    const body: UnderstandRequest = { audioBase64, lang, at };

    const res = await fetch('/api/understand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      throw Object.assign(new Error('MERaLiON rate limited'), { status: 429 });
    }
    if (!res.ok) {
      throw new Error(`/api/understand failed: ${res.status} ${await res.text()}`);
    }

    const understanding = (await res.json()) as UnderstandResponse;
    return { text: understanding.transcript, confidence: 1 };
  }
}

// ─── Web Speech types ────────────────────────────────────────────────────────
// Not in the standard DOM lib (this API is non-standard/vendor-prefixed), so
// these are hand-declared for just the surface this file actually uses —
// narrower and safer than reaching for `any`.

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEventLike extends Event {
  results: { 0: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  const g = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

/** BCP-47 tags for SpeechRecognition — one per language, unlike tts.ts's VOICE_TAGS priority lists (recognition takes exactly one). */
const RECOGNITION_LANG: Record<Lang, string> = {
  zh: 'zh-CN',
  ms: 'ms-MY',
  en: 'en-US',
  ta: 'ta-IN',
};

/**
 * Browser-native fallback (`webkitSpeechRecognition`). Free, no key, but it
 * ignores our recorded blob — it listens live, so the calling code has to take
 * a different path for it. Reliable on Android/desktop Chrome; patchy on iOS.
 *
 * Weak on Singlish and dialect — that's exactly why it's the fallback and not
 * the primary.
 */
export class WebSpeechStt implements SttProvider {
  readonly name = 'webspeech';

  /**
   * `typeof === 'function'`, not `in` — verified live that `in` alone is
   * fragile: it reports `true` for a global that merely EXISTS as a key
   * (e.g. `undefined`), not one that's actually a usable constructor, which
   * let `AutoFailoverStt` below wrongly attempt a fallback that could never
   * work and surface a raw, unwrapped error instead of the friendly message.
   */
  static isSupported(): boolean {
    return getSpeechRecognitionCtor() !== undefined;
  }

  /** `wav` and `at` are unused — see the class doc: this listens live instead of transcribing pre-recorded audio. */
  async transcribe(_wav: Blob, lang: Lang, _at: LatLng): Promise<Transcription> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) throw new Error('WebSpeechStt: SpeechRecognition is not supported in this browser');

    const recognition = new Ctor();
    recognition.lang = RECOGNITION_LANG[lang];
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    return new Promise<Transcription>((resolve, reject) => {
      let settled = false;

      recognition.onresult = (event) => {
        settled = true;
        const alt = event.results[0][0];
        resolve({ text: alt.transcript, confidence: alt.confidence });
      };
      recognition.onerror = (event) => {
        settled = true;
        reject(new Error(`WebSpeechStt error: ${event.error}`));
      };
      recognition.onend = () => {
        // Fires after onresult too — only a real problem if nothing settled first.
        if (!settled) reject(new Error('WebSpeechStt: no speech detected'));
      };

      recognition.start();
    });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function sayItAgain(reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : String(reason);
  return new Error(`Could not hear you (${message}) — please say it again.`);
}

/**
 * Races MERaLiON against MERALION_TIMEOUT_MS; on timeout, a 429, or any other
 * error, falls through to Web Speech. Every exit path from this function is
 * either a real success or `sayItAgain`'s friendly message — CONTRACTS.md
 * § UI rules: never dead-end the user, and never surface a raw error like
 * `"WebSpeechStt error: not-allowed"` to a 70-year-old.
 *
 * ⚠️ The fallback attempt has its OWN try/catch, not just an upfront
 * `isSupported()` gate — found live: `isSupported()` says yes but the actual
 * attempt can still fail (permission denied, no speech heard, or simply a
 * browser bug). Only gating on `isSupported()` let a second failure escape
 * this function unwrapped, defeating the whole point of this class.
 */
class AutoFailoverStt implements SttProvider {
  readonly name = 'auto-failover';

  constructor(
    private readonly meralion: SttProvider,
    private readonly webSpeech: SttProvider,
  ) {}

  async transcribe(wav: Blob, lang: Lang, at: LatLng): Promise<Transcription> {
    try {
      return await withTimeout(
        this.meralion.transcribe(wav, lang, at),
        MERALION_TIMEOUT_MS,
        `MERaLiON timed out after ${MERALION_TIMEOUT_MS}ms`,
      );
    } catch (meralionErr) {
      if (!WebSpeechStt.isSupported()) throw sayItAgain(meralionErr);
      try {
        return await this.webSpeech.transcribe(wav, lang, at);
      } catch (webSpeechErr) {
        throw sayItAgain(webSpeechErr);
      }
    }
  }
}

/**
 * Race MERaLiON against MERALION_TIMEOUT_MS; on timeout or error, fall through
 * to Web Speech; if that's unsupported, surface a "say it again" prompt rather
 * than an error screen. Never dead-end the user.
 */
export function createStt(opts: { demoMode: boolean }): SttProvider {
  if (opts.demoMode) return new FixtureStt();
  return new AutoFailoverStt(new MeraLionStt(), new WebSpeechStt());
}
