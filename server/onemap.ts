// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// OneMap client. Holds the token; the browser never sees it.
//
// VERIFIED against live endpoints — see CONTRACTS.md § Verified API facts:
//   POST /api/auth/post/getToken            { email, password } → access_token (~3 days)
//   GET  /api/common/elastic/search         searchVal, returnGeom, getAddrDetails, pageNum
//   GET  /api/public/revgeocode             location=lat,lng · buffer=0-500 · addressType=All|HDB
//   GET  /api/public/routingsvc/route       start, end, routeType=walk|drive|pt|cycle
//   GET  /api/public/themesvc/retrieveTheme queryName, extents=lat1,lng1,lat2,lng2
//   GET  /api/public/themesvc/getAllThemesInfo?moreInfo=Y
//
// ⚠️ routeType has NO barrier-free or covered-wayfinding value. That is why
// core/comfort.ts exists. Do not go hunting for the flag; it isn't there.
//
// ⚠️ Search now requires a token too (docs banner). Unauthenticated calls still
// return results with an error field attached — treat that as a grace period,
// not a guarantee.

import type { BBox, Building, LatLng, Place, Poi, RouteCandidate } from '../src/core/types';

export const ONEMAP_BASE = 'https://www.onemap.gov.sg';

/**
 * Theme layers worth querying, verified present out of all 165.
 * These are LANDMARK sources — OneMap Themes has NO shelter/bench/toilet/lift/
 * bus-stop layers, so comfort data must come from data/etl.ts instead.
 * Full curated list: fixtures/onemap-themes.json
 */
export const USEFUL_THEMES = [
  'ssot_hawkercentres',
  'communityclubs',
  'eldercare',
  'moh_hospitals',
  'registered_pharmacy',
  'vaccination_polyclinics',
  'nationalparks',
  'park_connector_loop',
] as const;

/** OneMap's `route_instructions[0]` vocabulary → our Action type. */
export const DIRECTION_TO_ACTION: Record<string, string> = {
  Head: 'start',
  Left: 'left',
  Right: 'right',
  'Slight Left': 'left',
  'Slight Right': 'right',
  'Sharp Left': 'left',
  'Sharp Right': 'right',
  Straight: 'straight',
  Continue: 'straight',
};

/**
 * Fetch/refresh the access token. Validity is exactly 72 hours.
 *
 * Accepts either path:
 *   · `ONEMAP_TOKEN` set → use it directly, no refresh possible
 *   · `ONEMAP_EMAIL` + `ONEMAP_PASSWORD` → mint and auto-refresh on 401
 *
 * Prefer credentials. With a raw token there is no recovery from expiry.
 * Use a single in-flight promise so a burst of 401s triggers exactly one
 * refresh, not twenty.
 *
 * ⚠️ Header is `Authorization: <token>` — NO "Bearer " prefix.
 */
export async function getToken(): Promise<string> {
  throw new Error('NOT_IMPLEMENTED: onemap.getToken');
}

/** Authorized fetch with one automatic retry after a token refresh on 401. */
export async function oneMapFetch<T>(_path: string, _params: Record<string, string>): Promise<T> {
  throw new Error('NOT_IMPLEMENTED: onemap.oneMapFetch');
}

export async function search(_query: string): Promise<Place[]> {
  throw new Error('NOT_IMPLEMENTED: onemap.search');
}

/**
 * Returns at most 10 BUILDINGS within `bufferM` (max 500; 20 for roads).
 * `BUILDINGNAME` is the string "null" or absent for unnamed buildings — most
 * HDB blocks — so fall back to `Block {BLOCK} {ROAD}`.
 */
export async function reverseGeocode(_at: LatLng, _bufferM: number): Promise<Building[]> {
  throw new Error('NOT_IMPLEMENTED: onemap.reverseGeocode');
}

/**
 * Walk route. VERIFIED response shape (see CONTRACTS.md § 2.2):
 *   { route_geometry, route_summary: { total_time, total_distance },
 *     route_instructions: [...] }
 *
 * `route_geometry` is an ENCODED polyline — decode with
 * src/core/geo.decodePolyline (precision 5).
 *
 * ⚠️ `route_instructions[i]` is a positional ARRAY, not an object:
 *   [0] direction  [1] road name (OFTEN "")  [2] distance m  [3] "lat,lng"
 *   [4] time s     [5] "39m"                 [6] heading     [7] prev heading
 *   [8] mode       [9] human instruction
 *
 * ⚠️ COLLAPSE MICRO-TURNS. A real 745 m route returned 7 instructions including
 * "Slight Right" and "Keep Right At The Fork". Seven spoken steps is far too
 * many for a 70-year-old — merge them into a few landmark-anchored decisions
 * before handing anything to the rewrite.
 *
 * `pt` returns a completely different OTP-shaped payload; we don't use it.
 */
export async function walkRoute(_from: LatLng, _to: LatLng): Promise<RouteCandidate> {
  throw new Error('NOT_IMPLEMENTED: onemap.walkRoute');
}

/**
 * ⚠️ `SrchResults[0]` is METADATA (FeatCount, Theme_Name, Owner), not a feature.
 * Real features start at index 1 and carry NAME, ADDRESSBUILDINGNAME,
 * ADDRESSBLOCKHOUSENUMBER, LatLng. Don't map over the array blindly.
 */
export async function retrieveTheme(_queryName: string, _bbox: BBox): Promise<Poi[]> {
  throw new Error('NOT_IMPLEMENTED: onemap.retrieveTheme');
}

/**
 * DONE — ran 2026-09-07. 165 themes total; the 11 usable ones are saved to
 * fixtures/onemap-themes.json and the best are in USEFUL_THEMES above.
 * Keyword sweep found NO barrier-free, lift, toilet, bench, shelter, covered,
 * linkway or bus-stop layer. Kept for re-running if OneMap adds layers.
 */
export async function listAllThemes(): Promise<{ name: string; queryName: string }[]> {
  throw new Error('NOT_IMPLEMENTED: onemap.listAllThemes');
}
