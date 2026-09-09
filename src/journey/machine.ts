// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
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
import { nearestOnPolyline } from '../core/geo';
import { GEOFENCE_HYSTERESIS_M, GEOFENCE_RADIUS_M } from './location';

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

/**
 * Pure reducer — unit-test the whole flow with no DOM and no network.
 *
 * Two universal escape hatches are handled BEFORE the phase-specific switch,
 * per this file's own header: "Any state can fall back to `listening` via
 * 'say it again'; assume mis-transcription everywhere" (SAY_AGAIN) and
 * CONTRACTS.md § UI rules' "Error tolerance everywhere" (ERROR). Every other
 * event only does something from the specific phase(s) shown in the diagram
 * above; anywhere else it's a no-op (returns state unchanged) rather than an
 * error — a stray/duplicate/out-of-order event should never crash the app.
 *
 * ⚠️ `planning` (see the diagram above) is never SET by this function. By the
 * time `RESOLVED` is dispatched, the caller has already run the full
 * pipeline — destination resolution, routing, comfort scoring, landmark
 * collection, step rewriting — so there's nothing left to observe mid-flight;
 * `resolving` jumps straight to `ready`. `planning` stays in `JourneyPhase`
 * as a documented, honest "not reachable via reduce()" case, same spirit as
 * `Lang`'s reserved `en`/`ta`.
 */
export function reduce(state: JourneyState, event: JourneyEvent): JourneyState {
  if (event.type === 'SAY_AGAIN') {
    return { ...state, phase: 'listening', transcript: null, clarifyQuestion: null, error: null };
  }
  if (event.type === 'ERROR') {
    return { ...state, phase: 'error', error: event.message };
  }

  switch (state.phase) {
    case 'idle':
      if (event.type === 'TAP_SPEAK') {
        return { ...state, phase: 'listening', transcript: null, clarifyQuestion: null, error: null };
      }
      return state;

    case 'listening':
      if (event.type === 'TRANSCRIPT') {
        return { ...state, phase: 'resolving', transcript: event.text };
      }
      return state;

    case 'resolving':
      if (event.type === 'RESOLVED') {
        return { ...state, phase: 'ready', journey: event.journey, clarifyQuestion: null, currentStepIndex: 0 };
      }
      if (event.type === 'CLARIFY') {
        return { ...state, phase: 'clarifying', clarifyQuestion: event.question };
      }
      return state;

    case 'clarifying':
      // The diagram's loop back up to `listening` is SAY_AGAIN (handled
      // above) — the orchestration layer dispatches it right after TTS
      // speaks the clarify question, so listening resumes automatically.
      // TAP_SPEAK is deliberately NOT accepted here: it's tied to the
      // iOS-gesture-priming first tap specifically (see
      // ui/screens/HomeScreen.tsx's header) — a re-listen after a spoken
      // question shouldn't need a fresh user gesture.
      return state;

    case 'ready':
      if (event.type === 'START_JOURNEY') {
        return { ...state, phase: 'navigating', currentStepIndex: 0 };
      }
      return state;

    case 'navigating':
      if (event.type === 'STEP_ADVANCE') {
        // Defensive monotonic floor — shouldAdvance() is where this is
        // actually enforced, but this costs nothing and guards against a
        // caller bug regressing the step index mid-demo.
        return { ...state, currentStepIndex: Math.max(state.currentStepIndex, event.index) };
      }
      if (event.type === 'ARRIVED') {
        return { ...state, phase: 'arrived' };
      }
      if (event.type === 'IM_LOST') {
        return { ...state, phase: 'lost' };
      }
      if (event.type === 'POSITION') {
        // A raw position alone changes nothing in JourneyState — the
        // geofence decision lives in shouldAdvance() (kept separate so it
        // stays independently testable); this event only matters once the
        // caller turns its result into a STEP_ADVANCE or ARRIVED dispatch.
        return state;
      }
      return state;

    case 'lost':
      if (event.type === 'REANCHORED') {
        // event.journey is null when no re-route was needed (just a "you're
        // near X" reassurance) — keep the existing journey/progress in that
        // case instead of discarding real progress for nothing.
        return event.journey
          ? { ...state, phase: 'navigating', journey: event.journey, currentStepIndex: 0 }
          : { ...state, phase: 'navigating' };
      }
      return state;

    default:
      // 'planning' (see above), 'arrived', 'error' — nothing advances these
      // except the universal SAY_AGAIN/ERROR handled before this switch.
      return state;
  }
}

/**
 * Decide whether a new position should advance the step.
 *
 * Rules that matter more than they look:
 *   · monotonic — never move backwards on its own. Trivially true here:
 *     the only value ever returned is `currentIndex + 1` or `null`.
 *   · hysteresis — must clear GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M past
 *     the previous manoeuvre before the next fence can arm, or GPS jitter
 *     re-fires the same step.
 *   · debounce — one advance per fence entry, not one per position sample.
 *     Falls out of the surrounding architecture for free, not from anything
 *     this function does: once it returns non-null, the caller dispatches
 *     STEP_ADVANCE, currentIndex moves forward, and the NEXT call checks a
 *     different (later) fence — nothing repeats on the same fence to debounce
 *     because the target itself has moved on.
 *
 * ⚠️ Measures progress along the ROUTE (nearestOnPolyline's distanceAlongM),
 * NOT raw straight-line proximity to the manoeuvre point — per that
 * function's own doc, written for exactly this. This isn't just the
 * jitter-resistance it's documented for: a first version using raw
 * point-to-point distance had a real bug, caught by an end-to-end test with
 * the actual SimulatedProvider — when two consecutive manoeuvres are closer
 * together than GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M (35m default),
 * "within RADIUS of the target AND beyond RADIUS+HYSTERESIS of the previous
 * point" is geometrically IMPOSSIBLE to satisfy simultaneously (triangle
 * inequality), permanently stalling navigation at that step — and this isn't
 * a rare edge case: the real demo route's tightest real gap (40.8 m,
 * straight-line) sits close enough to the 35 m threshold that a slightly
 * different route could easily fall under it. Scalar progress values don't
 * have that failure mode: any threshold along a line is always reachable by
 * continuing to walk forward, however physically close two manoeuvres are.
 */
export function shouldAdvance(
  position: Position,
  steps: readonly Step[],
  currentIndex: number,
  journey: Journey,
): number | null {
  const manoeuvres = journey.route.candidate.manoeuvres;
  const polyline = journey.route.candidate.polyline;
  const nextIndex = currentIndex + 1;

  // Nothing left to advance to — arrival is a separate signal (proximity to
  // journey.destination), not this function's job.
  if (nextIndex >= steps.length || nextIndex >= manoeuvres.length) return null;

  const target = manoeuvres[currentIndex];
  if (!target) return null;

  const walkerSnap = nearestOnPolyline(position.at, polyline);
  const targetSnap = nearestOnPolyline(target.at, polyline);
  if (!walkerSnap || !targetSnap) return null;

  if (walkerSnap.distanceAlongM < targetSnap.distanceAlongM - GEOFENCE_RADIUS_M) return null;

  if (currentIndex > 0) {
    const previous = manoeuvres[currentIndex - 1];
    const previousSnap = previous ? nearestOnPolyline(previous.at, polyline) : null;
    if (previousSnap && walkerSnap.distanceAlongM <= previousSnap.distanceAlongM + GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M) {
      return null; // hasn't made clear forward progress past the previous manoeuvre yet
    }
  }

  return nextIndex;
}

/** matches FixtureStt's own fallback — see providers/fixtures.ts */
const DEFAULT_LANG: Lang = 'zh';

/**
 * Which language to listen and speak in. Demo ships zh + ms.
 *
 * Sourced from the active journey (set once resolution/extraction detects
 * it) — before a journey exists there's no signal to go on yet, so this
 * falls back to DEFAULT_LANG rather than guessing from anything in
 * JourneyState, which carries no language field of its own.
 */
export function resolveLang(state: JourneyState): Lang {
  return state.journey?.lang ?? DEFAULT_LANG;
}
