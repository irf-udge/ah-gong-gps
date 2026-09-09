// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
// The five swap points. Every provider has a real implementation AND a
// Fixture* implementation; `DEMO_MODE=1` swaps the whole set at once.
// See CONTRACTS.md § Provider interfaces.

import type {
  BBox,
  Building,
  LatLng,
  Lang,
  Place,
  Poi,
  Position,
  RouteCandidate,
} from '../core/types';

// ─── Speech in ───────────────────────────────────────────────────────────────

export interface Transcription {
  text: string;
  /** 0..1. Providers that don't report confidence return 1. */
  confidence: number;
}

/**
 * Implemented by: MeraLionStt (primary), WebSpeechStt (failover), FixtureStt.
 *
 * `wav` MUST be 16 kHz mono — MERaLiON rejects anything else. Producing it is
 * src/audio/capture.ts's job, not the provider's.
 *
 * ⚠️ `at` isn't in the original stub signature — added wiring up
 * `MeraLionStt`, which calls `POST /api/understand` and that endpoint
 * requires `UnderstandRequest.at` (nearby-buildings context for Gemini's
 * destination extraction — see server/index.ts). Nothing else needed it, so
 * `WebSpeechStt`/`FixtureStt` just ignore it.
 */
export interface SttProvider {
  readonly name: string;
  transcribe(wav: Blob, lang: Lang, at: LatLng): Promise<Transcription>;
}

// ─── Speech out ──────────────────────────────────────────────────────────────

/**
 * Implemented by: BrowserTts (speechSynthesis), FixtureTts.
 * MERaLiON has NO text-to-speech endpoint — do not go looking for one.
 */
export interface TtsProvider {
  readonly name: string;
  speak(text: string, lang: Lang): Promise<void>;
  cancel(): void;
  /** iOS/Safari refuses to speak until first invoked inside a user gesture. */
  primeForUserGesture(): void;
  /** Which of our target languages this device actually has a voice for. */
  availableLangs(): Lang[];
}

// ─── Routing ─────────────────────────────────────────────────────────────────

/**
 * Implemented by: OneMapRouting, FixtureRouting.
 *
 * OneMap only offers routeType walk|drive|pt|cycle — there is NO barrier-free
 * or covered-wayfinding option. Comfort is computed by core/comfort.ts from
 * candidates this provider returns. See CONTRACTS.md § Verified API facts.
 */
export interface RoutingProvider {
  readonly name: string;
  walkRoute(from: LatLng, to: LatLng): Promise<RouteCandidate>;
}

// ─── Places ──────────────────────────────────────────────────────────────────

/** Implemented by: OneMapPlaces, FixturePlaces. */
export interface PlaceProvider {
  readonly name: string;
  search(query: string): Promise<Place[]>;
  /** `bufferM` is capped at 500 by OneMap; it returns at most 10 buildings. */
  reverseGeocode(at: LatLng, bufferM: number): Promise<Building[]>;
  theme(queryName: string, bbox: BBox): Promise<Poi[]>;
}

// ─── Location ────────────────────────────────────────────────────────────────

/**
 * Implemented by: SimulatedProvider (BUILD THIS FIRST — it is the demo path),
 * GeolocationProvider, ManualProvider.
 */
export interface LocationProvider {
  readonly name: string;
  start(onPosition: (p: Position) => void): void;
  stop(): void;
}

// ─── The bundle ──────────────────────────────────────────────────────────────

/**
 * ⚠️ `location` is deliberately NOT a member here. SimulatedProvider's
 * constructor requires the route polyline up front — but a route doesn't
 * exist yet when the rest of this bundle is built (that happens once, at app
 * start / first mic tap; a route exists only after a journey is planned).
 * GPS/Manual don't need a path, but Simulated does, so `location` can't be
 * eagerly built the same way as the other four.
 *
 * Get one via `createLocationProvider(mode, path?)` in providers/index.ts,
 * called once a Journey (and therefore a route) exists — not at app start.
 */
export interface Providers {
  stt: SttProvider;
  tts: TtsProvider;
  routing: RoutingProvider;
  places: PlaceProvider;
}
