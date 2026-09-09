// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Builds the set of real-world things the LLM is allowed to talk about.
// EVERY landmark here originates from a OneMap response or a baked dataset.
// The model never sources one — it only selects from what we hand it.
//
// Reality check on the data (see CONTRACTS.md § Verified API facts):
// reverseGeocode returns BUILDINGS, not POIs. `buildingName` comes back as the
// literal string "NIL" for most HDB blocks, so expect "Block 123" far more
// often than "the coffee shop".
//
// ⚠️ Buildings/amenities with no usable name are dropped, not degraded to a
// generic label. A bare road name ("Ang Mo Kio Avenue 3" with no block) is
// exactly the street-name-based direction this product exists to avoid — see
// CONTRACTS.md § LLM output & validation's "no street names" rule — and an
// unnamed OSM amenity (most shelters/benches/toilets have no `name` tag)
// doesn't fit `Landmark.name`'s contract of "emitted verbatim, never
// translated". Both stay fully usable for comfort SCORING (core/comfort.ts
// reads the same `amenities` list directly); they just never become a spoken
// landmark here. If a manoeuvre's real surroundings are just an unnamed HDB
// block, "Block 226" is genuinely the honest answer, not a fallback to hide.

import type { Building, Lang, Landmark, LandmarkKind, Manoeuvre, Poi } from './types';
import type { PlaceProvider } from '../providers/types';
import { bearingDeg, haversineM } from './geo.js';

/** OneMap caps the reverse-geocode buffer at 500 m; 50 m is our landmark radius. */
export const LANDMARK_RADIUS_M = 50;
/**
 * Widened radius tried only when LANDMARK_RADIUS_M finds nothing at all.
 *
 * ⚠️ Not a theoretical edge case — verified on the real demo route. A turn
 * can sit at a road/path junction with no building or amenity within 50 m
 * even though the corridor around it isn't actually empty; 2 of the 5
 * manoeuvres on the real Blk 226 -> AMK Hub route had zero candidates at
 * LANDMARK_RADIUS_M once OneMap's `buffer` param was correctly enforced
 * client-side (see server/onemap.ts's reverseGeocode fix — before that fix,
 * OneMap's own leaky buffer was accidentally papering over this). Every
 * manoeuvre needs at least one landmark: `landmark_id` is a REQUIRED schema
 * field in server/llm.ts's rewrite call, so an empty set for any manoeuvre
 * breaks that step, not just degrades it.
 */
export const FALLBACK_RADIUS_M = 150;
/** Keep the prompt small and the choice obvious. */
export const MAX_LANDMARKS_PER_MANOEUVRE = 3;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Stable id for a building — same building, same id, regardless of which manoeuvre found it. */
function buildingId(b: Building): string {
  if (b.postal) return `bldg:${b.postal}`;
  if (b.block && b.road) return `bldg:${b.block}-${slugify(b.road)}`;
  return `bldg:${b.at.lat.toFixed(5)},${b.at.lng.toFixed(5)}`;
}

function buildingToLandmark(b: Building, manoeuvre: Manoeuvre): Landmark | null {
  let name: string;
  let kind: LandmarkKind;
  if (b.buildingName) {
    name = b.buildingName;
    kind = 'building';
  } else if (b.block && b.road) {
    name = `Block ${b.block} ${b.road}`;
    kind = 'block';
  } else {
    return null; // no usable name — see file header
  }

  return {
    id: buildingId(b),
    name,
    kind,
    at: b.at,
    distanceM: haversineM(manoeuvre.at, b.at),
    bearingDeg: bearingDeg(manoeuvre.at, b.at),
  };
}

function poiToLandmark(poi: Poi, manoeuvre: Manoeuvre): Landmark | null {
  if (!poi.name) return null; // no usable name — see file header

  return {
    id: `poi:${poi.id}`,
    name: poi.name,
    kind: poi.kind,
    at: poi.at,
    distanceM: haversineM(manoeuvre.at, poi.at),
    bearingDeg: bearingDeg(manoeuvre.at, poi.at),
  };
}

async function gatherCandidates(
  manoeuvre: Manoeuvre,
  places: PlaceProvider,
  amenities: readonly Poi[],
  radiusM: number,
): Promise<Landmark[]> {
  const buildings = await places.reverseGeocode(manoeuvre.at, radiusM);

  const candidates: Landmark[] = [];
  for (const b of buildings) {
    const landmark = buildingToLandmark(b, manoeuvre);
    if (landmark) candidates.push(landmark);
  }
  for (const poi of amenities) {
    if (haversineM(manoeuvre.at, poi.at) > radiusM) continue;
    const landmark = poiToLandmark(poi, manoeuvre);
    if (landmark) candidates.push(landmark);
  }
  return candidates;
}

async function collectForManoeuvre(
  manoeuvre: Manoeuvre,
  places: PlaceProvider,
  amenities: readonly Poi[],
): Promise<Landmark[]> {
  let candidates = await gatherCandidates(manoeuvre, places, amenities, LANDMARK_RADIUS_M);
  if (candidates.length === 0) {
    // See FALLBACK_RADIUS_M's doc — this isn't rare, verified on a real route.
    candidates = await gatherCandidates(manoeuvre, places, amenities, FALLBACK_RADIUS_M);
  }

  const ranked = rankForManoeuvre(manoeuvre, candidates);
  // Scope the id to this manoeuvre: Journey.landmarks is one flat array and
  // every Step.landmarkId must resolve unambiguously, but the same physical
  // building can legitimately be the nearest landmark to two different
  // manoeuvres (e.g. two turns around the same block), each with its own
  // distanceM/bearingDeg — those need to stay distinct entries.
  return ranked.map((l) => ({ ...l, id: `m${manoeuvre.index}:${l.id}` }));
}

/**
 * For each manoeuvre, reverse-geocode its position and union the result with
 * nearby baked amenities. Assign stable ids — Step.landmarkId points at these.
 *
 * Cache aggressively: a 10-step route is 10 reverse-geocode calls and OneMap
 * returns `429 Exceeded quota limit`. Key on coords rounded to 5 dp.
 * (`places.reverseGeocode` already does this — see server/onemap.ts's
 * `memoizeAsync` wiring — so this just needs to call it, not cache again.)
 *
 * Calls are issued in PARALLEL across manoeuvres, same reasoning as
 * comfort.ts's generateCandidates: serially this blows the latency budget.
 *
 * Ranks and trims to MAX_LANDMARKS_PER_MANOEUVRE per manoeuvre before
 * returning — this result IS `Journey.landmarks`, "the full allowed set"
 * server/llm.ts's rewriteToSteps hands to the model whole, so it has to
 * already be small and curated, not a raw dump for someone else to filter.
 */
export async function collectLandmarks(
  manoeuvres: readonly Manoeuvre[],
  places: PlaceProvider,
  amenities: readonly Poi[],
): Promise<Landmark[]> {
  const perManoeuvre = await Promise.all(
    manoeuvres.map((m) => collectForManoeuvre(m, places, amenities)),
  );
  return perManoeuvre.flat();
}

/**
 * Recognisability tier — lower is more identifiable while walking past it.
 * This is the PRIMARY sort key in rankForManoeuvre, not distance: "A named
 * building beats an unnamed block; a block beats a bare road name" ranks by
 * name quality first, per the original contract. distanceM only breaks ties
 * within the same tier.
 */
const KIND_TIER: Record<LandmarkKind, number> = {
  building: 0,
  hawker: 1,
  community: 1,
  eldercare: 1,
  park: 1,
  hospital: 1,
  pharmacy: 1,
  polyclinic: 1,
  block: 2,
  bus_stop: 3,
  shelter: 4,
  bench: 4,
  toilet: 4,
  lift: 4,
};

/**
 * Pick the best landmarks to anchor a single manoeuvre, nearest and most
 * recognisable first. A named building beats an unnamed block; a block beats
 * a bare road name.
 *
 * `manoeuvre` isn't read here — every candidate in `nearby` already carries
 * distanceM/bearingDeg computed relative to it (see buildingToLandmark /
 * poiToLandmark). Kept in the signature for interface stability and because
 * a future direction-aware refinement (e.g. preferring landmarks roughly
 * ahead of the turn over ones behind it) would need it; not built now since
 * nothing today needs it and Manoeuvre alone doesn't carry the incoming
 * heading required to do that correctly.
 */
export function rankForManoeuvre(manoeuvre: Manoeuvre, nearby: readonly Landmark[]): Landmark[] {
  void manoeuvre;
  return [...nearby]
    .sort((a, b) => {
      const tierDiff = KIND_TIER[a.kind] - KIND_TIER[b.kind];
      return tierDiff !== 0 ? tierDiff : a.distanceM - b.distanceM;
    })
    .slice(0, MAX_LANDMARKS_PER_MANOEUVRE);
}

/**
 * Display name for a landmark in the target language.
 *
 * Uses the curated nameZh/nameMs when present, else the verbatim English name.
 * Keeping "AMK Hub" inside a Mandarin sentence is how Singaporeans actually
 * speak — it is correct, not a defect. NEVER machine-translate a proper noun.
 *
 * No curated nameZh/nameMs source is wired up yet (would need a hand-authored
 * lookup — there's no dataset for this), so in practice every landmark falls
 * through to `name` today. That's the correct behaviour, not a shortcut: an
 * unset field is exactly what "curated name absent" means.
 */
export function localisedName(landmark: Landmark, lang: Lang): string {
  if (lang === 'zh' && landmark.nameZh) return landmark.nameZh;
  if (lang === 'ms' && landmark.nameMs) return landmark.nameMs;
  return landmark.name;
}
