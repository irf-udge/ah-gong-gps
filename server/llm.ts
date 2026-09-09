// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// The two LLM calls, on the Gemini API (Google AI Studio) — free tier, not
// Anthropic. Verified against the real installed SDK before writing this,
// not from training memory: @google/genai v2.21.0's actual .d.ts, and
// ai.google.dev's live pricing/model pages (fetched 2026-09-09). Google's own
// rate-limits page explicitly refuses to publish fixed RPM/RPD numbers —
// "depend on your usage tier... viewed in Google AI Studio" — so there's no
// generic number to record here the way MERaLiON's /keys/usage gave one.
// Get a key at https://aistudio.google.com/apikey, then check your real
// limits at https://aistudio.google.com/rate-limit once you have one.
//
//   1. extractDestination — gemini-2.5-flash-lite, thinkingBudget: 0. Trivial
//      extraction task, runs in the interactive loop — speed over depth.
//   2. rewriteToSteps — gemini-2.5-flash, thinking left at its default.
//      Quality-critical.
//
// Both models confirmed free-tier-eligible on ai.google.dev/gemini-api/docs/
// pricing as of 2026-09-09. gemini-2.0-flash is NOT used here — it's being
// deprecated (2026-06-01) and Google's own docs point migrators at 2.5-flash.
//
// Structured output: `responseMimeType: 'application/json'` +
// `responseJsonSchema` (NOT the older `responseSchema` + proprietary `Type`
// enum shape — that's still supported but responseJsonSchema takes a PLAIN
// JSON Schema object directly, which is what buildStepSchema() below already
// produces. Verified in node_modules/@google/genai/dist/node/*.d.ts: since
// SDK v1.9.0 the backend has native JSON Schema support and a JSON-Schema-
// shaped `responseSchema` is auto-relocated to responseJsonSchema anyway —
// this code sets the field explicitly rather than lean on that migration
// shim.
//
// ⚠️ `thinkingBudget: 0` is documented as "0 is DISABLED", but the SDK's own
// .d.ts adds "the default values and allowed ranges are model dependent" —
// if gemini-2.5-flash-lite ever rejects 0 outright, that's a live API error
// to fix by raising the budget, not a silent-wrong-behaviour risk.

import { GoogleGenAI } from '@google/genai';
import type { Action, Lang, Landmark, Manoeuvre, Place, Step } from '../src/core/types';

export const EXTRACTION_MODEL = 'gemini-2.5-flash-lite';
export const REWRITE_MODEL = 'gemini-2.5-flash';

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

/**
 * Prefer the curated nameZh/nameMs when present, else the verbatim English
 * name. This is deliberately simple, local to prompt-building — the fuller
 * version of this logic (with more sourcing rules) is core/landmarks.ts's
 * localisedName, which is a separate NOT_IMPLEMENTED stub; don't call into
 * it from here, it isn't built yet.
 */
function landmarkDisplayName(l: Landmark, lang: Lang): string {
  if (lang === 'zh' && l.nameZh) return l.nameZh;
  if (lang === 'ms' && l.nameMs) return l.nameMs;
  return l.name;
}

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
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: EXTRACTION_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
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
 */
export async function rewriteToSteps(
  manoeuvres: readonly Manoeuvre[],
  landmarks: readonly Landmark[],
  lang: Lang,
): Promise<Step[]> {
  const ai = getClient();
  const schema = buildStepSchema(landmarks);

  const landmarkLines = landmarks
    .map(
      (l) =>
        `- id="${l.id}" name="${landmarkDisplayName(l, lang)}" kind=${l.kind} ~${Math.round(l.distanceM)}m away, bearing ${Math.round(l.bearingDeg)}°`,
    )
    .join('\n');
  const manoeuvreLines = manoeuvres
    .map((m) => `- index=${m.index} action=${m.action} at=${m.at.lat.toFixed(5)},${m.at.lng.toFixed(5)}`)
    .join('\n');

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
