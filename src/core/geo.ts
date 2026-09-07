// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
// Shared geometry primitives. Implemented up-front because BOTH teammates are
// blocked on it: C needs withinRadius/nearestOnPolyline for geofencing, A needs
// decodePolyline + distanceToPolylineM for comfort scoring.
//
// Everything here is PURE — no I/O, no DOM. Unit-test it freely.

import type { LatLng } from './types';

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

// ─── Distance & bearing ──────────────────────────────────────────────────────

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a→b, degrees clockwise from north (0..360). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLng = (b.lng - a.lng) * DEG;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function withinRadius(a: LatLng, b: LatLng, radiusM: number): boolean {
  return haversineM(a, b) <= radiusM;
}

// ─── Local planar projection ─────────────────────────────────────────────────
// Singapore spans ~50 km, so an equirectangular projection about a local origin
// is accurate to well under a metre — far below GPS noise. Good enough for
// point-to-segment maths, and much cheaper than doing it on the sphere.

interface XY {
  x: number;
  y: number;
}

function toLocalM(p: LatLng, origin: LatLng): XY {
  return {
    x: (p.lng - origin.lng) * DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG),
    y: (p.lat - origin.lat) * DEG * EARTH_RADIUS_M,
  };
}

function fromLocalM(p: XY, origin: LatLng): LatLng {
  return {
    lat: origin.lat + p.y / (DEG * EARTH_RADIUS_M),
    lng: origin.lng + p.x / (DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG)),
  };
}

/** Perpendicular distance from `p` to segment `a`→`b`, in metres. */
export function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const origin = a;
  const pp = toLocalM(p, origin);
  const bb = toLocalM(b, origin);

  const lenSq = bb.x * bb.x + bb.y * bb.y;
  if (lenSq === 0) return haversineM(p, a);

  // Clamp the projection to the segment so we never measure past an endpoint.
  const t = Math.max(0, Math.min(1, (pp.x * bb.x + pp.y * bb.y) / lenSq));
  const closest = fromLocalM({ x: bb.x * t, y: bb.y * t }, origin);
  return haversineM(p, closest);
}

// ─── Polylines ───────────────────────────────────────────────────────────────

export interface NearestOnPath {
  /** Index of the segment start vertex. */
  segmentIndex: number;
  at: LatLng;
  distanceM: number;
}

/** Closest point on a polyline to `p`. Returns null for an empty path. */
export function nearestOnPolyline(p: LatLng, path: readonly LatLng[]): NearestOnPath | null {
  if (path.length === 0) return null;

  const first = path[0];
  if (path.length === 1 || first === undefined) {
    // Single-vertex path: the vertex itself is the answer.
    const only = first ?? path[0];
    if (only === undefined) return null;
    return { segmentIndex: 0, at: only, distanceM: haversineM(p, only) };
  }

  let best: NearestOnPath = {
    segmentIndex: 0,
    at: first,
    distanceM: haversineM(p, first),
  };

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a === undefined || b === undefined) continue;

    const d = distanceToSegmentM(p, a, b);
    if (d < best.distanceM) {
      // Recover the actual closest point in the local frame.
      const pp = toLocalM(p, a);
      const bb = toLocalM(b, a);
      const lenSq = bb.x * bb.x + bb.y * bb.y;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (pp.x * bb.x + pp.y * bb.y) / lenSq));
      best = {
        segmentIndex: i,
        at: fromLocalM({ x: bb.x * t, y: bb.y * t }, a),
        distanceM: d,
      };
    }
  }

  return best;
}

/** Shortest distance from `p` to any part of the path, in metres. */
export function distanceToPolylineM(p: LatLng, path: readonly LatLng[]): number {
  return nearestOnPolyline(p, path)?.distanceM ?? Infinity;
}

/** Total length of a polyline, in metres. */
export function pathLengthM(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a === undefined || b === undefined) continue;
    total += haversineM(a, b);
  }
  return total;
}

/**
 * Decode Google's encoded-polyline format, which is what OneMap returns as
 * `route_geometry` for walk/drive routes. Precision 5 unless told otherwise.
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

// ─── Bounding boxes ──────────────────────────────────────────────────────────

/** Bounding box around a set of points, expanded by `padM` metres. */
export function boundsOf(points: readonly LatLng[], padM = 0): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} | null {
  if (points.length === 0) return null;

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const latPad = padM / (DEG * EARTH_RADIUS_M);
  const midLat = (minLat + maxLat) / 2;
  const lngPad = padM / (DEG * EARTH_RADIUS_M * Math.cos(midLat * DEG));

  return {
    minLat: minLat - latPad,
    minLng: minLng - lngPad,
    maxLat: maxLat + latPad,
    maxLng: maxLng + lngPad,
  };
}
