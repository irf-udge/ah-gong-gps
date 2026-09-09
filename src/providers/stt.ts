// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Speech in. Primary is MERaLiON (hosted, handles Singlish / dialect /
// code-switching — this is what makes the language claim a LIVE demo rather
// than a pre-recorded clip). Web Speech is the failover so the stage demo
// never stalls on a slow or rate-limited request.

import type { Lang } from '../core/types';
import type { SttProvider, Transcription } from './types';

/**
 * If MERaLiON hasn't answered in this long, fail over to Web Speech.
 * Measured round trip is 0.6-1.0 s, so 6 s means something is actually wrong.
 */
export const MERALION_TIMEOUT_MS = 6_000;

/**
 * ⚠️ BUDGET — free tier, measured on our real key:
 *   · 5 requests/minute
 *   · flat ~334 tokens per request regardless of clip length
 *   · 100k monthly token cap → **~299 requests for the WHOLE MONTH, all 3 of us**
 *
 * So: keep FixtureStt as the default while building UI, cache by audio hash,
 * and treat 429 as a normal condition to fail over from — not an error.
 * Check headroom: GET https://api.meralion.ai/keys/usage
 */
export const MERALION_RPM_LIMIT = 5;

/**
 * Calls OUR server at POST /api/understand, which forwards to MERaLiON.
 * The API key is server-side only — never put it in the browser.
 *
 * ⚠️ The MERaLiON API console's JavaScript sample posts to
 *    https://api.meralion.ai/audio/transcription  — that path is a 404.
 *    The real one is /v1/audio/transcriptions (plural, with /v1).
 *    Don't copy their JS sample. See CONTRACTS.md § Verified API facts.
 */
export class MeraLionStt implements SttProvider {
  readonly name = 'meralion';

  async transcribe(_wav: Blob, _lang: Lang): Promise<Transcription> {
    throw new Error('NOT_IMPLEMENTED: MeraLionStt.transcribe');
  }
}

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

  static isSupported(): boolean {
    return 'webkitSpeechRecognition' in globalThis || 'SpeechRecognition' in globalThis;
  }

  async transcribe(_wav: Blob, _lang: Lang): Promise<Transcription> {
    throw new Error('NOT_IMPLEMENTED: WebSpeechStt.transcribe');
  }
}

/**
 * Race MERaLiON against MERALION_TIMEOUT_MS; on timeout or error, fall through
 * to Web Speech; if that's unsupported, surface a "say it again" prompt rather
 * than an error screen. Never dead-end the user.
 */
export function createStt(_opts: { demoMode: boolean }): SttProvider {
  throw new Error('NOT_IMPLEMENTED: stt.createStt');
}
