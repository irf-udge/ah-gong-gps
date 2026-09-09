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
//
// ⚠️ SILENT/NON-SPEECH AUDIO RETURNS THE LITERAL STRING "(nospeech)\n" — not
// an empty string, not an error. Verified live with a synthetic 440Hz tone
// (no actual speech). Whatever calls transcribe() and feeds the result to
// Gemini's extractDestination should treat "(nospeech)" the same as "say it
// again" — passing it through as if it were real speech would just waste an
// extraction call on nothing.

export const MERALION_BASE = process.env.MERALION_BASE_URL ?? 'https://api.meralion.ai';
export const MERALION_MODEL = process.env.MERALION_MODEL ?? 'MERaLiON/MERaLiON-3-3B-ASR-CTM';

/**
 * ⚠️ RATE LIMIT CORRECTED 2026-09-10 — the "5 req/min" figure here was stale.
 * Live `GET /v1/rate-limit/status` on our actual key returned
 * `{ limit: 200, remaining: 200, window: "1 minute" }`; one real
 * `transcribe()` call afterward dropped `remaining` to 199, confirming the
 * endpoint tracks real consumption accurately, not just a static ceiling.
 * **Actual limit: 200 req/min, not 5.** Keep re-checking this — don't trust
 * either number blindly; call `rateLimitStatus()` and read what it says.
 *
 * Token cost holds up under fresh measurement, though: that same real call
 * billed 330 prompt + 7 completion = 337 total tokens — consistent with the
 * ~334 flat-per-request figure below regardless of clip length. The 100k
 * monthly token cap (and the ~299-total-requests-for-the-month figure it
 * implies) has NOT been independently re-verified this session — re-running
 * that check would mean burning real quota just to measure the ceiling, which
 * defeats the point. Treat it as the best available estimate, not confirmed
 * fresh like the rate limit above.
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

function apiKey(): string {
  const key = process.env.MERALION_API_KEY;
  if (!key) throw new Error('MERALION_API_KEY is not set — see .env.example');
  return key;
}

interface TranscriptionResponse {
  choices: { message: { content: string } }[];
}

/**
 * @param audioBase64 raw base64, NO data-URI prefix — this function adds
 *                    `data:audio/wav;base64,` itself.
 *
 * ⚠️ Costs real quota (see MONTHLY_REQUEST_BUDGET above) — never call this
 * from routine dev/test loops. FixtureStt is the default for a reason.
 */
export async function transcribe(audioBase64: string): Promise<TranscribeResult> {
  const audioUrl = `data:audio/wav;base64,${audioBase64}`;

  const res = await fetch(`${MERALION_BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ audio_url: audioUrl, model: MERALION_MODEL }),
  });

  if (!res.ok) {
    throw new Error(`MERaLiON transcribe failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as TranscriptionResponse;
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error(`MERaLiON transcribe: unexpected response shape: ${JSON.stringify(body)}`);
  }

  return { text, raw: body };
}

/** GET /v1/models — no key needed, no quota cost. Cheap "is MERaLiON up" check for the demo. */
export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${MERALION_BASE}/v1/models`);
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /v1/rate-limit/status — run this as soon as the key exists, and before any transcribe() spend. */
export async function rateLimitStatus(): Promise<unknown> {
  const res = await fetch(`${MERALION_BASE}/v1/rate-limit/status`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`MERaLiON rate-limit/status failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
