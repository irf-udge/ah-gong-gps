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

// PoiKind/Poi/LatLng/BBox come from src/core/types — the shared contract
// everything else compiles against (see CONTRACTS.md § File ownership). Don't
// redefine a parallel PoiKind here; the classifier below and OVERPASS_QUERIES
// need to agree with core/comfort.ts and core/landmarks.ts on what a
// 'shelter'/'bench'/'toilet' Poi actually is.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BBox, LatLng, Poi, PoiKind } from '../src/core/types';

/**
 * Highway values that count as pedestrian infrastructure. Shared between
 * OVERPASS_QUERIES (what we ask Overpass for) and classifyKind (how we
 * re-derive a Poi's kind from the tags Overpass sends back) so the two can't
 * drift apart — a query/classifier mismatch would silently drop or
 * misclassify real data.
 */
const PEDESTRIAN_HIGHWAYS = ['footway', 'path', 'pedestrian', 'corridor', 'steps'];

/** Overpass QL fragment per layer. Demo corridor only — see DEMO_BBOX. */
export const OVERPASS_QUERIES: Record<string, string> = {
  // Pedestrian-only covered ways. NOT `highway=service`/`residential` — that's
  // how you get covered bus driveways and car parks instead of walkways.
  covered_walkway: `way["covered"="yes"]["highway"~"^(${PEDESTRIAN_HIGHWAYS.join('|')})$"]`,
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
 *
 * Overpass's bbox filter is `(south,west,north,east)` — that's
 * `(minLat,minLng,maxLat,maxLng)`, the same field order as our own `BBox` and
 * as OneMap's `extents` param, so this reads directly off `bbox`'s fields.
 */
export function buildOverpassQuery(bbox: BBox = DEMO_BBOX): string {
  const bboxFilter = `(${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng})`;
  const statements = Object.values(OVERPASS_QUERIES)
    .map((fragment) => `  ${fragment}${bboxFilter};`)
    .join('\n');
  return `[out:json][timeout:60];\n(\n${statements}\n);\nout geom tags;`;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * POST the query to Overpass. One-shot, build-time only — see file header.
 *
 * ⚠️ VERIFIED LIVE: overpass-api.de's Apache front-end 406s any request with
 * NO `User-Agent` header — which is exactly what Node's `fetch`/`https`
 * send by default (curl always sends one, which is why this looked fine in
 * every manual/docs example anyone would copy). Confirmed by elimination:
 * identical request via raw `https.request` still 406'd with no UA; adding
 * any real UA string (tested both a spoofed curl UA and an honest descriptive
 * one) fixed it immediately. Not content negotiation on Accept/encoding —
 * strictly presence of the header.
 */
// Plain ASCII only — header values are Latin-1/ByteString, and an em-dash
// here throws "Cannot convert argument to a ByteString" (found live, on the
// very first real request after adding this header).
const OVERPASS_USER_AGENT = 'ah-gong-gps-etl/1.0 (hackathon project, Vibe for Good; build-time only, see data/etl.ts)';

export async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  const res = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': OVERPASS_USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass query failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as OverpassResponse;
  return body.elements;
}

/**
 * Re-derives a Poi's kind from raw OSM tags — mirrors OVERPASS_QUERIES'
 * filters exactly (see PEDESTRIAN_HIGHWAYS) rather than trusting element
 * order, since one combined query merges all four layers into a single flat
 * `elements` array with no marker for which fragment matched.
 */
function classifyKind(tags: Record<string, string> | undefined): PoiKind | null {
  if (!tags) return null;
  if (tags.amenity === 'bench') return 'bench';
  if (tags.amenity === 'toilets') return 'toilet';
  if (tags.highway === 'footway' && tags.tunnel === 'building_passage') return 'shelter';
  if (tags.covered === 'yes' && tags.highway && PEDESTRIAN_HIGHWAYS.includes(tags.highway)) return 'shelter';
  return null;
}

function elementAt(el: OverpassElement): LatLng {
  if (el.type === 'node') return { lat: el.lat, lng: el.lon };
  const first = el.geometry[0];
  if (!first) throw new Error(`Overpass way ${el.id} has no geometry`);
  return { lat: first.lat, lng: first.lon }; // first vertex as the pin — see Poi.path's doc in core/types.ts
}

function withinBBox(at: LatLng, bbox: BBox): boolean {
  return at.lat >= bbox.minLat && at.lat <= bbox.maxLat && at.lng >= bbox.minLng && at.lng <= bbox.maxLng;
}

function elementToPoi(el: OverpassElement, kind: PoiKind): Poi {
  const at = elementAt(el);
  const poi: Poi = {
    id: `osm:${el.type}:${el.id}`,
    kind,
    name: el.tags?.name ?? null,
    at,
  };
  // Only line-shaped amenities carry a path — see Poi.path's doc in
  // core/types.ts. Both shelter sources here (covered_walkway,
  // building_passage) are ways; bench/toilet are nodes with no geometry to carry.
  if (el.type === 'way') poi.path = el.geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon }));
  return poi;
}

const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL) — https://www.openstreetmap.org/copyright';

/**
 * Normalise raw Overpass elements into Poi[] (src/core/types), classify kind
 * from tags (covered walkway/building_passage → 'shelter', amenity=bench →
 * 'bench', amenity=toilets → 'toilet'), clip to DEMO_BBOX, and write the
 * baked slice to data/amenities.json.
 *
 * ⚠️ Clips client-side even though the query already carries a bbox filter —
 * two other OneMap spatial params (`extents`, `revgeocode`'s `buffer`) both
 * turned out not to be hard cutoffs when live-verified (see CONTRACTS.md
 * § 2.2). Never assumed here either; checked directly against a real
 * Overpass response before deciding whether this defensive filter was
 * actually needed — see DEVPLAN.md's CP2 entry for the result.
 */
export async function buildAmenityIndex(): Promise<void> {
  const query = buildOverpassQuery(DEMO_BBOX);
  const elements = await fetchOverpass(query);

  const pois: Poi[] = [];
  for (const el of elements) {
    const kind = classifyKind(el.tags);
    if (!kind) continue;
    const poi = elementToPoi(el, kind);
    if (!withinBBox(poi.at, DEMO_BBOX)) continue;
    pois.push(poi);
  }

  const counts: Partial<Record<PoiKind, number>> = {};
  for (const p of pois) counts[p.kind] = (counts[p.kind] ?? 0) + 1;

  const output = {
    _meta: {
      source: 'OpenStreetMap via Overpass API',
      attribution: OSM_ATTRIBUTION,
      generatedAt: new Date().toISOString(),
      bbox: DEMO_BBOX,
      counts,
    },
    pois,
  };

  const outPath = fileURLToPath(new URL('./amenities.json', import.meta.url));
  await writeFile(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`[etl] wrote ${pois.length} amenities to ${outPath}`);
  console.log(`[etl] counts:`, counts);
}

// Run only when executed directly (`npm run etl`), not when another module
// imports DEMO_BBOX/types from this file. Compares real filesystem paths
// (not raw import.meta.url/argv strings) so this works on Windows too.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildAmenityIndex().catch((err: unknown) => {
    console.error('[etl] failed:', err);
    process.exit(1);
  });
}
