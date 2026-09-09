// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// The two LLM calls, on the Gemini API (Google AI Studio) — free tier, not
// Anthropic.
//
// ⚠️ MODEL CHOICE WAS LIVE-TESTED, NOT TAKEN FROM DOCS. ai.google.dev's own
// pricing page (fetched 2026-09-09) listed the whole gemini-2.5-* line as
// free-tier-eligible. It's wrong for a real key: every 2.5 model (flash-lite,
// flash, pro) 404s for this project with "no longer available to new users."
// Docs lag live rollouts — the actual model list was found by probing the
// real API with the real key (see git history for the probe scripts), not by
// reading more documentation.
//
// Verified working, live, on 2026-09-09: gemini-3.5-flash-lite,
// gemini-3.5-flash, gemini-3.1-flash-lite, gemini-3-flash-preview.
// gemini-3.8-flash returned 503 "high demand" — exists, just not reliably
// available; not worth depending on for a demo. gemini-2.0-flash is fully
// removed (as expected — Google's deprecation notice pointed here too).
//
// Both calls use gemini-3.5-flash-lite, not a cheap/quality split. Measured
// structured-output latency, same prompt shape as the real calls below:
//   gemini-3.5-flash        ~6-7s even with thinkingConfig.thinkingBudget: 0
//   gemini-3.5-flash-lite   ~1.2-1.7s, consistent across repeated calls
// 6-7s is a real risk standing in front of judges; 1.2-1.7s isn't. The
// rewrite task is deliberately short, simple, landmark-anchored sentences —
// that's a product requirement (see CONTRACTS.md § UI rules), not a
// simplification made to accommodate a weaker model, so the lite tier's
// quality ceiling was never actually the constraint here.
//
// Structured output: `responseMimeType: 'application/json'` +
// `responseJsonSchema` (NOT the older `responseSchema` + proprietary `Type`
// enum shape — that's still supported but responseJsonSchema takes a PLAIN
// JSON Schema object directly, which is what buildStepSchema() below already
// produces). Verified in node_modules/@google/genai/dist/node/*.d.ts AND live
// — the landmark_id enum constraint was tested end to end against the real
// fixture data and holds (every returned landmark_id was in the supplied set).
//
// Get a key at https://aistudio.google.com/apikey. Google's rate-limits page
// refuses to publish fixed RPM/RPD numbers — "depend on your usage tier... viewed
// in Google AI Studio" — check yours at https://aistudio.google.com/rate-limit.

import { GoogleGenAI } from '@google/genai';
import type { Action, Lang, Landmark, Manoeuvre, Place, Step, Violation } from '../src/core/types';
import { localisedName } from '../src/core/landmarks.js';

export const EXTRACTION_MODEL = 'gemini-3.5-flash-lite';
export const REWRITE_MODEL = 'gemini-3.5-flash-lite';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set — see .env.example');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const LANG_NAMES: Record<Lang, string> = {
  zh: 'Mandarin Chinese',
  ms: 'Malay',
  en: 'English',
  ta: 'Tamil',
};

// ─── Destination extraction ──────────────────────────────────────────────────

export interface ExtractionResult {
  /** The place phrase as the user said it, e.g. "我女儿的家", "TTSH". */
  destinationPhrase: string | null;
  /** Detected language of the utterance. */
  lang: Lang;
  /** false when the utterance was not a destination request at all. */
  isDestinationRequest: boolean;
}

/**
 * Gemini's backend JSON Schema support is what's verified here (the .d.ts's
 * `enum?: string[]` field on a plain `type: 'string'`) — no dependency on
 * whether nullable unions (`type: ['string','null']`) work on this backend,
 * since that wasn't verified. `destinationPhrase` uses an empty string as
 * the "nothing extracted" sentinel instead; translated to `null` below.
 */
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['destinationPhrase', 'lang', 'isDestinationRequest'],
  properties: {
    destinationPhrase: { type: 'string' },
    lang: { type: 'string', enum: ['zh', 'ms', 'en', 'ta'] },
    isDestinationRequest: { type: 'boolean' },
  },
} as const;

/**
 * Pull the destination phrase out of a transcript. The user will not say a
 * formal address — expect "the hospital where my doctor is", "the wet market
 * near my block", "TTSH".
 *
 * Resolution to coordinates is OneMap's job, not the model's. This call must
 * NOT invent an address.
 */
export async function extractDestination(
  transcript: string,
  nearbyContext: readonly Place[],
): Promise<ExtractionResult> {
  const ai = getClient();

  const contextLines = nearbyContext
    .slice(0, 8)
    .map((p) => `- ${p.name} (${p.address})`)
    .join('\n');

  const prompt = [
    "You are extracting a destination request from a Singaporean senior's spoken utterance.",
    'They will NOT say a formal address — expect vague phrases like "the wet market near my block" or "TTSH".',
    'Extract the destination phrase EXACTLY as implied by their words. Do not invent, expand, or resolve it to a real address — that is a separate lookup step, not your job.',
    'If the utterance is not a destination request at all (greeting, silence, unrelated chatter), set isDestinationRequest to false and destinationPhrase to "".',
    'Detect the language of the utterance: zh (Mandarin), ms (Malay), en (English), or ta (Tamil).',
    '',
    'Nearby places, for context only — do NOT copy one of these unless the user is clearly referring to it:',
    contextLines || '(none)',
    '',
    `Utterance: """${transcript}"""`,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: EXTRACTION_MODEL,
    contents: prompt,
    // No thinkingConfig: gemini-3.5-flash-lite returns a flat 400
    // "invalid argument" for thinkingBudget: 0 specifically (tested directly —
    // isolated from the schema, which was fine on its own; -1/omitted both
    // work). The SDK's own .d.ts warned allowed ranges are model-dependent;
    // this is that in practice. Omitting it is already fast (~1.2-1.7s
    // measured) so there's nothing to gain by fighting for a lower budget.
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: EXTRACTION_SCHEMA,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error('extractDestination: empty response from Gemini');

  const parsed = JSON.parse(raw) as {
    destinationPhrase: string;
    lang: Lang;
    isDestinationRequest: boolean;
  };

  return {
    destinationPhrase: parsed.destinationPhrase.trim() === '' ? null : parsed.destinationPhrase,
    lang: parsed.lang,
    isDestinationRequest: parsed.isDestinationRequest,
  };
}

// ─── Instruction rewrite ─────────────────────────────────────────────────────

/**
 * Build the JSON schema for the rewrite call.
 *
 * ⚠️ THE WHOLE HALLUCINATION GUARD LIVES IN ONE LINE HERE: `landmark_id` is an
 * ENUM of this route's real landmark ids. The schema literally cannot express
 * an invented landmark. core/validate.ts re-checks anyway (defence in depth),
 * but this is what makes it cheap.
 *
 * Plain JSON Schema on purpose — this exact object is passed straight into
 * Gemini's `responseJsonSchema` (see file header). Provider-agnostic by
 * construction, not because we're keeping a door open to switch back.
 *
 * This function is pure — unit-test it.
 */
export function buildStepSchema(landmarks: readonly Landmark[]) {
  const ids = landmarks.map((l) => l.id);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['steps'],
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'landmark_id', 'action', 'spoken_text', 'display_text'],
          properties: {
            index: { type: 'integer' },
            landmark_id: { type: 'string', enum: ids },
            action: {
              type: 'string',
              enum: ['start', 'straight', 'left', 'right', 'cross', 'arrive'],
            },
            spoken_text: { type: 'string' },
            display_text: { type: 'string' },
          },
        },
      },
    },
  } as const;
}

interface RawStep {
  index: number;
  landmark_id: string;
  action: Action;
  spoken_text: string;
  display_text: string;
}

/**
 * Route + landmarks → short, plain, landmark-anchored spoken steps.
 *
 * Hard constraints for the prompt:
 *   · use ONLY landmarks supplied in this request — never invent one
 *   · emit proper nouns VERBATIM; never translate "NTUC" or "AMK Hub"
 *   · no street names, no distances in metres — seniors navigate by landmarks,
 *     and distance prompts cause anxiety rather than clarity
 *   · one short sentence per step
 *
 * The caller MUST pass the result through core/validate.validateSteps before
 * anything is spoken. On a second failure, fall back to validate.templateSteps.
 *
 * `feedback` is CONTRACTS.md's "retry once with the violations fed back" —
 * pass `validateSteps()`'s violations from the first attempt and this appends
 * them to the prompt as concrete corrections instead of just repeating the
 * same instructions and hoping for a different result.
 */
export async function rewriteToSteps(
  manoeuvres: readonly Manoeuvre[],
  landmarks: readonly Landmark[],
  lang: Lang,
  feedback?: readonly Violation[],
): Promise<Step[]> {
  const ai = getClient();
  const schema = buildStepSchema(landmarks);

  const landmarkLines = landmarks
    .map(
      (l) =>
        `- id="${l.id}" name="${localisedName(l, lang)}" kind=${l.kind} ~${Math.round(l.distanceM)}m away, bearing ${Math.round(l.bearingDeg)}°`,
    )
    .join('\n');
  const manoeuvreLines = manoeuvres
    .map((m) => `- index=${m.index} action=${m.action} at=${m.at.lat.toFixed(5)},${m.at.lng.toFixed(5)}`)
    .join('\n');

  const feedbackLines = feedback?.length
    ? [
        '',
        'Your previous attempt had these problems — fix ALL of them this time:',
        ...feedback.map((v) => `- ${v.kind}${v.stepIndex !== undefined ? ` (step ${v.stepIndex})` : ''}: ${v.detail}`),
      ].join('\n')
    : '';

  const prompt = [
    `Write walking directions in ${LANG_NAMES[lang]} for an elderly Singaporean, one short sentence per manoeuvre.`,
    '',
    'HARD RULES:',
    "- Use ONLY the landmarks listed below. Never invent one. Each step's landmark_id must be one of the given ids.",
    '- Emit landmark names EXACTLY as given — never translate a proper noun (e.g. keep "NTUC", "AMK Hub" verbatim even inside a Chinese sentence).',
    '- No street names. No distances in metres — seniors navigate by landmarks, not numbers.',
    '- One short, plain sentence per step. No filler, no small talk.',
    '- One step per manoeuvre, in the same order, using the same index.',
    '',
    'Landmarks (use these ids and names only):',
    landmarkLines || '(none supplied)',
    '',
    'Manoeuvres to narrate, in order:',
    manoeuvreLines,
    feedbackLines,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: REWRITE_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error('rewriteToSteps: empty response from Gemini');

  const parsed = JSON.parse(raw) as { steps: RawStep[] };

  return parsed.steps.map((s) => ({
    index: s.index,
    landmarkId: s.landmark_id,
    action: s.action,
    spokenText: s.spoken_text,
    displayText: s.display_text,
  }));
}
