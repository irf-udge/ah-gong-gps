// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Browser-side clients. These do NOT talk to OneMap directly — they call our
// own /api proxy, because the OneMap token must never reach the browser.
// The real OneMap client (token handling, refresh, caching) is server/onemap.ts.

import type { BBox, Building, LatLng, Place, Poi, RouteCandidate } from '../core/types';
import type { PlaceProvider, RoutingProvider } from './types';

/**
 * Relative path — Vite's dev-server proxy (vite.config.ts) forwards `/api` to
 * our Express server, and prod serves both from the same origin. Never build
 * an absolute URL here; that's what would let a misconfigured build leak the
 * proxy target instead of just hitting same-origin.
 */
async function apiFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

export class OneMapPlaces implements PlaceProvider {
  readonly name = 'onemap';

  async search(query: string): Promise<Place[]> {
    return apiFetch<Place[]>('/api/onemap/search', { q: query });
  }

  /** `bufferM` is capped at 500 by OneMap, which returns at most 10 buildings. */
  async reverseGeocode(at: LatLng, bufferM: number): Promise<Building[]> {
    return apiFetch<Building[]>('/api/onemap/revgeocode', {
      lat: String(at.lat),
      lng: String(at.lng),
      bufferM: String(bufferM),
    });
  }

  async theme(queryName: string, bbox: BBox): Promise<Poi[]> {
    return apiFetch<Poi[]>('/api/onemap/theme', {
      queryName,
      minLat: String(bbox.minLat),
      minLng: String(bbox.minLng),
      maxLat: String(bbox.maxLat),
      maxLng: String(bbox.maxLng),
    });
  }
}

export class OneMapRouting implements RoutingProvider {
  readonly name = 'onemap';

  /**
   * routeType=walk only. There is NO barrier-free or covered-wayfinding option —
   * comfort is computed by core/comfort.ts from candidates this returns.
   */
  async walkRoute(from: LatLng, to: LatLng): Promise<RouteCandidate> {
    return apiFetch<RouteCandidate>('/api/onemap/route', {
      fromLat: String(from.lat),
      fromLng: String(from.lng),
      toLat: String(to.lat),
      toLng: String(to.lng),
    });
  }
}
