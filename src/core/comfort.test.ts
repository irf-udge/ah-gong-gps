// Unit tests for core/comfort.ts's pure scoring logic — scoreRoute,
// describeScore, and rankRoutes. generateCandidates needs a RoutingProvider
// and is exercised live (see CONTRACTS.md), not here.

import { describe, it, expect } from 'vitest';
import { DEFAULT_WEIGHTS, describeScore, rankRoutes, scoreRoute } from './comfort';
import type { ComfortScore, Poi, RouteCandidate, ScoredRoute } from './types';

const STRAIGHT_PATH = [
  { lat: 1.3, lng: 103.8 },
  { lat: 1.3, lng: 103.81 }, // ≈ 1113 m east
];

function makeCandidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    id: 'test-route',
    polyline: STRAIGHT_PATH,
    manoeuvres: [],
    totalDistanceM: 1113,
    totalTimeS: 900,
    viaWaypoint: null,
    ...overrides,
  };
}

const SHELTER: Poi = {
  id: 'shelter-1',
  kind: 'shelter',
  name: 'Covered Linkway',
  at: STRAIGHT_PATH[0]!,
  path: STRAIGHT_PATH, // shelters the WHOLE route
};
const BENCH: Poi = { id: 'bench-1', kind: 'bench', name: 'Bench', at: { lat: 1.3, lng: 103.805 } };
const TOILET: Poi = { id: 'toilet-1', kind: 'toilet', name: 'Toilet', at: { lat: 1.3, lng: 103.805 } };

describe('scoreRoute', () => {
  it('scores a fully-sheltered route with amenities as strongly comfortable', () => {
    const candidate = makeCandidate();
    const score = scoreRoute(candidate, [SHELTER, BENCH, TOILET], 1113);
    expect(score.shelterCoverage).toBeCloseTo(1, 1);
    expect(score.restPoints).toBeGreaterThan(0);
    expect(score.toiletsNear).toBeGreaterThan(0);
    expect(score.longestUnshelteredRunM).toBeLessThan(50);
    expect(score.extraDistanceM).toBe(0);
  });

  it('scores a route with no amenities as fully exposed', () => {
    const candidate = makeCandidate();
    const score = scoreRoute(candidate, [], 1113);
    expect(score.shelterCoverage).toBe(0);
    expect(score.restPoints).toBe(0);
    expect(score.toiletsNear).toBe(0);
    // No shelter anywhere along the route — the whole thing is one unsheltered run.
    expect(score.longestUnshelteredRunM).toBeGreaterThan(1000);
  });

  it('computes extraDistanceM as the excess over the direct route, clamped at 0', () => {
    const longer = makeCandidate({ totalDistanceM: 1300 });
    expect(scoreRoute(longer, [], 1113).extraDistanceM).toBeCloseTo(187, 0);

    // A candidate can never be "shorter than direct" in a meaningful sense —
    // clamp to 0 rather than let it become a bonus.
    const shorter = makeCandidate({ totalDistanceM: 1000 });
    expect(scoreRoute(shorter, [], 1113).extraDistanceM).toBe(0);
  });

  it('degenerate (< 2 point) polylines score as fully exposed with no amenities near', () => {
    const degenerate = makeCandidate({ polyline: [STRAIGHT_PATH[0]!] });
    const score = scoreRoute(degenerate, [SHELTER, BENCH, TOILET], 1113);
    expect(score.shelterCoverage).toBe(0);
    expect(score.restPoints).toBe(0);
    expect(score.toiletsNear).toBe(0);
  });

  it('respects custom weights — doubling the shelter weight raises the total for a sheltered route', () => {
    const candidate = makeCandidate();
    const base = scoreRoute(candidate, [SHELTER], 1113, DEFAULT_WEIGHTS);
    const boosted = scoreRoute(candidate, [SHELTER], 1113, { ...DEFAULT_WEIGHTS, shelter: DEFAULT_WEIGHTS.shelter * 2 });
    expect(boosted.total).toBeGreaterThan(base.total);
  });

  it('stairsCount is always 0 — no data source wired up yet (documented placeholder)', () => {
    const score = scoreRoute(makeCandidate(), [SHELTER, BENCH, TOILET], 1113);
    expect(score.stairsCount).toBe(0);
  });
});

describe('describeScore', () => {
  const baseScore: ComfortScore = {
    total: 0,
    shelterCoverage: 0,
    restPoints: 0,
    toiletsNear: 0,
    longestUnshelteredRunM: 0,
    extraDistanceM: 0,
    stairsCount: 0,
  };

  it('mentions mostly sheltered at >= 0.6 coverage', () => {
    const text = describeScore({ ...baseScore, shelterCoverage: 0.8 }, 'zh');
    expect(text).toContain('大部分有盖');
  });

  it('mentions partly sheltered between 0.1 and 0.6 coverage', () => {
    const text = describeScore({ ...baseScore, shelterCoverage: 0.3 }, 'zh');
    expect(text).toContain('有一部分有盖');
  });

  it('omits any shelter clause below 0.1 coverage', () => {
    const text = describeScore({ ...baseScore, shelterCoverage: 0.05, extraDistanceM: 5 }, 'zh');
    expect(text).not.toContain('有盖');
  });

  it('mentions bench count and toilet presence when applicable', () => {
    const text = describeScore({ ...baseScore, restPoints: 2 }, 'zh');
    expect(text).toContain('2');
    expect(text).toContain('长椅');

    const toiletText = describeScore({ ...baseScore, toiletsNear: 1 }, 'zh');
    expect(toiletText).toContain('厕所');
  });

  it('falls back to "shortest walk" ONLY when nothing else applies and extraDistanceM ~ 0', () => {
    const text = describeScore({ ...baseScore, extraDistanceM: 0 }, 'zh');
    expect(text).toContain('比较近');
  });

  it('regression: does NOT claim "shortest" for a route that already has a real, true clause', () => {
    // The exact bug this file's own doc describes: a sheltered route that is
    // NOT actually the shortest must never also claim "this route is shorter".
    const text = describeScore({ ...baseScore, shelterCoverage: 0.9, extraDistanceM: 9 }, 'zh');
    expect(text).toContain('大部分有盖');
    expect(text).not.toContain('比较近');
  });

  it('returns an empty string when nothing true applies at all', () => {
    const text = describeScore({ ...baseScore, extraDistanceM: 50 }, 'zh');
    expect(text).toBe('');
  });

  it('joins multiple clauses with the language-specific separator', () => {
    const zh = describeScore({ ...baseScore, shelterCoverage: 0.9, restPoints: 1 }, 'zh');
    expect(zh).toContain('，');
    expect(zh.endsWith('。')).toBe(true);

    const ms = describeScore({ ...baseScore, shelterCoverage: 0.9, restPoints: 1 }, 'ms');
    expect(ms).toContain(', ');
    expect(ms.endsWith('.')).toBe(true);
  });
});

describe('rankRoutes', () => {
  function scored(id: string, total: number): ScoredRoute {
    return { candidate: makeCandidate({ id }), score: { ...blankScore(), total }, rationale: '' };
  }
  function blankScore(): ComfortScore {
    return { total: 0, shelterCoverage: 0, restPoints: 0, toiletsNear: 0, longestUnshelteredRunM: 0, extraDistanceM: 0, stairsCount: 0 };
  }

  it('sorts by total score descending, winner first', () => {
    const routes = [scored('low', -1), scored('high', 2), scored('mid', 0.5)];
    const ranked = rankRoutes(routes);
    expect(ranked.map((r) => r.candidate.id)).toEqual(['high', 'mid', 'low']);
  });

  it('does not mutate the input array', () => {
    const routes = [scored('a', 1), scored('b', 2)];
    const original = [...routes];
    rankRoutes(routes);
    expect(routes).toEqual(original);
  });
});
