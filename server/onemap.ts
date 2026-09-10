// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// OneMap client. Holds the token; the browser never sees it.
//
// VERIFIED LIVE against real endpoints with the real key on 2026-09-09 (not
// just the docs — see CONTRACTS.md § Verified API facts for the full sweep):
//   POST /api/auth/post/getToken            { email, password } → access_token (~3 days)
//   GET  /api/common/elastic/search         searchVal, returnGeom, getAddrDetails, pageNum
//   GET  /api/public/revgeocode             location=lat,lng · buffer=0-500 · addressType=All
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
//
// ⚠️ "No value" comes back as the literal STRING "NIL", not null/absent, on
// both search and revgeocode — verified against Blk 226 Ang Mo Kio Ave 1 (a
// genuinely unnamed HDB block): `BUILDING`/`BUILDINGNAME` was `"NIL"`, not
// missing. CONTRACTS.md's "null/absent" wording undersold this — check for
// the literal string, see `nilToNull` below.

import type { BBox, Building, LatLng, Place, Poi, PoiKind, RouteCandidate, Manoeuvre, Action } from '../src/core/types';
import { decodePolyline, haversineM } from '../src/core/geo.js';
import { memoizeAsync } from './cache.js';

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

/** Which PoiKind each curated theme maps to. Every USEFUL_THEMES entry must be here. */
const THEME_TO_KIND: Record<string, PoiKind> = {
  ssot_hawkercentres: 'hawker',
  communityclubs: 'community',
  eldercare: 'eldercare',
  moh_hospitals: 'hospital',
  registered_pharmacy: 'pharmacy',
  vaccination_polyclinics: 'polyclinic',
  nationalparks: 'park',
  park_connector_loop: 'park',
};

/**
 * OneMap's `route_instructions[i][0]` vocabulary → our Action type.
 * `Destination` was missing before — verified live, every route's last
 * instruction uses it (not e.g. "Arrive").
 */
export const DIRECTION_TO_ACTION: Record<string, Action> = {
  Head: 'start',
  Left: 'left',
  Right: 'right',
  'Slight Left': 'left',
  'Slight Right': 'right',
  'Sharp Left': 'left',
  'Sharp Right': 'right',
  Straight: 'straight',
  Continue: 'straight',
  Destination: 'arrive',
};

interface GetTokenResponse {
  access_token: string;
  expiry_timestamp: string;
}

/**
 * The current token, as a single shared promise — not a resolved value. Every
 * caller awaits the same in-flight mint/refresh instead of racing to start
 * their own, which is the whole point (see getToken's doc).
 */
let tokenPromise: Promise<string> | null = null;

function mintToken(): Promise<string> {
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  const rawToken = process.env.ONEMAP_TOKEN;

  // Prefer credentials even when a raw token is also set — only the
  // credential path can recover from expiry. See file header.
  if (email && password) {
    return fetch(`${ONEMAP_BASE}/api/auth/post/getToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`OneMap getToken failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as GetTokenResponse;
      return body.access_token;
    });
  }

  if (rawToken) return Promise.resolve(rawToken);

  return Promise.reject(
    new Error('OneMap: no credentials configured — set ONEMAP_EMAIL + ONEMAP_PASSWORD, or ONEMAP_TOKEN'),
  );
}

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
  if (!tokenPromise) {
    tokenPromise = mintToken().catch((err) => {
      tokenPromise = null; // don't cache a failed mint — the next call should retry, not repeat the same rejection
      throw err;
    });
  }
  return tokenPromise;
}

/** Drop the cached token so the next getToken() call mints/reads a fresh one. */
function invalidateToken(): void {
  tokenPromise = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries for a 429 before giving up — see oneMapFetch's own doc for why this exists. */
const MAX_429_RETRIES = 3;
/** Exponential backoff base, plus jitter — a burst of parallel callers all waiting the exact same delay would just retry into the same wall together. */
const RETRY_BASE_DELAY_MS = 400;

/**
 * Authorized fetch with one automatic retry after a token refresh on 401,
 * PLUS a short backoff-retry on 429.
 *
 * ⚠️ 429 handling added 2026-09-10, found live: `collectLandmarks`
 * (src/core/landmarks.ts) fires one reverse-geocode call per manoeuvre, all
 * in parallel — fine for the ~4-step demo route, but a real route to a real
 * destination can have far more manoeuvres (confirmed live: a real query
 * produced 26+), and an unbounded burst of distinct coordinates (nothing
 * for the LRU cache to dedupe against) tripped OneMap's rate limit. A short
 * jittered backoff is enough in practice — OneMap's window clears fast.
 * `collectLandmarks` itself was ALSO capped to a bounded concurrency for the
 * same reason (see its own doc) — this retry is the safety net for every
 * other OneMap call site (walkRoute, search, retrieveTheme), not a
 * replacement for bounding the burst at the source.
 */
export async function oneMapFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const buildUrl = () => {
    const url = new URL(path, ONEMAP_BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  };

  let token = await getToken();
  let res = await fetch(buildUrl(), { headers: { Authorization: token } });

  if (res.status === 401) {
    invalidateToken();
    token = await getToken();
    res = await fetch(buildUrl(), { headers: { Authorization: token } });
  }

  for (let attempt = 0; res.status === 429 && attempt < MAX_429_RETRIES; attempt++) {
    await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 200);
    res = await fetch(buildUrl(), { headers: { Authorization: token } });
  }

  if (!res.ok) {
    throw new Error(`OneMap ${path} failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as T;
}

/** OneMap's "no value" sentinel is the literal string "NIL" — verified live, see file header. */
function nilToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  return v.trim().toUpperCase() === 'NIL' ? null : v;
}

/**
 * Rounds to 5 decimal places (~1.1 m at the equator) — the cache-key
 * granularity DEVPLAN calls for. Two calls whose coordinates differ by less
 * than that share a cache entry; OneMap's own routing precision is in the
 * same ballpark, so this doesn't trade away anything real.
 */
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function placeId(postal: string | null, address: string): string {
  if (postal) return `postal:${postal}`;
  return `addr:${address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

interface OneMapSearchResult {
  SEARCHVAL: string;
  BLK_NO: string;
  ROAD_NAME: string;
  BUILDING: string;
  ADDRESS: string;
  POSTAL: string;
  LATITUDE: string;
  LONGITUDE: string;
}
interface OneMapSearchResponse {
  found: number;
  results: OneMapSearchResult[];
}

async function searchUncached(query: string): Promise<Place[]> {
  const body = await oneMapFetch<OneMapSearchResponse>('/api/common/elastic/search', {
    searchVal: query,
    returnGeom: 'Y',
    getAddrDetails: 'Y',
    pageNum: '1',
  });

  return body.results.map((r) => {
    const postal = nilToNull(r.POSTAL);
    const block = nilToNull(r.BLK_NO);
    const road = nilToNull(r.ROAD_NAME);
    const building = nilToNull(r.BUILDING);
    return {
      id: placeId(postal, r.ADDRESS),
      name: building ?? (block && road ? `Block ${block} ${road}` : r.SEARCHVAL),
      address: r.ADDRESS,
      postal,
      block,
      road,
      at: { lat: Number(r.LATITUDE), lng: Number(r.LONGITUDE) },
    };
  });
}

/** LRU-cached — 200 distinct queries (trimmed + lowercased key) before eviction. */
export const search = memoizeAsync(searchUncached, (query) => query.trim().toLowerCase(), 200);

interface OneMapGeocodeEntry {
  BUILDINGNAME: string;
  BLOCK: string;
  ROAD: string;
  POSTALCODE: string;
  LATITUDE: string;
  LONGITUDE: string;
}
interface OneMapRevGeocodeResponse {
  GeocodeInfo: OneMapGeocodeEntry[];
}

/**
 * Returns at most 10 BUILDINGS within `bufferM` (max 500; 20 for roads).
 * `BUILDINGNAME` is the literal string "NIL" for unnamed buildings — most
 * HDB blocks — so fall back to `Block {BLOCK} {ROAD}`.
 *
 * ⚠️ VERIFIED LIVE: `bufferM` is NOT a hard cutoff, same as `retrieveTheme`'s
 * `extents`. A `buffer=50` request returned buildings up to 262 m away — MRT
 * stations were the worst offenders (233-262 m), ordinary HDB blocks a more
 * modest 54-90 m, but never strictly ≤ 50. Reproduced at 3 different points
 * along a real route, not a one-off. Filtered client-side below; never trust
 * this parameter as an actual radius cap.
 */
async function reverseGeocodeUncached(at: LatLng, bufferM: number): Promise<Building[]> {
  const body = await oneMapFetch<OneMapRevGeocodeResponse>('/api/public/revgeocode', {
    location: `${at.lat},${at.lng}`,
    buffer: String(bufferM),
    addressType: 'All',
    otherFeatures: 'N',
  });

  return (body.GeocodeInfo ?? [])
    .map((g) => ({
      buildingName: nilToNull(g.BUILDINGNAME),
      block: nilToNull(g.BLOCK),
      road: nilToNull(g.ROAD),
      postal: nilToNull(g.POSTALCODE),
      at: { lat: Number(g.LATITUDE), lng: Number(g.LONGITUDE) },
    }))
    .filter((b) => haversineM(at, b.at) <= bufferM);
}

/** LRU-cached — keyed on coords rounded to 5 dp + bufferM, 500 entries before eviction. */
export const reverseGeocode = memoizeAsync(
  reverseGeocodeUncached,
  (at, bufferM) => `${round5(at.lat)},${round5(at.lng)},${bufferM}`,
  500,
);

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
interface OneMapRouteResponse {
  route_geometry: string;
  route_summary: { total_time: number; total_distance: number };
  route_instructions: [string, string, number, string, number, string, string, string, string, string][];
}

/**
 * ⚠️ VERIFIED LIVE: field [2] (distance) on instruction `i` is the walk FROM
 * this instruction's point TO the NEXT one — not from the previous point to
 * this one. Confirmed against a real route: the first instruction ("Head")
 * carried distance 39, not 0, and the distances summed to total_distance only
 * under this reading. Our `Manoeuvre.distanceM` means "distance from the
 * PREVIOUS manoeuvre" (the opposite convention), so it's shifted by one here:
 * manoeuvre[i].distanceM = raw[i-1].distance, manoeuvre[0].distanceM = 0.
 * Get this backwards and every turn's lead-in distance is silently wrong.
 */
function parseManoeuvres(raw: OneMapRouteResponse['route_instructions']): Manoeuvre[] {
  return raw.map((inst, i) => {
    const [direction, , , latLng, , , , , , rawText] = inst;
    const [latStr, lngStr] = latLng.split(',');
    const prev = i === 0 ? undefined : raw[i - 1];
    return {
      index: i,
      at: { lat: Number(latStr), lng: Number(lngStr) },
      action: DIRECTION_TO_ACTION[direction] ?? 'straight',
      rawInstruction: rawText,
      distanceM: prev ? prev[2] : 0,
    };
  });
}

/** Manoeuvres arriving less than this many metres after the previous one get folded into it. */
const MICRO_TURN_THRESHOLD_M = 25;

/**
 * Merges short connector turns into the manoeuvre that follows them. Verified
 * against a real 745 m route: 3 turns inside the first 77 m (16 m, 20 m, 41 m
 * apart) collapsed to 1 — 7 raw instructions became 5. See the walkRoute doc
 * for why this matters: nobody should hear 7 spoken turns for a 12-minute walk.
 * Never merges away the first (`start`) or last (`arrive`) manoeuvre.
 */
function collapseMicroTurns(raw: Manoeuvre[]): Manoeuvre[] {
  const first = raw[0];
  if (!first) return raw;
  const out: Manoeuvre[] = [first];
  for (let i = 1; i < raw.length; i++) {
    const m = raw[i];
    if (!m) continue;
    const isLast = i === raw.length - 1;
    const prev = out[out.length - 1];
    if (!isLast && prev && m.distanceM < MICRO_TURN_THRESHOLD_M && out.length > 1) {
      out[out.length - 1] = { ...m, index: prev.index, distanceM: prev.distanceM + m.distanceM };
    } else {
      out.push(m);
    }
  }
  return out.map((m, i) => ({ ...m, index: i }));
}

/**
 * Walk route. `viaWaypoint` is always null here — comfort.ts sets it when it
 * stitches two of these legs together for a waypoint detour (see mergeLegs).
 */
async function walkRouteUncached(from: LatLng, to: LatLng): Promise<RouteCandidate> {
  const body = await oneMapFetch<OneMapRouteResponse>('/api/public/routingsvc/route', {
    start: `${from.lat},${from.lng}`,
    end: `${to.lat},${to.lng}`,
    routeType: 'walk',
  });

  const manoeuvres = collapseMicroTurns(parseManoeuvres(body.route_instructions));

  return {
    id: `onemap:${from.lat},${from.lng}->${to.lat},${to.lng}`,
    polyline: decodePolyline(body.route_geometry),
    manoeuvres,
    totalDistanceM: body.route_summary.total_distance,
    totalTimeS: body.route_summary.total_time,
    viaWaypoint: null,
  };
}

/**
 * LRU-cached — keyed on both endpoints' coords rounded to 5 dp, 300 entries
 * before eviction. This is the highest-value cache of the four: comfort.ts's
 * generateCandidates fires up to 7 of these per journey (1 direct + 3
 * waypoints × 2 legs), and rehearsal repeats the same demo corridor dozens
 * of times.
 */
export const walkRoute = memoizeAsync(
  walkRouteUncached,
  (from, to) => `${round5(from.lat)},${round5(from.lng)}->${round5(to.lat)},${round5(to.lng)}`,
  300,
);

interface OneMapThemeFeature {
  NAME: string;
  Type: string;
  LatLng: string;
}
interface OneMapThemeResponse {
  SrchResults: unknown[];
}

/**
 * ⚠️ VERIFIED LIVE: the coordinate encoding differs by feature `Type`.
 *   Point → "lat,lng"                       (plain comma pair, lat first)
 *   Line  → "[[lng,lat],[lng,lat],...]"     (JSON array, GeoJSON lng/lat order!)
 * We only need a pin, not a polyline, so Line features use their first
 * vertex — same "first vertex as the pin" pattern as Poi.path in core/types.ts.
 */
function parseThemeLatLng(raw: string, type: string): LatLng {
  if (type === 'Line') {
    const points = JSON.parse(raw) as [number, number][];
    const first = points[0];
    if (!first) throw new Error(`OneMap theme: empty Line geometry: ${raw}`);
    const [lng, lat] = first;
    return { lat, lng };
  }
  const [latStr, lngStr] = raw.split(',');
  return { lat: Number(latStr), lng: Number(lngStr) };
}

function withinBBox(at: LatLng, bbox: BBox): boolean {
  return at.lat >= bbox.minLat && at.lat <= bbox.maxLat && at.lng >= bbox.minLng && at.lng <= bbox.maxLng;
}

/**
 * ⚠️ `SrchResults[0]` is METADATA (FeatCount, Theme_Name, Owner), not a feature.
 * Real features start at index 1. Field names vary PER THEME (verified live
 * across all 8 USEFUL_THEMES) — only NAME, Type and LatLng are common to all
 * of them; don't assume ADDRESSBUILDINGNAME etc. exist.
 *
 * ⚠️ `extents` is NOT reliably honoured server-side. `park_connector_loop`
 * returned 784 features nationwide for a bbox covering one estate — verified
 * live, not a fluke (the strait-line distance from the bbox to some hits was
 * tens of km). Always filter client-side; never trust the server's clipping.
 */
async function retrieveThemeUncached(queryName: string, bbox: BBox): Promise<Poi[]> {
  const kind = THEME_TO_KIND[queryName];
  if (!kind) {
    throw new Error(`OneMap retrieveTheme: no PoiKind mapping for theme "${queryName}" — add one to THEME_TO_KIND`);
  }

  const body = await oneMapFetch<OneMapThemeResponse>('/api/public/themesvc/retrieveTheme', {
    queryName,
    extents: `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`,
  });

  const features = body.SrchResults.slice(1) as OneMapThemeFeature[];
  const pois: Poi[] = [];
  features.forEach((f, i) => {
    const at = parseThemeLatLng(f.LatLng, f.Type);
    if (!withinBBox(at, bbox)) return;
    pois.push({ id: `${queryName}-${i}`, kind, name: f.NAME ?? null, at });
  });
  return pois;
}

/** LRU-cached — keyed on theme + bbox rounded to 5 dp, 100 entries before eviction. */
export const retrieveTheme = memoizeAsync(
  retrieveThemeUncached,
  (queryName, bbox) =>
    `${queryName}:${round5(bbox.minLat)},${round5(bbox.minLng)},${round5(bbox.maxLat)},${round5(bbox.maxLng)}`,
  100,
);

interface OneMapThemeInfo {
  THEMENAME: string;
  QUERYNAME: string;
}
interface OneMapAllThemesResponse {
  Theme_Names: OneMapThemeInfo[];
}

/**
 * DONE — ran 2026-09-07. 165 themes total; the 11 usable ones are saved to
 * fixtures/onemap-themes.json and the best are in USEFUL_THEMES above.
 * Keyword sweep found NO barrier-free, lift, toilet, bench, shelter, covered,
 * linkway or bus-stop layer. Kept for re-running if OneMap adds layers.
 */
export async function listAllThemes(): Promise<{ name: string; queryName: string }[]> {
  const body = await oneMapFetch<OneMapAllThemesResponse>('/api/public/themesvc/getAllThemesInfo', {
    moreInfo: 'Y',
  });
  return body.Theme_Names.map((t) => ({ name: t.THEMENAME, queryName: t.QUERYNAME }));
}
