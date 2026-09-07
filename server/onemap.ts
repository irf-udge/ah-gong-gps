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
 * Fetch/refresh the access token. Validity is ~3 days.
 *
 * Use a single in-flight promise so a burst of 401s triggers exactly one
 * refresh, not twenty.
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
 * Walk route. Response carries `route_geometry` as an ENCODED polyline —
 * decode with src/core/geo.decodePolyline (precision 5).
 * Note `pt` returns a completely different OTP-shaped payload; we don't use it.
 */
export async function walkRoute(_from: LatLng, _to: LatLng): Promise<RouteCandidate> {
  throw new Error('NOT_IMPLEMENTED: onemap.walkRoute');
}

export async function retrieveTheme(_queryName: string, _bbox: BBox): Promise<Poi[]> {
  throw new Error('NOT_IMPLEMENTED: onemap.retrieveTheme');
}

/**
 * One-off helper: dump every available theme so we can pick the useful layers
 * (barrier-free facilities, lifts, eldercare). Run it once the token exists —
 * we cannot enumerate these without auth.
 */
export async function listAllThemes(): Promise<{ name: string; queryName: string }[]> {
  throw new Error('NOT_IMPLEMENTED: onemap.listAllThemes');
}
