// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// The on-stage kill switch. With DEMO_MODE=1 every provider resolves from
// fixtures/ and the app makes ZERO network calls. Rehearse with this on.
//
// These are also what unblock B and C on day one: both can build a complete
// working app against fixtures before a single real API key exists.

import fixture from '../../fixtures/demo-route.json';
import type { BBox, Building, Lang, LatLng, Place, Poi, RouteCandidate } from '../core/types';
import type { PlaceProvider, RoutingProvider, SttProvider, Transcription } from './types';

/** Typed view of fixtures/demo-route.json. Shape is documented in CONTRACTS.md § Fixtures. */
export const DEMO_FIXTURE = fixture;

export class FixturePlaces implements PlaceProvider {
  readonly name = 'fixture';

  async search(_query: string): Promise<Place[]> {
    throw new Error('NOT_IMPLEMENTED: FixturePlaces.search');
  }

  async reverseGeocode(_at: LatLng, _bufferM: number): Promise<Building[]> {
    throw new Error('NOT_IMPLEMENTED: FixturePlaces.reverseGeocode');
  }

  async theme(_queryName: string, _bbox: BBox): Promise<Poi[]> {
    throw new Error('NOT_IMPLEMENTED: FixturePlaces.theme');
  }
}

export class FixtureRouting implements RoutingProvider {
  readonly name = 'fixture';

  async walkRoute(_from: LatLng, _to: LatLng): Promise<RouteCandidate> {
    throw new Error('NOT_IMPLEMENTED: FixtureRouting.walkRoute');
  }
}

/** Replays a canned transcript so the pipeline runs with no microphone at all. */
export class FixtureStt implements SttProvider {
  readonly name = 'fixture';

  async transcribe(_wav: Blob, _lang: Lang): Promise<Transcription> {
    throw new Error('NOT_IMPLEMENTED: FixtureStt.transcribe');
  }
}
