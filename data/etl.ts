// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
// Run with: npm run etl
//
// ── Data source: OpenStreetMap via the Overpass API. NOT data.gov.sg. ──────
//
// Both OneMap Themes and data.gov.sg were dead ends for comfort data — see
// the full investigation trail below. OSM has it, verified live:
//
//   Nationwide (`out count`, whole-SG bbox):
//     way[covered=yes][highway=*]  → 14,980 ways
//     node[amenity=bench]          →  1,300 nodes
//   Demo corridor alone (Ang Mo Kio, DEMO_BBOX below):
//     198 covered ways · 38 building-passage linkways · 9 benches · 3 toilets
//
// This is a build-time ETL: query once, bake a static slice into data/, and
// nothing in the request path ever touches Overpass again. Do NOT call
// Overpass from the server at request time — overpass-api.de is a shared
// community server; one-off ETL pulls are fine, live per-request traffic is
// not, and there's no need for it once the slice is committed.
//
// ⚠️ ODbL ATTRIBUTION IS REQUIRED. Unlike OneMap (Singapore Open Data
// Licence) and data.gov.sg, OSM data is under the Open Database Licence —
// any product using it must credit "© OpenStreetMap contributors" somewhere
// visible (About screen, footer, or the pitch deck's data-sources slide).
// This is a NEW obligation the OneMap/data.gov.sg sources didn't carry.
//
// ⚠️ FILTER FOR PEDESTRIAN RELEVANCE. `covered=yes` isn't only pedestrian
// infrastructure — a verified sample hit was "Ang Mo Kio Bus Interchange"
// (highway=service, bus=yes, access=no): a covered BUS driveway, not
// something a senior would walk. Restrict `highway` to
// footway/path/pedestrian/corridor/steps, and keep tunnel=building_passage
// as its own separate (always-pedestrian) query — see PEDESTRIAN_HIGHWAY below.
//
// ── Investigation trail (so nobody re-runs this hunt) ───────────────────────
// 1. OneMap Themes: enumerated all 165 layers via getAllThemesInfo, grouped by
//    category, eyeballed every one (not just keyword grep). Zero barrier-free,
//    lift, toilet, bench, or shelter/covered/linkway layer. The brief's claim
//    that Themes has "barrier-free facilities, lifts" is wrong — only
//    `eldercare` is real. Full dump: fixtures/onemap-themes.json.
// 2. data.gov.sg: drove the actual search UI (not the dataset-list API, which
//    ignores `query` entirely) for "covered linkway", "linkway", and "bench".
//    "covered linkway" → 43 results, all false positives on the word "covered"
//    (workers covered by agreements, vaccine coverage). "linkway" alone → 0
//    results. "bench" → 10 results, all "benchmark" (IMDA rankings, SGX
//    turnover) — zero park-furniture datasets. Confirmed genuinely absent.
// 3. OSM/Overpass: the fallback that actually has it. See counts above.

export type PoiKind = 'shelter' | 'bench' | 'toilet' | 'lift' | 'bus_stop';

/** Overpass QL fragment per layer. Demo corridor only — see DEMO_BBOX. */
export const OVERPASS_QUERIES: Record<string, string> = {
  // Pedestrian-only covered ways. NOT `highway=service`/`residential` — that's
  // how you get covered bus driveways and car parks instead of walkways.
  covered_walkway:
    'way["covered"="yes"]["highway"~"^(footway|path|pedestrian|corridor|steps)$"]',
  // Covered passages through/under buildings — always pedestrian by definition.
  building_passage: 'way["highway"="footway"]["tunnel"="building_passage"]',
  bench: 'node["amenity"="bench"]',
  toilet: 'node["amenity"="toilets"]',
};

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Demo corridor bounding box — keeps the committed slice small. */
export const DEMO_BBOX = {
  minLat: 1.36,
  minLng: 103.84,
  maxLat: 1.38,
  maxLng: 103.86,
};

export interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OverpassWay {
  type: 'way';
  id: number;
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export type OverpassElement = OverpassNode | OverpassWay;

/**
 * Build one combined Overpass QL query for all four layers over DEMO_BBOX,
 * requesting `out geom tags` so ways come back with full polylines (not just
 * centers) and nodes carry their tags for kind-classification downstream.
 */
export function buildOverpassQuery(bbox = DEMO_BBOX): string {
  throw new Error('NOT_IMPLEMENTED: etl.buildOverpassQuery');
}

/** POST the query to Overpass. One-shot, build-time only — see file header. */
export async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  throw new Error('NOT_IMPLEMENTED: etl.fetchOverpass');
}

/**
 * Normalise raw Overpass elements into Poi[] (src/core/types), classify kind
 * from tags (covered walkway/building_passage → 'shelter', amenity=bench →
 * 'bench', amenity=toilets → 'toilet'), clip to DEMO_BBOX, and write the
 * baked slice to data/amenities.json.
 */
export async function buildAmenityIndex(): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: etl.buildAmenityIndex');
}
