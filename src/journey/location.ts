// OWNER: C (Journey experience) — do not edit unless you are the owner.
//
// ⚠️ BUILD SimulatedProvider FIRST. It is not a fallback — it is the primary
// demo path (judges are indoors) AND the only way to develop the journey loop
// without walking around Ang Mo Kio. Real GPS comes later.

import type { LatLng, Position } from '../core/types';
import type { LocationProvider } from '../providers/types';

/** Step N fires when the user comes within this many metres of its manoeuvre. */
export const GEOFENCE_RADIUS_M = 25;
/** Must move this much further away before the fence can re-arm. Kills jitter. */
export const GEOFENCE_HYSTERESIS_M = 10;
/** Average older-adult walking pace. */
export const SIM_SPEED_MPS = 1.0;

/**
 * Replays a route polyline as if walking it. Give it speed control and a
 * jump-to-step so a demo can be driven from the judge view.
 *
 * Use core/geo.ts — nearestOnPolyline and haversineM do the interpolation work.
 */
export class SimulatedProvider implements LocationProvider {
  readonly name = 'simulated';

  constructor(
    private readonly path: readonly LatLng[],
    private readonly speedMps: number = SIM_SPEED_MPS,
  ) {}

  start(_onPosition: (p: Position) => void): void {
    throw new Error('NOT_IMPLEMENTED: SimulatedProvider.start');
  }

  stop(): void {
    throw new Error('NOT_IMPLEMENTED: SimulatedProvider.stop');
  }

  /** Demo control: teleport to a manoeuvre so a step can be re-shown on stage. */
  jumpTo(_fraction: number): void {
    throw new Error('NOT_IMPLEMENTED: SimulatedProvider.jumpTo');
  }

  setSpeed(_mps: number): void {
    throw new Error('NOT_IMPLEMENTED: SimulatedProvider.setSpeed');
  }
}

/**
 * Real device GPS. Needs a secure context (HTTPS) — see README § Testing on a
 * phone. Expect 10-30 m accuracy between HDB blocks, which is why the geofence
 * radius is 25 m and why hysteresis matters.
 */
export class GeolocationProvider implements LocationProvider {
  readonly name = 'gps';

  start(_onPosition: (p: Position) => void): void {
    throw new Error('NOT_IMPLEMENTED: GeolocationProvider.start');
  }

  stop(): void {
    throw new Error('NOT_IMPLEMENTED: GeolocationProvider.stop');
  }
}

/** Next/prev buttons. The last-resort stage fallback if everything else fails. */
export class ManualProvider implements LocationProvider {
  readonly name = 'manual';

  start(_onPosition: (p: Position) => void): void {
    throw new Error('NOT_IMPLEMENTED: ManualProvider.start');
  }

  stop(): void {
    throw new Error('NOT_IMPLEMENTED: ManualProvider.stop');
  }

  advance(): void {
    throw new Error('NOT_IMPLEMENTED: ManualProvider.advance');
  }
}
