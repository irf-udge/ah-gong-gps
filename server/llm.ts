// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// The two Claude calls. Model: claude-opus-5.
//
//   1. extractDestination — in the interactive loop, so run it at
//      output_config.effort = "low". The task is trivial extraction.
//   2. rewriteToSteps — quality-critical, default effort.
//
// Both use structured outputs (output_config.format). Prompt-cache the stable
// system prompt and put the volatile landmark list LAST so the cached prefix
// survives between requests.
//
// Before implementing, read the Anthropic SDK docs for exact bindings rather
// than guessing them — the parameter shapes below are documented, the SDK
// method names are not guessed here on purpose.

import type { Lang, Landmark, Manoeuvre, Place, Step } from '../src/core/types';

export const MODEL = 'claude-opus-5';

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
 * Pull the destination phrase out of a transcript. The user will not say a
 * formal address — expect "the hospital where my doctor is", "the wet market
 * near my block", "TTSH".
 *
 * Resolution to coordinates is OneMap's job, not the model's. This call must
 * NOT invent an address.
 */
export async function extractDestination(
  _transcript: string,
  _nearbyContext: readonly Place[],
): Promise<ExtractionResult> {
  throw new Error('NOT_IMPLEMENTED: llm.extractDestination');
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

/**
 * Route + landmarks → short, plain, landmark-anchored spoken steps.
 *
 * Hard constraints for the system prompt:
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
  _manoeuvres: readonly Manoeuvre[],
  _landmarks: readonly Landmark[],
  _lang: Lang,
): Promise<Step[]> {
  throw new Error('NOT_IMPLEMENTED: llm.rewriteToSteps');
}
