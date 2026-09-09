// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// THE SAFETY GATE. A hallucinated landmark leaves a senior standing at a
// junction looking for a building that does not exist — worse than no app.
//
// Defence in depth:
//   1. The LLM's `landmark_id` field is a per-request ENUM of this route's real
//      ids, so the schema itself cannot express an invented landmark.
//   2. validateSteps() re-checks every id against the supplied set anyway.
//   3. A proper-noun scan catches invented names AND free translation of real
//      ones (the subtler failure — "NTUC" becoming an invented Chinese name).
//   4. On second failure, templateSteps() produces steps that are safe by
//      construction.
//
// NOTHING IS EVER SPOKEN THAT HAS NOT PASSED validateSteps().

import type { Lang, Landmark, Manoeuvre, Step, ValidationResult } from './types';

/**
 * Generic words that may appear in spoken text without being traceable to a
 * landmark — "block", "lift", "MRT", etc. Anything Latin-script and NOT in the
 * lexicon or this allowlist is treated as an invented proper noun.
 */
export const GENERIC_ALLOWLIST: readonly string[] = [
  'block',
  'blk',
  'mrt',
  'lrt',
  'hdb',
  'ntuc',
  'lift',
  'bus',
  'stop',
];

/** Every token the model is permitted to emit, drawn from the real landmarks. */
export function buildLexicon(_landmarks: readonly Landmark[]): Set<string> {
  throw new Error('NOT_IMPLEMENTED: validate.buildLexicon');
}

/**
 * Returns ok:false with every violation found — do not early-return on the
 * first one, the retry prompt is much more effective when it sees them all.
 */
export function validateSteps(
  _steps: readonly Step[],
  _landmarks: readonly Landmark[],
  _expectedStepCount: number,
): ValidationResult {
  throw new Error('NOT_IMPLEMENTED: validate.validateSteps');
}

/**
 * Last-resort steps assembled from templates, e.g. 走到 {landmark}，然后向左转.
 * Safe by construction: the only variable part is a landmark name we already
 * hold. Used when the LLM fails validation twice. Never let a journey die.
 */
export function templateSteps(
  _manoeuvres: readonly Manoeuvre[],
  _landmarks: readonly Landmark[],
  _lang: Lang,
): Step[] {
  throw new Error('NOT_IMPLEMENTED: validate.templateSteps');
}
