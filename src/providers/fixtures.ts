// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// The on-stage kill switch. With DEMO_MODE=1 every provider resolves from
// fixtures/ and the app makes ZERO network calls. Rehearse with this on.
//
// These are also what unblock B and C on day one: both can build a complete
// working app against fixtures before a single real API key exists.
//
// ⚠️ For a FULL demo journey (not just individual provider calls), don't
// route through core/comfort.ts + server/llm.ts at all — call
// buildDemoJourney() below directly. That's the one thing this file adds
// beyond satisfying the five provider interfaces: an already-assembled,
// fully-typed Journey straight from the fixture, for whoever wires up
// journey/machine.ts's demo-mode path (owner C) to call instead of hitting
// POST /api/journey.

import fixture from '../../fixtures/demo-route.json';
import { haversineM } from '../core/geo';
import type {
  BBox,
  Building,
  Journey,
  Lang,
  Landmark,
  LatLng,
  Place,
  Poi,
  RouteCandidate,
  ScoredRoute,
  Step,
} from '../core/types';
import type { PlaceProvider, RoutingProvider, SttProvider, Transcription } from './types';

/** Typed view of fixtures/demo-route.json. Shape is documented in CONTRACTS.md § Fixtures. */
export const DEMO_FIXTURE = fixture;

/** Fixture only has zh/ms content — anything else falls back to zh rather than throwing. */
function demoLang(lang: Lang): 'zh' | 'ms' {
  return lang === 'ms' ? 'ms' : 'zh';
}

// ─── Places ──────────────────────────────────────────────────────────────────

/** A landmark that plausibly reads as a "building" for reverseGeocode's purposes. */
function landmarkToBuilding(l: Landmark): Building {
  return {
    buildingName: l.name,
    block: l.kind === 'block' ? l.name.replace(/^Block\s*/i, '') : null,
    road: null,
    postal: null,
    at: l.at,
  };
}

export class FixturePlaces implements PlaceProvider {
  readonly name = 'fixture';

  /** Always resolves to the one canned destination — this is a demo, not a real search index. */
  async search(_query: string): Promise<Place[]> {
    return [DEMO_FIXTURE.destination];
  }

  /**
   * Real reverseGeocode returns nearby BUILDINGS (see CONTRACTS.md § 2.2 —
   * `BUILDINGNAME` null for unnamed HDB blocks). Here: every fixture landmark
   * within `bufferM` of `at`, shaped like a Building. Good enough to make the
   * "I'm lost" re-anchor flow demoable without a network call.
   */
  async reverseGeocode(at: LatLng, bufferM: number): Promise<Building[]> {
    return DEMO_FIXTURE.landmarks
      .filter((l) => haversineM(at, l.at) <= bufferM)
      .map((l) => landmarkToBuilding(l as Landmark));
  }

  /**
   * `queryName` is ignored — the fixture has one corridor's worth of
   * amenities, not per-theme data. Returns everything inside `bbox`.
   */
  async theme(_queryName: string, bbox: BBox): Promise<Poi[]> {
    return DEMO_FIXTURE.amenities.filter(
      (p) =>
        p.at.lat >= bbox.minLat &&
        p.at.lat <= bbox.maxLat &&
        p.at.lng >= bbox.minLng &&
        p.at.lng <= bbox.maxLng,
    ) as Poi[];
  }
}

// ─── Routing ─────────────────────────────────────────────────────────────────

export class FixtureRouting implements RoutingProvider {
  readonly name = 'fixture';

  /** Ignores from/to — always replays the one baked, pre-scored route. */
  async walkRoute(_from: LatLng, _to: LatLng): Promise<RouteCandidate> {
    return DEMO_FIXTURE.route as RouteCandidate;
  }
}

// ─── Speech in ───────────────────────────────────────────────────────────────

/** Replays a canned transcript so the pipeline runs with no microphone at all. */
export class FixtureStt implements SttProvider {
  readonly name = 'fixture';

  async transcribe(_wav: Blob, lang: Lang): Promise<Transcription> {
    return { text: DEMO_FIXTURE.transcript[demoLang(lang)], confidence: 1 };
  }
}

// ─── Full-journey assembly (bypasses comfort.ts + server/llm.ts entirely) ────

/**
 * The winning route, fully assembled straight from the fixture — what a real
 * POST /api/journey would return, for `lang`, with zero computation and zero
 * network calls.
 */
export function buildDemoScoredRoute(lang: Lang): ScoredRoute {
  const l = demoLang(lang);
  return {
    candidate: DEMO_FIXTURE.route as RouteCandidate,
    score: DEMO_FIXTURE.score,
    rationale: DEMO_FIXTURE.rationale[l],
  };
}

/** The losing candidate(s) — feeds the judge view (`?judge=1`), same as a real response's `rejected`. */
export function buildDemoRejected(lang: Lang): ScoredRoute[] {
  const l = demoLang(lang);
  return DEMO_FIXTURE.rejected.map((r) => ({
    candidate: r.candidate as RouteCandidate,
    score: r.score,
    rationale: r.rationale[l],
  }));
}

/**
 * A complete, ready-to-play Journey for `lang` — origin, destination, the
 * scored winning route, every allowed landmark, and the spoken steps.
 * Call this directly for the demo-mode journey-planning path; it deliberately
 * does not touch core/comfort.ts or server/llm.ts (no candidate generation,
 * no LLM rewrite) — that machinery is exercised for real once CP2/CP3 land,
 * this is the zero-network stand-in for CP1.
 */
export function buildDemoJourney(lang: Lang): Journey {
  const l = demoLang(lang);
  return {
    id: 'demo-journey',
    lang,
    origin: DEMO_FIXTURE.origin,
    destination: DEMO_FIXTURE.destination,
    route: buildDemoScoredRoute(lang),
    landmarks: DEMO_FIXTURE.landmarks as Landmark[],
    steps: DEMO_FIXTURE.steps[l] as Step[],
  };
}
