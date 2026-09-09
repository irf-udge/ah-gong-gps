// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// ⚠️ BUILD SimulatedProvider FIRST. It is not a fallback — it is the primary
// demo path (judges are indoors) AND the only way to develop the journey loop
// without walking around Ang Mo Kio. Real GPS comes later.

import type { LatLng, Position } from '../core/types';
import type { LocationProvider } from '../providers/types';
import { pathLengthM, pointAlong } from '../core/geo';

/** Step N fires when the user comes within this many metres of its manoeuvre. */
export const GEOFENCE_RADIUS_M = 25;
/** Must move this much further away before the fence can re-arm. Kills jitter. */
export const GEOFENCE_HYSTERESIS_M = 10;
/** Average older-adult walking pace. */
export const SIM_SPEED_MPS = 1.0;
/** How often playback ticks. 500ms at SIM_SPEED_MPS is ~0.5m/tick — plenty fine-grained against GEOFENCE_RADIUS_M. */
const TICK_MS = 500;
/**
 * Reported accuracy for simulated positions. Small and constant on purpose —
 * this is a deliberately "good" GPS fix, unlike GeolocationProvider's real
 * 10-30m, so geofence/hysteresis logic can be developed and demoed without
 * real-GPS noise in the way. Real noise gets tested against the real thing.
 */
const SIM_ACCURACY_M = 5;

/**
 * Replays a route polyline as if walking it. Give it speed control and a
 * jump-to-step so a demo can be driven from the judge view.
 *
 * Uses core/geo.ts's pointAlong for the interpolation — built for exactly
 * this (see its own doc comment).
 *
 * ⚠️ SIM_SPEED_MPS (1 m/s) is REALISTIC walking pace, not stage pace — a 745m
 * demo route would take ~12 minutes at 1x. That's intentional: setSpeed()
 * and jumpTo() are the actual on-stage mechanism (per this class's own
 * original doc), not an afterthought. Default to 1x for dev/testing the
 * geofence/hysteresis logic at a believable pace; crank it up for the demo.
 */
export class SimulatedProvider implements LocationProvider {
  readonly name = 'simulated';

  private readonly totalM: number;
  private speedMps: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onPosition: ((p: Position) => void) | null = null;
  /** distanceAlongM at the start of the current playback "leg" (since the last start/jumpTo/setSpeed). */
  private baseDistanceAlongM = 0;
  /** Wall-clock time the current leg began — elapsed-since-this, not accumulated ticks, avoids setInterval drift. */
  private legStartedAtMs = 0;

  constructor(
    private readonly path: readonly LatLng[],
    speedMps: number = SIM_SPEED_MPS,
  ) {
    if (path.length === 0) throw new Error('SimulatedProvider: path must not be empty');
    this.speedMps = speedMps;
    this.totalM = pathLengthM(path);
  }

  /** Recomputed fresh from wall-clock time on every call — never accumulated tick-by-tick. */
  private currentDistanceAlongM(): number {
    const elapsedS = (Date.now() - this.legStartedAtMs) / 1000;
    return Math.min(this.totalM, this.baseDistanceAlongM + elapsedS * this.speedMps);
  }

  private emit(): void {
    if (!this.onPosition) return;
    const at = pointAlong(this.path, this.currentDistanceAlongM());
    this.onPosition({ at, accuracyM: SIM_ACCURACY_M, timestamp: Date.now() });
  }

  /** Rebase playback so the next tick continues smoothly from right now — call before changing speed or position. */
  private rebase(): void {
    this.baseDistanceAlongM = this.currentDistanceAlongM();
    this.legStartedAtMs = Date.now();
  }

  start(onPosition: (p: Position) => void): void {
    this.stop(); // idempotent restart — never stack two timers
    this.onPosition = onPosition;
    this.baseDistanceAlongM = 0;
    this.legStartedAtMs = Date.now();
    this.emit(); // fire immediately so the UI isn't blank until the first tick
    this.timer = setInterval(() => this.emit(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onPosition = null;
  }

  /**
   * Demo control: teleport to a manoeuvre so a step can be re-shown on stage.
   * `fraction` is 0..1 along the WHOLE route (clamped); works whether or not
   * playback is currently running.
   */
  jumpTo(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.baseDistanceAlongM = clamped * this.totalM;
    this.legStartedAtMs = Date.now();
    this.emit();
  }

  /** Changes pace without a discontinuity — rebases first so position doesn't jump at the moment of the change. */
  setSpeed(mps: number): void {
    this.rebase();
    this.speedMps = mps;
  }
}

/**
 * Real device GPS. Needs a secure context (HTTPS) — see README § Testing on a
 * phone. Expect 10-30 m accuracy between HDB blocks, which is why the geofence
 * radius is 25 m and why hysteresis matters.
 */
export class GeolocationProvider implements LocationProvider {
  readonly name = 'gps';

  private watchId: number | null = null;

  start(onPosition: (p: Position) => void, onError?: (err: Error) => void): void {
    if (!('geolocation' in navigator)) {
      throw new Error(
        'GeolocationProvider: navigator.geolocation is unavailable — needs a secure (HTTPS) context, see README § Testing on a phone',
      );
    }
    this.stop(); // idempotent restart — never stack two watches

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onPosition({
          at: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracyM: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        // GeolocationPositionError isn't a real Error -- wrap it so onError's
        // contract (an actual Error) holds regardless of caller.
        onError?.(new Error(`GeolocationProvider: ${err.message || 'position unavailable'} (code ${err.code})`));
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

/**
 * Next/prev buttons. The last-resort stage fallback if everything else fails.
 * `start()` reports the first point of `path` immediately — `advance()` is
 * what actually moves it forward, driven by a UI button tap, not a timer or
 * a real position source. Takes `path` via constructor, same as
 * `SimulatedProvider` — both need the route up front, from
 * `createLocationProvider()` in providers/index.ts.
 */
export class ManualProvider implements LocationProvider {
  readonly name = 'manual';

  private index = 0;
  private onPosition: ((p: Position) => void) | null = null;

  constructor(private readonly path: readonly LatLng[] = []) {}

  start(onPosition: (p: Position) => void): void {
    this.onPosition = onPosition;
    this.index = 0;
    this.emit();
  }

  stop(): void {
    this.onPosition = null;
  }

  private emit(): void {
    if (!this.onPosition) return;
    const at = this.path[this.index];
    if (!at) return; // empty path -- nothing to report
    this.onPosition({ at, accuracyM: 0, timestamp: Date.now() });
  }

  /** Steps to the next point in the path, clamped at the end — never throws on repeated taps past the last step. */
  advance(): void {
    if (this.path.length === 0) return;
    this.index = Math.min(this.index + 1, this.path.length - 1);
    this.emit();
  }
}
