// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// THE DIFFERENTIATOR. OneMap has no barrier-free or covered-wayfinding route
// option (routeType is only walk|drive|pt|cycle), so an "elderly-friendly
// route" is something we COMPUTE, not something we request.
//
// Strategy: generate several candidate routes via waypoints, score each on
// comfort, pick the best, and keep the losers for the judge view.
//
// PURE except generateCandidates (which needs the routing provider).

import type {
  ComfortScore,
  ComfortWeights,
  Lang,
  LatLng,
  Poi,
  RouteCandidate,
  ScoredRoute,
} from './types';
import type { RoutingProvider } from '../providers/types';

// ─── Tuning ──────────────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: ComfortWeights = {
  shelter: 1.0,
  rest: 0.6,
  toilet: 0.3,
  gap: 0.8,
  distance: 0.5,
  stairs: 0.7,
};

/** A path point counts as sheltered within this distance of a covered linkway. */
export const SHELTER_RADIUS_M = 25;
/** A bench counts as a rest point within this distance of the path. */
export const REST_RADIUS_M = 20;
export const TOILET_RADIUS_M = 30;

/** Reject a waypoint variant that detours more than this multiple of the direct route. */
export const MAX_DETOUR_RATIO = 1.35;
/** Hard cap on candidates — each costs 2 OneMap routing calls. */
export const MAX_CANDIDATES = 4;

// ─── Candidate generation ────────────────────────────────────────────────────

/**
 * Produce the direct route plus up to MAX_CANDIDATES-1 waypoint variants.
 *
 * Waypoints are sampled from `amenities` (shelter nodes, bench clusters) and
 * accepted only when dist(O,W) + dist(W,D) <= MAX_DETOUR_RATIO * dist(O,D).
 * Issue the OneMap calls in PARALLEL — serially this blows the latency budget.
 */
export async function generateCandidates(
  _origin: LatLng,
  _destination: LatLng,
  _routing: RoutingProvider,
  _amenities: readonly Poi[],
): Promise<RouteCandidate[]> {
  throw new Error('NOT_IMPLEMENTED: comfort.generateCandidates');
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Score one candidate. Higher is better; only meaningful relative to siblings.
 *
 *   score =  w.shelter  * shelterCoverage
 *          + w.rest     * min(restPoints, 3) / 3
 *          + w.toilet   * (toiletsNear > 0 ? 1 : 0)
 *          - w.gap      * norm(longestUnshelteredRunM)
 *          - w.distance * norm(extraDistanceM)
 *          - w.stairs   * stairsCount
 */
export function scoreRoute(
  _candidate: RouteCandidate,
  _amenities: readonly Poi[],
  _directDistanceM: number,
  _weights: ComfortWeights = DEFAULT_WEIGHTS,
): ComfortScore {
  throw new Error('NOT_IMPLEMENTED: comfort.scoreRoute');
}

/**
 * Plain-language justification, e.g. "这条路大部分有盖，中途有两张长椅。"
 *
 * TEMPLATE-GENERATED from the numbers in `score`. The LLM never writes this —
 * that keeps the hallucination surface at exactly zero and costs no tokens.
 * Templates live in src/phrases/ (owner B).
 */
export function describeScore(_score: ComfortScore, _lang: Lang): string {
  throw new Error('NOT_IMPLEMENTED: comfort.describeScore');
}

/** Sort by total desc. Returns [winner, ...losers]; losers feed the judge view. */
export function rankRoutes(_scored: readonly ScoredRoute[]): ScoredRoute[] {
  throw new Error('NOT_IMPLEMENTED: comfort.rankRoutes');
}
