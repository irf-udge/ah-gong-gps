// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// MERaLiON speech-to-text. A*STAR I²R's Singapore-native audio model: Singlish,
// Mandarin, Malay, Tamil, Hokkien/Cantonese, and code-switching mid-sentence.
//
// The brief said MERaLiON was download-only and warned about GPU self-hosting.
// That is out of date — there is a hosted API, which is why the dialect claim
// is a LIVE demo rather than a pre-recorded clip.
//
// VERIFIED against the live API:
//   POST https://api.meralion.ai/v1/audio/transcriptions
//   Headers: Authorization: Bearer <key>   (or X-API-Key)
//   Body:    { audio_url, model?, stream?, keep_diarization_for_long_audio? }
//   Response: choices[0].message.content
//   GET  /v1/models          — PUBLIC, no key. Use it as a liveness check.
//   GET  /v1/rate-limit/status — needs the key; check your tier early.
//
// ⚠️ TWO TRAPS, both verified:
//   1. The API console's JavaScript sample posts to
//      https://api.meralion.ai/audio/transcription → that is a 404.
//      Only /v1/audio/transcriptions works. Don't copy their JS sample.
//   2. Audio MUST be 16 kHz mono (wav/mp3/ogg). MediaRecorder's 48 kHz WebM
//      will be rejected. src/audio/capture.ts is what produces a valid blob.

export const MERALION_BASE = process.env.MERALION_BASE_URL ?? 'https://api.meralion.ai';
export const MERALION_MODEL = process.env.MERALION_MODEL ?? 'MERaLiON/MERaLiON-3-3B-ASR-CTM';

/**
 * ⚠️ VERIFIED BUDGET (free tier, our key): 5 req/min, and a flat ~334 tokens
 * per request regardless of clip length — a 1.5 s and a 6.0 s clip both billed
 * 330 prompt tokens. The 100k monthly token cap therefore binds at
 * **~299 requests for the entire month, shared across the team.**
 *
 * CACHE TRANSCRIPTIONS HERE, keyed on a hash of the audio bytes. The same dev
 * testing the same phrase twenty times must cost one request, not twenty.
 * Surface 429 to the client so it can fall back to Web Speech.
 */
export const MONTHLY_REQUEST_BUDGET = 299;

export interface TranscribeResult {
  text: string;
  raw: unknown;
}

/**
 * @param audioBase64 raw base64, NO data-URI prefix — this function adds
 *                    `data:audio/wav;base64,` itself.
 */
export async function transcribe(_audioBase64: string): Promise<TranscribeResult> {
  throw new Error('NOT_IMPLEMENTED: meralion.transcribe');
}

/** GET /v1/models — no key needed. Cheap "is MERaLiON up" check for the demo. */
export async function ping(): Promise<boolean> {
  throw new Error('NOT_IMPLEMENTED: meralion.ping');
}

/** GET /v1/rate-limit/status — run this as soon as the key exists. */
export async function rateLimitStatus(): Promise<unknown> {
  throw new Error('NOT_IMPLEMENTED: meralion.rateLimitStatus');
}
