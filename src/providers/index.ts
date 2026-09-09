// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// The single wiring point. Everything else in the app depends on the INTERFACES
// in ./types, never on a concrete class — so swapping a backend is a change
// here and nowhere else.

import { FixturePlaces, FixtureRouting, FixtureStt } from './fixtures';
import { OneMapPlaces, OneMapRouting } from './onemap';
import { createStt } from './stt';
import { BrowserTts } from './tts';
import { GeolocationProvider, ManualProvider, SimulatedProvider } from '../journey/location';
import type { LatLng } from '../core/types';
import type { LocationProvider, Providers } from './types';

export * from './types';
export { buildDemoJourney, buildDemoRejected, buildDemoScoredRoute, DEMO_FIXTURE } from './fixtures';

export interface ProviderOptions {
  /** DEMO_MODE=1 → every provider becomes its Fixture* counterpart. */
  demoMode: boolean;
  /** Simulated location playback is the primary demo path; GPS is the fallback. */
  location: 'simulated' | 'gps' | 'manual';
}

export function readProviderOptions(): ProviderOptions {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  return {
    demoMode: import.meta.env.VITE_DEMO_MODE === '1' || params.get('demo') === '1',
    location: (params.get('loc') as ProviderOptions['location']) ?? 'simulated',
  };
}

/**
 * Build the provider set — everything EXCEPT location (see providers/types.ts
 * for why: SimulatedProvider needs a route polyline that doesn't exist yet at
 * app-start time). Call this once, e.g. on first mic tap.
 *
 * Real path:   MeraLionStt/WebSpeechStt (via createStt) → BrowserTts → OneMapRouting → OneMapPlaces
 * Demo path:   FixtureStt                               → BrowserTts → FixtureRouting → FixturePlaces
 *
 * TTS is BrowserTts in BOTH paths on purpose — MERaLiON has no TTS endpoint
 * and speechSynthesis needs no network, so there is nothing to fixture. (B's
 * FixtureTts exists too, but for headless tests, not for DEMO_MODE — going
 * silent is the one thing the on-stage kill switch must never do.)
 *
 * STT selection is delegated to stt.createStt(), not reimplemented here —
 * the MERaLiON-vs-WebSpeech race/fallback logic belongs in stt.ts, not
 * duplicated here; this file only decides demoMode, not how a non-demo
 * failover behaves.
 */
export function createProviders(opts: ProviderOptions): Providers {
  return {
    stt: opts.demoMode ? new FixtureStt() : createStt({ demoMode: opts.demoMode }),
    tts: new BrowserTts(),
    routing: opts.demoMode ? new FixtureRouting() : new OneMapRouting(),
    places: opts.demoMode ? new FixturePlaces() : new OneMapPlaces(),
  };
}

/**
 * The fifth provider, built separately once a route exists (see
 * providers/types.ts). `path` is required for `'simulated'` — that's the
 * primary demo path (judges are indoors), not a fallback, so a missing path
 * there is a real bug in the caller, not a case to silently paper over.
 *
 * `speedMps` is `'simulated'`-only (ignored otherwise — GPS/Manual have no
 * playback speed concept) and defaults to `SIM_SPEED_MPS` (1 m/s, realistic
 * walking pace) if omitted. ⚠️ That default is for developing/testing the
 * geofence logic at a believable pace, NOT for an on-stage demo — found
 * wiring up ui/App.tsx: at 1x, a real ~700m route takes ~12 minutes to walk.
 * Callers driving an actual demo playback should pass an accelerated value
 * explicitly (`SimulatedProvider`'s own doc names `setSpeed()`/`jumpTo()` as
 * "the actual on-stage mechanism, not an afterthought" — this parameter is
 * the equivalent at construction time).
 */
export function createLocationProvider(
  mode: ProviderOptions['location'],
  path?: readonly LatLng[],
  speedMps?: number,
): LocationProvider {
  switch (mode) {
    case 'simulated':
      if (!path || path.length === 0) {
        throw new Error('createLocationProvider: "simulated" needs a non-empty route path');
      }
      return new SimulatedProvider(path, speedMps);
    case 'gps':
      return new GeolocationProvider();
    case 'manual':
      return new ManualProvider();
  }
}
