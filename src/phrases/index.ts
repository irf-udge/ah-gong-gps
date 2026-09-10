// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Every fixed string the app can SPEAK. Two reasons this is a phrase book and
// not LLM output:
//   1. Speed — a clarifying question must come back instantly, not after a
//      round trip.
//   2. Safety — templated text cannot hallucinate. The comfort rationale and
//      the fallback steps both go through here for exactly that reason.
//
// Slots are `{name}` and filled by fill(). Keep PhraseBook exhaustive: adding a
// key to zh without adding it to ms is a type error, which is the point.

export interface PhraseBook {
  // Conversation
  tapToSpeak: string;
  listening: string;
  /** Shown once recording stops and we're waiting on transcription — a distinct state from `listening`, so silence never reads as broken. */
  thinking: string;
  sayAgain: string;
  notUnderstood: string;
  /** ErrorScreen's recovery button — resets to idle/home, distinct from sayAgain (which re-listens immediately). */
  tryAgain: string;
  /** {place} */
  confirmDestination: string;
  /** {place} */
  planning: string;

  // Journey
  /** {landmark} */
  walkTo: string;
  thenTurnLeft: string;
  thenTurnRight: string;
  thenStraight: string;
  /** {landmark} */
  crossAt: string;
  arrived: string;
  /** {landmark} */
  youAreNear: string;
  recalculating: string;
  /** ArrivedScreen's "start a new journey" button. */
  goHome: string;

  // Comfort rationale (assembled by core/comfort.describeScore)
  mostlySheltered: string;
  partlySheltered: string;
  /** {n} */
  benchesAlongTheWay: string;
  toiletOnTheWay: string;
  shortestWalk: string;
}

export type Slots = Record<string, string | number>;

/** Replace every `{key}` in `template` with the matching slot value. */
export function fill(template: string, slots: Slots = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = slots[key];
    return value === undefined ? whole : String(value);
  });
}

export { zh } from './zh.js';
export { ms } from './ms.js';
