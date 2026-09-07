// OWNER: C (Journey experience) — do not edit unless you are the owner.
//
// The journey state machine.
//
//   idle ─tap─▶ listening ─audio─▶ resolving ─┬─ok────▶ planning ─▶ ready
//                   ▲                          └─ambiguous─▶ clarifying ─┐
//                   └──────────────────────────────────────────────────┘
//   ready ─start─▶ navigating ─geofence×N─▶ arrived
//   navigating ─"I'm lost"─▶ lost ─reanchor─▶ navigating
//
// The clarification loop is a FEATURE, not an error path — demo it explicitly.
// Any state can fall back to `listening` via "say it again"; assume
// mis-transcription everywhere.

import type { Journey, JourneyState, Lang, Position, Step } from '../core/types';

export type JourneyEvent =
  | { type: 'TAP_SPEAK' }
  | { type: 'TRANSCRIPT'; text: string }
  | { type: 'RESOLVED'; journey: Journey }
  | { type: 'CLARIFY'; question: string }
  | { type: 'SAY_AGAIN' }
  | { type: 'START_JOURNEY' }
  | { type: 'POSITION'; position: Position }
  | { type: 'STEP_ADVANCE'; index: number }
  | { type: 'IM_LOST' }
  | { type: 'REANCHORED'; journey: Journey | null }
  | { type: 'ARRIVED' }
  | { type: 'ERROR'; message: string };

export const initialState: JourneyState = {
  phase: 'idle',
  journey: null,
  currentStepIndex: 0,
  transcript: null,
  clarifyQuestion: null,
  error: null,
};

/** Pure reducer — unit-test the whole flow with no DOM and no network. */
export function reduce(_state: JourneyState, _event: JourneyEvent): JourneyState {
  throw new Error('NOT_IMPLEMENTED: machine.reduce');
}

/**
 * Decide whether a new position should advance the step.
 *
 * Rules that matter more than they look:
 *   · monotonic — never move backwards on its own
 *   · hysteresis — must exit GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M before
 *     the next fence can arm, or GPS jitter re-fires the same step
 *   · debounce — one advance per fence entry, not one per position sample
 */
export function shouldAdvance(
  _position: Position,
  _steps: readonly Step[],
  _currentIndex: number,
  _journey: Journey,
): number | null {
  throw new Error('NOT_IMPLEMENTED: machine.shouldAdvance');
}

/** Which language to listen and speak in. Demo ships zh + ms. */
export function resolveLang(_state: JourneyState): Lang {
  throw new Error('NOT_IMPLEMENTED: machine.resolveLang');
}
