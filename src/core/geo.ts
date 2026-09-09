// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Shared geometry primitives, built on turf.js (@turf/turf) rather than
// hand-rolled trig — turf does proper spherical/geodesic math and gives us
// polygon buffering, line slicing, and line-vs-line proximity for free,
// none of which is worth reimplementing by hand under deadline pressure.
// See CONTRACTS.md § Geometry for the full function → use-case map.
//
// ⚠️ THE ONE THING TO GET RIGHT: turf positions are `[lng, lat]` — the
// OPPOSITE order from our `LatLng {lat, lng}` used everywhere else in this
// codebase. Every conversion goes through toPosition/toPoint/toLineString
// below — never build a turf Position by hand anywhere else in the app;
// that's exactly how a silently-swapped coordinate turns into "the shelter
// score is nonsense" three hours before a deadline.
//
// Everything here is PURE — no I/O, no DOM. Unit-test it freely.

import { along } from '@turf/along';
import { bbox } from '@turf/bbox';
import { bearing } from '@turf/bearing';
import { buffer } from '@turf/buffer';
import { distance } from '@turf/distance';
import { featureCollection, lineString, point } from '@turf/helpers';
import { length } from '@turf/length';
import { lineSlice } from '@turf/line-slice';
import { nearestPointOnLine } from '@turf/nearest-point-on-line';
import { pointToLineDistance } from '@turf/point-to-line-distance';
import { pointsWithinPolygon } from '@turf/points-within-polygon';
import type { Feature, LineString, Point, Polygon, Position } from 'geojson';

import type { BBox, LatLng, Poi } from './types';

// ─── LatLng ⇄ turf adapters (the ONLY place the [lng,lat] swap happens) ──────

export function toPosition(p: LatLng): Position {
  return [p.lng, p.lat];
}

export function fromPosition(pos: Position): LatLng {
  const lng = pos[0];
  const lat = pos[1];
  if (lng === undefined || lat === undefined) throw new Error('fromPosition: empty position');
  return { lat, lng };
}

export function toPoint(p: LatLng): Feature<Point> {
  return point(toPosition(p));
}

export function toLineString(path: readonly LatLng[]): Feature<LineString> {
  return lineString(path.map(toPosition));
}

// ─── Distance & bearing ──────────────────────────────────────────────────────

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  return distance(toPoint(a), toPoint(b), { units: 'meters' });
}

/** Initial bearing a→b, degrees clockwise from north (0..360). turf returns -180..180. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  return (bearing(toPoint(a), toPoint(b)) + 360) % 360;
}

export function withinRadius(a: LatLng, b: LatLng, radiusM: number): boolean {
  return haversineM(a, b) <= radiusM;
}

// ─── Polylines ───────────────────────────────────────────────────────────────

export interface NearestOnPath {
  at: LatLng;
  distanceM: number;
  /**
   * Distance travelled ALONG the path to reach `at`, in metres from path[0].
   * This is what journey/machine.ts's geofencing should key off — it's a
   * monotonic progress measure, unlike raw proximity to a manoeuvre point,
   * and isn't fooled by GPS jitter the way a radius-circle test can be.
   */
  distanceAlongM: number;
}

/** Closest point on a polyline to `p`, plus how far along the polyline it is. */
export function nearestOnPolyline(p: LatLng, path: readonly LatLng[]): NearestOnPath | null {
  if (path.length === 0) return null;

  const first = path[0];
  if (path.length === 1 || first === undefined) {
    if (first === undefined) return null;
    return { at: first, distanceM: haversineM(p, first), distanceAlongM: 0 };
  }

  const snapped = nearestPointOnLine(toLineString(path), toPoint(p), { units: 'meters' });
  return {
    at: fromPosition(snapped.geometry.coordinates),
    distanceM: snapped.properties.dist ?? 0,
    distanceAlongM: snapped.properties.location ?? 0,
  };
}

/** Shortest distance from `p` to any part of the path, in metres. */
export function distanceToPolylineM(p: LatLng, path: readonly LatLng[]): number {
  return nearestOnPolyline(p, path)?.distanceM ?? Infinity;
}

/** Perpendicular distance from `p` to segment `a`→`b`, in metres. */
export function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  return distanceToPolylineM(p, [a, b]);
}

/** Total length of a polyline, in metres. */
export function pathLengthM(path: readonly LatLng[]): number {
  if (path.length < 2) return 0;
  return length(toLineString(path), { units: 'meters' });
}

/**
 * Extract just the leg of `path` between `from` and `to` (each snapped to its
 * nearest point on the path first). Used to score or narrate ONE
 * manoeuvre-to-manoeuvre stretch instead of the whole route — e.g. "this leg
 * is sheltered" per step, not only a single whole-journey rationale.
 */
export function sliceLeg(path: readonly LatLng[], from: LatLng, to: LatLng): LatLng[] {
  const sliced = lineSlice(toPoint(from), toPoint(to), toLineString(path));
  return sliced.geometry.coordinates.map(fromPosition);
}

/**
 * Point at `distanceM` along `path` from its start (clamped to the endpoints).
 * This is what a GPS-simulating LocationProvider should use to interpolate
 * the walked position — see journey/location.ts's SimulatedProvider (owner Lija).
 */
export function pointAlong(path: readonly LatLng[], distanceM: number): LatLng {
  const first = path[0];
  if (first === undefined) throw new Error('pointAlong: empty path');
  if (path.length === 1) return first;

  const total = pathLengthM(path);
  const clamped = Math.max(0, Math.min(distanceM, total));
  const pt = along(toLineString(path), clamped, { units: 'meters' });
  return fromPosition(pt.geometry.coordinates);
}

/**
 * Decode Google's encoded-polyline format, which is what OneMap returns as
 * `route_geometry` for walk/drive routes. Precision 5 unless told otherwise.
 * (No turf equivalent — this is OneMap's wire format, not a geometry op.)
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push({ lat: lat / factor, lng: lng / factor });
  }

  return out;
}

// ─── Comfort envelopes — @turf/buffer + @turf/points-within-polygon ─────────
// The "draw a zone around the route and see what falls inside it" primitive.
// Point amenities (benches, toilets) fit this directly. Shelter (a LINE
// amenity) does not — see sampleShelterCoverage below for that case.

/**
 * Buffer a path (or a single leg) by `radiusM` to get its "comfort envelope"
 * polygon — everything within `radiusM` of this stretch of route.
 */
export function routeBuffer(path: readonly LatLng[], radiusM: number): Feature<Polygon> {
  if (path.length < 2) throw new Error('routeBuffer: path needs at least 2 points');
  const buffered = buffer(toLineString(path), radiusM, { units: 'meters' });
  if (!buffered) throw new Error('routeBuffer: buffer() returned no geometry');
  // buffer() on a LineString can yield Polygon or MultiPolygon depending on
  // self-intersection; our corridors are short and simple, so Polygon in
  // practice. If this ever throws, switch the return type to include
  // MultiPolygon rather than widen it defensively for a case we don't hit.
  return buffered as Feature<Polygon>;
}

/**
 * Which of `pois` fall within `radiusM` of `path`, by each POI's representative
 * point (`.at` — for line-shaped shelter entries that's the way's first
 * vertex). One buffer + one bulk filter, not a manual per-point distance loop.
 *
 * Two different callers, same function: core/comfort.ts uses this both to
 * pick candidate waypoints (any kind, near the direct O→D corridor) and to
 * count benches/toilets within a scoring radius (pre-filter `pois` by kind
 * first). For shelter *coverage* specifically — which needs the full line,
 * not just a point — use sampleShelterCoverage instead.
 */
export function poisWithinRadius(
  pois: readonly Poi[],
  path: readonly LatLng[],
  radiusM: number,
): Poi[] {
  if (pois.length === 0 || path.length < 2) return [];

  const envelope = routeBuffer(path, radiusM);
  const fc = featureCollection(pois.map((poi) => point(toPosition(poi.at), { poiId: poi.id })));
  const within = pointsWithinPolygon(fc, envelope);
  const ids = new Set(within.features.map((f) => f.properties?.poiId as string));
  return pois.filter((poi) => ids.has(poi.id));
}

// ─── Shelter coverage — sampling + @turf/point-to-line-distance ─────────────
// Shelter (covered walkways, building-passage linkways) is LINEAR, not point
// data, so "buffer the route, filter points inside it" doesn't apply. Instead
// we sample the route every `stepM` and ask "is this sample near ANY shelter
// line" — simple, robust, and easy to reason about under time pressure,
// versus exact polygon-intersection geometry.

export interface ShelterSample {
  at: LatLng;
  /** Metres travelled along the route to reach this sample. */
  distanceAlongM: number;
  sheltered: boolean;
}

/**
 * Sample `path` every `stepM` metres and test each sample against
 * `shelterWays` (Poi entries with kind:'shelter' and a `path`) for proximity
 * within `radiusM`. core/comfort.ts derives shelterCoverage (fraction
 * sheltered) and longestUnshelteredRunM (longest consecutive false streak)
 * straight from this.
 */
export function sampleShelterCoverage(
  path: readonly LatLng[],
  shelterWays: readonly Poi[],
  radiusM: number,
  stepM = 10,
): ShelterSample[] {
  const total = pathLengthM(path);
  if (total === 0) return [];

  const lines = shelterWays
    .filter((poi): poi is Poi & { path: LatLng[] } => Array.isArray(poi.path) && poi.path.length >= 2)
    .map((poi) => toLineString(poi.path));
  if (lines.length === 0) {
    // No shelter data at all — every sample is honestly unsheltered, not an error.
  }

  const samples: ShelterSample[] = [];
  const steps = Math.max(1, Math.ceil(total / stepM));
  for (let i = 0; i <= steps; i++) {
    const d = Math.min(i * stepM, total);
    const at = pointAlong(path, d);
    const pt = toPoint(at);
    const sheltered = lines.some((line) => pointToLineDistance(pt, line, { units: 'meters' }) <= radiusM);
    samples.push({ at, distanceAlongM: d, sheltered });
    if (d === total) break;
  }
  return samples;
}

// ─── Bounding boxes ──────────────────────────────────────────────────────────

/** Bounding box around a set of points, expanded by `padM` metres. */
export function boundsOf(points: readonly LatLng[], padM = 0): BBox | null {
  if (points.length === 0) return null;

  const fc = featureCollection(points.map(toPoint));
  const region = padM > 0 ? (buffer(fc, padM, { units: 'meters' }) ?? fc) : fc;
  const [minLng, minLat, maxLng, maxLat] = bbox(region);
  return { minLat, minLng, maxLat, maxLng };
}
