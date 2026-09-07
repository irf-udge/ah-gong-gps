// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
//
// Builds the set of real-world things the LLM is allowed to talk about.
// EVERY landmark here originates from a OneMap response or a baked dataset.
// The model never sources one — it only selects from what we hand it.
//
// Reality check on the data (see CONTRACTS.md § Verified API facts):
// reverseGeocode returns BUILDINGS, not POIs. `buildingName` is null for most
// HDB blocks, so expect "Block 123" far more often than "the coffee shop".

import type { Landmark, Manoeuvre, Poi } from './types';
import type { PlaceProvider } from '../providers/types';

/** OneMap caps the reverse-geocode buffer at 500 m; 50 m is our landmark radius. */
export const LANDMARK_RADIUS_M = 50;
/** Keep the prompt small and the choice obvious. */
export const MAX_LANDMARKS_PER_MANOEUVRE = 3;

/**
 * For each manoeuvre, reverse-geocode its position and union the result with
 * nearby baked amenities. Assign stable ids — Step.landmarkId points at these.
 *
 * Cache aggressively: a 10-step route is 10 reverse-geocode calls and OneMap
 * returns `429 Exceeded quota limit`. Key on coords rounded to 5 dp.
 */
export async function collectLandmarks(
  _manoeuvres: readonly Manoeuvre[],
  _places: PlaceProvider,
  _amenities: readonly Poi[],
): Promise<Landmark[]> {
  throw new Error('NOT_IMPLEMENTED: landmarks.collectLandmarks');
}

/**
 * Pick the best landmarks to anchor a single manoeuvre, nearest and most
 * recognisable first. A named building beats an unnamed block; a block beats
 * a bare road name.
 */
export function rankForManoeuvre(
  _manoeuvre: Manoeuvre,
  _nearby: readonly Landmark[],
): Landmark[] {
  throw new Error('NOT_IMPLEMENTED: landmarks.rankForManoeuvre');
}

/**
 * Display name for a landmark in the target language.
 *
 * Uses the curated nameZh/nameMs when present, else the verbatim English name.
 * Keeping "AMK Hub" inside a Mandarin sentence is how Singaporeans actually
 * speak — it is correct, not a defect. NEVER machine-translate a proper noun.
 */
export function localisedName(_landmark: Landmark, _lang: string): string {
  throw new Error('NOT_IMPLEMENTED: landmarks.localisedName');
}
