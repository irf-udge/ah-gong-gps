// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// THE DIFFERENTIATOR. OneMap has no barrier-free or covered-wayfinding route
// option (routeType is only walk|drive|pt|cycle), so an "elderly-friendly
// route" is something we COMPUTE, not something we request.
//
// Strategy: generate several candidate routes via waypoints, score each on
// comfort, pick the best, and keep the losers for the judge view.
//
// Built on core/geo.ts's turf-backed primitives — see CONTRACTS.md § Geometry
// for why each one was chosen (buffer+points-within-polygon for point
// amenities, sampling+point-to-line-distance for linear shelter data).
//
// PURE except generateCandidates (which needs the routing provider).

import {
  haversineM,
  poisWithinRadius,
  sampleShelterCoverage,
} from './geo';
import { fill, ms, zh, type PhraseBook } from '../phrases';
import type {
  ComfortScore,
  ComfortWeights,
  Lang,
  LatLng,
  Manoeuvre,
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
/** Sample the route every this many metres when measuring shelter coverage. */
export const SHELTER_SAMPLE_STEP_M = 10;

/** Reject a waypoint variant that detours more than this multiple of the direct route. */
export const MAX_DETOUR_RATIO = 1.35;
/** Hard cap on candidates — each costs 2 OneMap routing calls. */
export const MAX_CANDIDATES = 4;
/**
 * Only amenities within this distance of the direct O→D line are considered
 * as waypoint candidates — otherwise we'd detour a senior across town chasing
 * a bench nowhere near their walk.
 */
export const WAYPOINT_CORRIDOR_M = 150;

/** Scale constants for turning raw penalty magnitudes into ~[0,1]-ish units before weighting. */
const NORM_GAP_M = 200;
const NORM_EXTRA_DISTANCE_M = 150;

// ─── Candidate generation ────────────────────────────────────────────────────

/**
 * Produce the direct route plus up to MAX_CANDIDATES-1 waypoint variants.
 *
 * Waypoints are sampled from `amenities` (any kind — shelter, bench, toilet;
 * see core/geo.poisWithinRadius) within WAYPOINT_CORRIDOR_M of the direct
 * O→D line, deduped to a coarse grid so near-identical waypoints don't burn
 * multiple OneMap calls, then pre-filtered by straight-line detour ratio
 * (dist(O,W) + dist(W,D) <= MAX_DETOUR_RATIO * dist(O,D)) BEFORE spending an
 * OneMap call on them — the ratio check is on straight-line distance, so
 * treat it as a cheap plausibility filter, not a hard cap on the real routed
 * distance that comes back afterward.
 *
 * All OneMap calls (the direct route + every accepted waypoint's two legs)
 * are issued in PARALLEL — serially this blows the latency budget.
 */
export async function generateCandidates(
  origin: LatLng,
  destination: LatLng,
  routing: RoutingProvider,
  amenities: readonly Poi[],
): Promise<RouteCandidate[]> {
  const directStraightM = haversineM(origin, destination);

  const directPromise = routing.walkRoute(origin, destination);

  const corridorCandidates =
    directStraightM > 0
      ? poisWithinRadius(amenities, [origin, destination], WAYPOINT_CORRIDOR_M)
      : [];

  // Dedupe to a coarse (~100 m) grid so a cluster of benches doesn't produce
  // several near-identical waypoints competing for the same MAX_CANDIDATES slots.
  const seen = new Set<string>();
  const waypoints: LatLng[] = [];
  for (const poi of corridorCandidates) {
    const key = `${poi.at.lat.toFixed(3)},${poi.at.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const detourM = haversineM(origin, poi.at) + haversineM(poi.at, destination);
    if (detourM > MAX_DETOUR_RATIO * directStraightM) continue;

    waypoints.push(poi.at);
    if (waypoints.length >= MAX_CANDIDATES - 1) break;
  }

  const [direct, ...viaLegs] = await Promise.all([
    directPromise,
    ...waypoints.map((w) => routeViaWaypoint(routing, origin, destination, w)),
  ]);

  if (!direct) throw new Error('generateCandidates: direct route missing');
  return [{ ...direct, id: 'direct', viaWaypoint: null }, ...viaLegs];
}

async function routeViaWaypoint(
  routing: RoutingProvider,
  origin: LatLng,
  destination: LatLng,
  waypoint: LatLng,
): Promise<RouteCandidate> {
  const [legA, legB] = await Promise.all([
    routing.walkRoute(origin, waypoint),
    routing.walkRoute(waypoint, destination),
  ]);
  return mergeLegs(legA, legB, waypoint);
}

function mergeLegs(legA: RouteCandidate, legB: RouteCandidate, waypoint: LatLng): RouteCandidate {
  const offset = legA.manoeuvres.length;
  const manoeuvres: Manoeuvre[] = [
    ...legA.manoeuvres,
    ...legB.manoeuvres.map((m) => ({ ...m, index: m.index + offset })),
  ];

  // Avoid a duplicate vertex at the join when both legs share the waypoint.
  const lastA = legA.polyline[legA.polyline.length - 1];
  const firstB = legB.polyline[0];
  const joinDupe = isSamePoint(lastA, firstB);
  const polyline = joinDupe
    ? [...legA.polyline, ...legB.polyline.slice(1)]
    : [...legA.polyline, ...legB.polyline];

  return {
    id: `via-${waypoint.lat.toFixed(4)},${waypoint.lng.toFixed(4)}`,
    polyline,
    manoeuvres,
    totalDistanceM: legA.totalDistanceM + legB.totalDistanceM,
    totalTimeS: legA.totalTimeS + legB.totalTimeS,
    viaWaypoint: waypoint,
  };
}

function isSamePoint(a: LatLng | undefined, b: LatLng | undefined): boolean {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
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
 *
 * `directDistanceM` should be the DIRECT candidate's actual routed
 * totalDistanceM (from OneMap), not the straight-line distance — that's what
 * makes extraDistanceM mean "metres actually walked beyond the direct route."
 */
export function scoreRoute(
  candidate: RouteCandidate,
  amenities: readonly Poi[],
  directDistanceM: number,
  weights: ComfortWeights = DEFAULT_WEIGHTS,
): ComfortScore {
  const path = candidate.polyline;

  const shelterWays = amenities.filter((a) => a.kind === 'shelter');
  const benches = amenities.filter((a) => a.kind === 'bench');
  const toilets = amenities.filter((a) => a.kind === 'toilet');

  const samples =
    path.length >= 2
      ? sampleShelterCoverage(path, shelterWays, SHELTER_RADIUS_M, SHELTER_SAMPLE_STEP_M)
      : [];
  const shelterCoverage =
    samples.length > 0 ? samples.filter((s) => s.sheltered).length / samples.length : 0;
  const longestUnshelteredRunM = longestFalseRunM(samples);

  const restPoints = path.length >= 2 ? poisWithinRadius(benches, path, REST_RADIUS_M).length : 0;
  const toiletsNear = path.length >= 2 ? poisWithinRadius(toilets, path, TOILET_RADIUS_M).length : 0;

  // ⚠️ No stairs data source yet — PoiKind has no 'stairs' entry and nothing
  // bakes one. This is a placeholder, not a fabricated heuristic: OSM's
  // highway=steps is queryable via the same Overpass pull that found
  // shelter/bench/toilet (see data/etl.ts) but hasn't been wired up. Left at
  // 0 rather than guessed from route_instructions text we haven't verified
  // OneMap ever populates for this.
  const stairsCount = 0;

  const extraDistanceM = Math.max(0, candidate.totalDistanceM - directDistanceM);

  const total =
    weights.shelter * shelterCoverage +
    weights.rest * (Math.min(restPoints, 3) / 3) +
    weights.toilet * (toiletsNear > 0 ? 1 : 0) -
    weights.gap * (longestUnshelteredRunM / NORM_GAP_M) -
    weights.distance * (extraDistanceM / NORM_EXTRA_DISTANCE_M) -
    weights.stairs * stairsCount;

  return {
    total,
    shelterCoverage,
    restPoints,
    toiletsNear,
    longestUnshelteredRunM,
    extraDistanceM,
    stairsCount,
  };
}

/** Longest consecutive run of `sheltered === false` samples, measured in metres along the route. */
function longestFalseRunM(samples: readonly { distanceAlongM: number; sheltered: boolean }[]): number {
  let longest = 0;
  let runStartM: number | null = null;

  for (const s of samples) {
    if (!s.sheltered) {
      if (runStartM === null) runStartM = s.distanceAlongM;
    } else if (runStartM !== null) {
      longest = Math.max(longest, s.distanceAlongM - runStartM);
      runStartM = null;
    }
  }
  const last = samples[samples.length - 1];
  if (runStartM !== null && last) {
    longest = Math.max(longest, last.distanceAlongM - runStartM);
  }
  return longest;
}

// ─── Rationale (template-generated, never LLM) ───────────────────────────────

const PHRASE_BOOKS: Partial<Record<Lang, PhraseBook>> = { zh, ms };
/** zh/ms clause punctuation. en/ta aren't implemented in src/phrases yet — fall back to zh. */
const JOIN: Record<'zh' | 'ms', { comma: string; full: string }> = {
  zh: { comma: '，', full: '。' }, // ， 。
  ms: { comma: ', ', full: '.' },
};

/**
 * Plain-language justification, e.g. "这条路大部分有盖，中途有两张长椅。"
 *
 * TEMPLATE-GENERATED from the numbers in `score`, composed from src/phrases'
 * existing clause fragments (owner B) — this file never invents new
 * translated text. That keeps the hallucination surface at exactly zero and
 * costs no tokens.
 *
 * ⚠️ `shortestWalk` is only ever used when this candidate genuinely IS the
 * shortest (extraDistanceM ~ 0). Earlier drafts fired it as a generic
 * catch-all whenever no other clause applied — caught by the smoke test:
 * a via-waypoint candidate 9 m LONGER than the direct route was getting
 * "这条路比较近" ("this route is shorter"), a real factual claim, not
 * a hallucination in the LLM sense but exactly the failure mode validation
 * exists to prevent — false is false regardless of source. An empty string
 * (no claims at all) is the correct fallback when nothing true applies;
 * callers should treat "" as "no rationale to show/speak", not an error.
 */
export function describeScore(score: ComfortScore, lang: Lang): string {
  const book = PHRASE_BOOKS[lang] ?? zh;
  const join = lang === 'ms' ? JOIN.ms : JOIN.zh;

  const parts: string[] = [];
  if (score.shelterCoverage >= 0.6) parts.push(book.mostlySheltered);
  else if (score.shelterCoverage >= 0.1) parts.push(book.partlySheltered);

  if (score.restPoints > 0) parts.push(fill(book.benchesAlongTheWay, { n: score.restPoints }));
  if (score.toiletsNear > 0) parts.push(book.toiletOnTheWay);

  if (parts.length === 0 && score.extraDistanceM <= 1) parts.push(book.shortestWalk);

  return parts.length > 0 ? parts.join(join.comma) + join.full : '';
}

/** Sort by total desc. Returns [winner, ...losers]; losers feed the judge view. */
export function rankRoutes(scored: readonly ScoredRoute[]): ScoredRoute[] {
  return [...scored].sort((a, b) => b.score.total - a.score.total);
}
