// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// The single wiring point. Everything else in the app depends on the INTERFACES
// in ./types, never on a concrete class — so swapping a backend is a change
// here and nowhere else.

import type { Providers } from './types';

export * from './types';

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
 * Build the provider set.
 *
 * Real path:   MeraLionStt → BrowserTts → OneMapRouting → OneMapPlaces → Simulated/Geolocation
 * Demo path:   FixtureStt  → BrowserTts → FixtureRouting → FixturePlaces → SimulatedProvider
 *
 * Note TTS is browser-native in BOTH paths — MERaLiON has no TTS endpoint and
 * speechSynthesis needs no network, so there is nothing to fixture.
 */
export function createProviders(_opts: ProviderOptions): Providers {
  throw new Error('NOT_IMPLEMENTED: createProviders — wire up once B and C land their classes');
}
