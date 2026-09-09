// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Browser-side clients. These do NOT talk to OneMap directly — they call our
// own /api proxy, because the OneMap token must never reach the browser.
// The real OneMap client (token handling, refresh, caching) is server/onemap.ts.

import type { BBox, Building, LatLng, Place, Poi, RouteCandidate } from '../core/types';
import type { PlaceProvider, RoutingProvider } from './types';

export class OneMapPlaces implements PlaceProvider {
  readonly name = 'onemap';

  async search(_query: string): Promise<Place[]> {
    throw new Error('NOT_IMPLEMENTED: OneMapPlaces.search → GET /api/onemap/search');
  }

  /** `bufferM` is capped at 500 by OneMap, which returns at most 10 buildings. */
  async reverseGeocode(_at: LatLng, _bufferM: number): Promise<Building[]> {
    throw new Error('NOT_IMPLEMENTED: OneMapPlaces.reverseGeocode → GET /api/onemap/revgeocode');
  }

  async theme(_queryName: string, _bbox: BBox): Promise<Poi[]> {
    throw new Error('NOT_IMPLEMENTED: OneMapPlaces.theme → GET /api/onemap/theme');
  }
}

export class OneMapRouting implements RoutingProvider {
  readonly name = 'onemap';

  /**
   * routeType=walk only. There is NO barrier-free or covered-wayfinding option —
   * comfort is computed by core/comfort.ts from candidates this returns.
   */
  async walkRoute(_from: LatLng, _to: LatLng): Promise<RouteCandidate> {
    throw new Error('NOT_IMPLEMENTED: OneMapRouting.walkRoute → GET /api/onemap/route');
  }
}
