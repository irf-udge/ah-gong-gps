// Unit tests for journey/machine.ts — the pure reducer (reduce) and the
// geofence-advance decision (shouldAdvance). No DOM, no network — this
// file's own doc: "Pure reducer — unit-test the whole flow with no DOM and
// no network."

import { describe, it, expect } from 'vitest';
import { initialState, reduce, shouldAdvance } from './machine';
import { GEOFENCE_HYSTERESIS_M, GEOFENCE_RADIUS_M } from './location';
import type { Journey, JourneyState, Place, Position, Step } from '../core/types';

function makePlace(id: string, lat: number, lng: number): Place {
  return { id, name: id, address: '', postal: null, block: null, road: null, at: { lat, lng } };
}

const ORIGIN = { lat: 1.369, lng: 103.848 };
const DEST = makePlace('dest', 1.3696, 103.8497);

/** ~metres per degree of latitude — good enough for straight-line synthetic fixtures. */
const M_PER_DEG_LAT = 111_320;

function makeJourney(manoeuvreCount: number, spacingM = 100): Journey {
  // A straight line north, one manoeuvre every `spacingM` metres, so the
  // route is long enough that the fine geofence math below has room to work.
  const polyline = Array.from({ length: manoeuvreCount + 1 }, (_, i) => ({
    lat: ORIGIN.lat + (spacingM * i) / M_PER_DEG_LAT,
    lng: ORIGIN.lng,
  }));
  // shouldAdvance() checks `manoeuvres[currentIndex]` as the fence the walker
  // must reach to advance PAST currentIndex — so manoeuvre i sits AHEAD of
  // the route's start, at polyline[i + 1], never at polyline[0] itself
  // (which is the origin, before any instruction has been completed).
  const manoeuvres = polyline.slice(1).map((at, index) => ({
    index,
    at,
    action: 'straight' as const,
    rawInstruction: '',
    distanceM: spacingM,
  }));
  const steps: Step[] = manoeuvres.map((m) => ({
    index: m.index,
    landmarkId: `m${m.index}:l`,
    action: m.action,
    spokenText: `step ${m.index}`,
    displayText: `step ${m.index}`,
  }));
  return {
    id: 'j1',
    lang: 'zh',
    origin: ORIGIN,
    destination: DEST,
    route: {
      candidate: { id: 'r1', polyline, manoeuvres, totalDistanceM: spacingM * manoeuvreCount, totalTimeS: 0, viaWaypoint: null },
      score: { total: 0, shelterCoverage: 0, restPoints: 0, toiletsNear: 0, longestUnshelteredRunM: 0, extraDistanceM: 0, stairsCount: 0 },
      rationale: '',
    },
    landmarks: [],
    steps,
  };
}

function position(lat: number, lng: number): Position {
  return { at: { lat, lng }, accuracyM: 5, timestamp: Date.now() };
}

// ─── reduce() ────────────────────────────────────────────────────────────────

describe('reduce — universal escape hatches', () => {
  it('SAY_AGAIN resets to listening and clears transcript/clarify state from ANY phase', () => {
    const midJourney: JourneyState = { ...initialState, phase: 'navigating', currentStepIndex: 3, transcript: 'hi' };
    const next = reduce(midJourney, { type: 'SAY_AGAIN' });
    expect(next.phase).toBe('listening');
    expect(next.transcript).toBeNull();
    expect(next.clarifyQuestion).toBeNull();
    expect(next.clarifyCandidates).toEqual([]);
    // currentStepIndex/journey are untouched by SAY_AGAIN — only cleared by RESET.
    expect(next.currentStepIndex).toBe(3);
  });

  it('ERROR sets phase to error with the message, from any phase', () => {
    const next = reduce({ ...initialState, phase: 'navigating' }, { type: 'ERROR', message: 'boom' });
    expect(next.phase).toBe('error');
    expect(next.error).toBe('boom');
  });

  it('RESET wipes back to initialState from any phase', () => {
    const midJourney: JourneyState = { ...initialState, phase: 'arrived', currentStepIndex: 5, journey: makeJourney(2) };
    expect(reduce(midJourney, { type: 'RESET' })).toEqual(initialState);
  });
});

describe('reduce — happy path', () => {
  it('idle -> listening -> resolving -> ready -> navigating -> arrived', () => {
    let state = initialState;
    state = reduce(state, { type: 'TAP_SPEAK' });
    expect(state.phase).toBe('listening');

    state = reduce(state, { type: 'TRANSCRIPT', text: 'go to AMK Hub' });
    expect(state.phase).toBe('resolving');
    expect(state.transcript).toBe('go to AMK Hub');

    const journey = makeJourney(2);
    state = reduce(state, { type: 'RESOLVED', journey });
    expect(state.phase).toBe('ready');
    expect(state.journey).toBe(journey);
    expect(state.currentStepIndex).toBe(0);

    state = reduce(state, { type: 'START_JOURNEY' });
    expect(state.phase).toBe('navigating');

    state = reduce(state, { type: 'ARRIVED' });
    expect(state.phase).toBe('arrived');
  });

  it('resolving -> clarifying (ambiguous) -> ready via a picked candidate', () => {
    let state = reduce(initialState, { type: 'TAP_SPEAK' });
    state = reduce(state, { type: 'TRANSCRIPT', text: 'go to the market' });

    const candidates: Place[] = [makePlace('a', 1.3, 103.8), makePlace('b', 1.31, 103.81)];
    state = reduce(state, { type: 'CLARIFY', question: 'Which one?', candidates });
    expect(state.phase).toBe('clarifying');
    expect(state.clarifyCandidates).toEqual(candidates);

    // Picking a candidate resolves the journey directly from `clarifying` —
    // the real fix this file documents (there was no path for this at all
    // before ClarifyScreen's candidate buttons existed).
    const journey = makeJourney(1);
    state = reduce(state, { type: 'RESOLVED', journey });
    expect(state.phase).toBe('ready');
    expect(state.clarifyQuestion).toBeNull();
    expect(state.clarifyCandidates).toEqual([]);
  });

  it('navigating -> lost -> navigating, with or without a new journey', () => {
    const journey = makeJourney(2);
    let state: JourneyState = { ...initialState, phase: 'navigating', journey, currentStepIndex: 1 };

    state = reduce(state, { type: 'IM_LOST' });
    expect(state.phase).toBe('lost');

    // No re-route needed — keep the existing journey/progress.
    const reassured = reduce(state, { type: 'REANCHORED', journey: null });
    expect(reassured.phase).toBe('navigating');
    expect(reassured.journey).toBe(journey);
    expect(reassured.currentStepIndex).toBe(1);

    // Re-routed — swap in the new journey and restart step progress.
    const newJourney = makeJourney(3);
    const rerouted = reduce(state, { type: 'REANCHORED', journey: newJourney });
    expect(rerouted.phase).toBe('navigating');
    expect(rerouted.journey).toBe(newJourney);
    expect(rerouted.currentStepIndex).toBe(0);
  });
});

describe('reduce — out-of-phase events are safe no-ops', () => {
  it('ignores TRANSCRIPT while idle, START_JOURNEY while listening, etc.', () => {
    expect(reduce(initialState, { type: 'TRANSCRIPT', text: 'x' })).toEqual(initialState);

    const listening = reduce(initialState, { type: 'TAP_SPEAK' });
    expect(reduce(listening, { type: 'START_JOURNEY' })).toEqual(listening);
    expect(reduce(listening, { type: 'ARRIVED' })).toEqual(listening);
  });

  it('STEP_ADVANCE only ever moves the index forward, never backward', () => {
    const state: JourneyState = { ...initialState, phase: 'navigating', currentStepIndex: 3 };
    expect(reduce(state, { type: 'STEP_ADVANCE', index: 1 }).currentStepIndex).toBe(3);
    expect(reduce(state, { type: 'STEP_ADVANCE', index: 5 }).currentStepIndex).toBe(5);
  });
});

// ─── shouldAdvance() ─────────────────────────────────────────────────────────

describe('shouldAdvance', () => {
  it('does not advance while still short of manoeuvres[currentIndex]', () => {
    const journey = makeJourney(2, 100); // manoeuvre 0 sits 100m up the route
    const stillAtStart = position(ORIGIN.lat, ORIGIN.lng);
    expect(shouldAdvance(stillAtStart, journey.steps, 0, journey)).toBeNull();
  });

  it('advances once within GEOFENCE_RADIUS_M of manoeuvres[currentIndex]', () => {
    const journey = makeJourney(2, 100);
    const target = journey.route.candidate.manoeuvres[0]!;
    const atFence = position(target.at.lat, target.at.lng);
    expect(shouldAdvance(atFence, journey.steps, 0, journey)).toBe(1);
  });

  it('never returns an index past the last step or manoeuvre', () => {
    const journey = makeJourney(2, 100);
    const lastManoeuvre = journey.route.candidate.manoeuvres[1]!;
    const atLast = position(lastManoeuvre.at.lat, lastManoeuvre.at.lng);
    // Already on the last manoeuvre — nothing further to advance to (per
    // this function's own doc: arrival is a separate signal, not its job).
    expect(shouldAdvance(atLast, journey.steps, 1, journey)).toBeNull();
  });

  it('applies hysteresis: blocks until clear of the PREVIOUS manoeuvre by RADIUS + HYSTERESIS, even once within RADIUS of the target', () => {
    // Needs a gap tight enough that "within RADIUS of target" and "still
    // within RADIUS+HYSTERESIS of previous" overlap — with the default 100m
    // spacing the two thresholds never overlap at all, so this only shows up
    // on a tight route (see the regression test below for why that matters).
    const tightGap = GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M - 5; // 30m
    const journey = makeJourney(3, tightGap);
    const previous = journey.route.candidate.manoeuvres[0]!; // at +30m

    // 50m along: within RADIUS(25) of the target at 60m (needs >= 35), but
    // still inside previous(30) + RADIUS + HYSTERESIS = 65 — must block.
    const stillHysteresisBlocked = position(previous.at.lat + 20 / M_PER_DEG_LAT, previous.at.lng);
    expect(shouldAdvance(stillHysteresisBlocked, journey.steps, 1, journey)).toBeNull();

    // 66m along: clear of previous + RADIUS + HYSTERESIS (65) — must advance.
    const clearOfHysteresis = position(previous.at.lat + 36 / M_PER_DEG_LAT, previous.at.lng);
    expect(shouldAdvance(clearOfHysteresis, journey.steps, 1, journey)).toBe(2);
  });

  it('regression: resolves via distanceAlongM, not raw point-to-point distance, when manoeuvres sit closer together than RADIUS + HYSTERESIS', () => {
    // This is the exact bug documented in this file's own header: two
    // manoeuvres closer together than GEOFENCE_RADIUS_M + HYSTERESIS used to
    // make "within RADIUS of the target AND beyond RADIUS+HYSTERESIS of the
    // previous" geometrically impossible, permanently stalling navigation —
    // a real bug caught by exactly this kind of end-to-end walk.
    const tightGap = GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M - 5; // 30m — narrower than the combined 35m threshold
    const journey = makeJourney(3, tightGap);
    const totalM = journey.route.candidate.totalDistanceM;

    // Walk 1m-per-tick along the whole route; confirm every advance is
    // monotonic (never fires the same index twice) and the walk is never
    // permanently stuck short of the destination.
    let currentIndex = 0;
    const firedAt: number[] = [];
    for (let d = 0; d <= totalM; d += 1) {
      const pos = position(ORIGIN.lat + d / M_PER_DEG_LAT, ORIGIN.lng);
      const next = shouldAdvance(pos, journey.steps, currentIndex, journey);
      if (next !== null) {
        expect(next).toBe(currentIndex + 1);
        firedAt.push(next);
        currentIndex = next;
      }
    }

    expect(firedAt).toEqual([...new Set(firedAt)]); // no duplicate fires
    // 3 manoeuvres -> shouldAdvance can fire at most twice (0->1, 1->2);
    // reaching manoeuvre 2 itself is "arrival", handled elsewhere.
    expect(currentIndex).toBe(2);
  });
});
