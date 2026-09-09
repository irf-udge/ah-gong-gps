// Unit tests for core/geo.ts's pure geometry primitives. No I/O, no DOM —
// see the file's own header ("Everything here is PURE... Unit-test it freely").

import { describe, it, expect } from 'vitest';
import {
  boundsOf,
  decodePolyline,
  haversineM,
  bearingDeg,
  nearestOnPolyline,
  pathLengthM,
  pointAlong,
  poisWithinRadius,
  sampleShelterCoverage,
  withinRadius,
} from './geo';
import type { LatLng, Poi } from './types';

describe('haversineM', () => {
  it('is zero for identical points', () => {
    const p: LatLng = { lat: 1.3521, lng: 103.8198 };
    expect(haversineM(p, p)).toBe(0);
  });

  it('matches a known real-world distance within tolerance', () => {
    // 0.01 degree of longitude at ~1.3 deg latitude ≈ 111320 * cos(1.3°) * 0.01 ≈ 1113 m.
    const a: LatLng = { lat: 1.3, lng: 103.8 };
    const b: LatLng = { lat: 1.3, lng: 103.81 };
    const d = haversineM(a, b);
    expect(d).toBeGreaterThan(1050);
    expect(d).toBeLessThan(1180);
  });
});

describe('bearingDeg', () => {
  it('normalizes to 0..360 and matches the four cardinal directions', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 0);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 0);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(180, 0);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 0);
  });
});

describe('withinRadius', () => {
  it('is true inside and false outside the radius', () => {
    const a: LatLng = { lat: 0, lng: 0 };
    const near: LatLng = { lat: 0.001, lng: 0 }; // ≈ 111 m
    const far: LatLng = { lat: 1, lng: 0 }; // ≈ 111 km
    expect(withinRadius(a, near, 200)).toBe(true);
    expect(withinRadius(a, far, 200)).toBe(false);
  });
});

describe('decodePolyline', () => {
  it('decodes the canonical Google polyline algorithm example', () => {
    // From Google's own encoded-polyline documentation — a widely-used,
    // independently-verifiable reference vector, not derived from our code.
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const points = decodePolyline(encoded);
    expect(points).toHaveLength(3);
    expect(points[0]!.lat).toBeCloseTo(38.5, 4);
    expect(points[0]!.lng).toBeCloseTo(-120.2, 4);
    expect(points[1]!.lat).toBeCloseTo(40.7, 4);
    expect(points[1]!.lng).toBeCloseTo(-120.95, 4);
    expect(points[2]!.lat).toBeCloseTo(43.252, 4);
    expect(points[2]!.lng).toBeCloseTo(-126.453, 4);
  });

  it('returns an empty array for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('pathLengthM / pointAlong', () => {
  const path: LatLng[] = [
    { lat: 1.3, lng: 103.8 },
    { lat: 1.3, lng: 103.81 },
  ];

  it('pathLengthM is 0 for a degenerate (empty or single-point) path', () => {
    expect(pathLengthM([])).toBe(0);
    expect(pathLengthM([path[0]!])).toBe(0);
  });

  it('pointAlong clamps to the endpoints outside [0, total]', () => {
    const total = pathLengthM(path);
    const before = pointAlong(path, -100);
    const after = pointAlong(path, total + 1000);
    expect(before.lat).toBeCloseTo(path[0]!.lat, 6);
    expect(before.lng).toBeCloseTo(path[0]!.lng, 6);
    expect(after.lat).toBeCloseTo(path[1]!.lat, 3);
    expect(after.lng).toBeCloseTo(path[1]!.lng, 3);
  });

  it('pointAlong at the midpoint sits strictly between the endpoints', () => {
    const total = pathLengthM(path);
    const mid = pointAlong(path, total / 2);
    expect(mid.lng).toBeGreaterThan(path[0]!.lng);
    expect(mid.lng).toBeLessThan(path[1]!.lng);
  });
});

describe('nearestOnPolyline', () => {
  it('returns null for an empty path', () => {
    expect(nearestOnPolyline({ lat: 0, lng: 0 }, [])).toBeNull();
  });

  it('treats a single-point path as a degenerate case (distanceAlongM always 0)', () => {
    const p: LatLng = { lat: 1, lng: 1 };
    const result = nearestOnPolyline({ lat: 1, lng: 1.001 }, [p]);
    expect(result).not.toBeNull();
    expect(result!.distanceAlongM).toBe(0);
    expect(result!.distanceM).toBeGreaterThan(0);
  });

  it('snaps a point sitting on a two-point segment to itself, roughly midway along', () => {
    const path: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ];
    const onSegment: LatLng = { lat: 0, lng: 0.5 };
    const result = nearestOnPolyline(onSegment, path);
    expect(result).not.toBeNull();
    expect(result!.distanceM).toBeLessThan(1);

    const total = pathLengthM(path);
    expect(result!.distanceAlongM).toBeGreaterThan(total * 0.45);
    expect(result!.distanceAlongM).toBeLessThan(total * 0.55);
  });
});

describe('poisWithinRadius', () => {
  const path: LatLng[] = [
    { lat: 1.3, lng: 103.8 },
    { lat: 1.3, lng: 103.81 },
  ];

  it('includes POIs near the path and excludes distant ones', () => {
    const near: Poi = { id: 'near', kind: 'bench', name: 'Bench A', at: { lat: 1.3, lng: 103.805 } };
    const far: Poi = { id: 'far', kind: 'bench', name: 'Bench B', at: { lat: 1.5, lng: 104.0 } };
    const result = poisWithinRadius([near, far], path, 50);
    expect(result.map((p) => p.id)).toEqual(['near']);
  });

  it('returns an empty array for an empty POI list or a degenerate path', () => {
    expect(poisWithinRadius([], path, 50)).toEqual([]);
    const single: Poi = { id: 'x', kind: 'bench', name: null, at: { lat: 0, lng: 0 } };
    expect(poisWithinRadius([single], [path[0]!], 50)).toEqual([]);
  });
});

describe('sampleShelterCoverage', () => {
  it('marks samples near a shelter way as sheltered and far ones as not', () => {
    const path: LatLng[] = [
      { lat: 1.3, lng: 103.8 },
      { lat: 1.3, lng: 103.81 },
    ];
    // Shelter line running alongside only the FIRST half of the path.
    const shelter: Poi = {
      id: 'shelter-1',
      kind: 'shelter',
      name: 'Covered Linkway',
      at: { lat: 1.3, lng: 103.8 },
      path: [
        { lat: 1.3, lng: 103.8 },
        { lat: 1.3, lng: 103.805 },
      ],
    };
    const samples = sampleShelterCoverage(path, [shelter], 15, 10);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]!.sheltered).toBe(true); // start of path, right by the shelter
    expect(samples[samples.length - 1]!.sheltered).toBe(false); // end of path, far from it
  });

  it('returns an empty array for a zero-length path', () => {
    expect(sampleShelterCoverage([{ lat: 0, lng: 0 }], [], 10)).toEqual([]);
  });
});

describe('boundsOf', () => {
  it('returns null for an empty list', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('produces a box that contains every input point', () => {
    const points: LatLng[] = [
      { lat: 1.3, lng: 103.8 },
      { lat: 1.4, lng: 103.9 },
      { lat: 1.35, lng: 103.75 },
    ];
    const box = boundsOf(points);
    expect(box).not.toBeNull();
    for (const p of points) {
      expect(p.lat).toBeGreaterThanOrEqual(box!.minLat);
      expect(p.lat).toBeLessThanOrEqual(box!.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(box!.minLng);
      expect(p.lng).toBeLessThanOrEqual(box!.maxLng);
    }
  });
});
