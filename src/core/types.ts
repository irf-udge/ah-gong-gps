// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
// This is THE contract. Everything in src/ and server/ compiles against it.
// If you need a shape that isn't here, ask A to add it — do not define a
// parallel type in your own file. See CONTRACTS.md § Core types.

// ─── Primitives ──────────────────────────────────────────────────────────────

/** Demo ships `zh` + `ms`. `en`/`ta` are reserved so the roadmap slide is honest. */
export type Lang = 'zh' | 'ms' | 'en' | 'ta';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Position {
  at: LatLng;
  accuracyM: number;
  /** ms since epoch. */
  timestamp: number;
}

/** Bounding box in OneMap `retrieveTheme` order: lat1,lng1,lat2,lng2. */
export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

// ─── Places & points of interest ─────────────────────────────────────────────

/** A result from OneMap search. Names come back in English, usually uppercase. */
export interface Place {
  id: string;
  /** e.g. "AMK HUB". Kept verbatim — never translated by the LLM. */
  name: string;
  address: string;
  postal: string | null;
  block: string | null;
  road: string | null;
  at: LatLng;
}

/**
 * A result from OneMap reverse-geocode.
 * NOTE: `buildingName` is null for unnamed buildings — which is most HDB blocks.
 * Fall back to `Block {block} {road}`. See CONTRACTS.md § Verified API facts.
 */
export interface Building {
  buildingName: string | null;
  block: string | null;
  road: string | null;
  postal: string | null;
  at: LatLng;
}

export type PoiKind =
  | 'shelter'
  | 'bench'
  | 'toilet'
  | 'lift'
  | 'bus_stop'
  | 'hawker'
  | 'community'
  | 'park'
  | 'eldercare'
  | 'hospital'
  | 'pharmacy'
  | 'polyclinic';

/**
 * A point (or, for shelter, a line) from a baked dataset (data/) or a OneMap
 * theme layer.
 *
 * `path` is set only for line-shaped amenities — covered walkways and
 * building-passage linkways from OSM/Overpass are LINES, not points, and
 * `kind: 'shelter'` is the one PoiKind that can carry one. `at` is still
 * always populated (the way's first vertex) so anything that only needs a
 * pin location keeps working without checking for `path`.
 */
export interface Poi {
  id: string;
  kind: PoiKind;
  name: string | null;
  at: LatLng;
  /** Only for line-shaped amenities (kind: 'shelter'). See core/geo.ts. */
  path?: LatLng[];
}

// ─── Landmarks ───────────────────────────────────────────────────────────────

export type LandmarkKind = PoiKind | 'building' | 'block';

/**
 * The ONLY things the LLM may refer to. Every landmark here was produced by a
 * real API response or a baked dataset — never by the model.
 *
 * `name` is emitted verbatim into spoken text. The LLM must not translate it;
 * use `nameZh` when a curated Chinese name exists. See CONTRACTS.md § Validation.
 */
export interface Landmark {
  id: string;
  name: string;
  nameZh?: string;
  nameMs?: string;
  kind: LandmarkKind;
  at: LatLng;
  /** Distance from the manoeuvre point this landmark anchors. */
  distanceM: number;
  bearingDeg: number;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export type Action = 'start' | 'straight' | 'left' | 'right' | 'cross' | 'arrive';

export interface Manoeuvre {
  index: number;
  at: LatLng;
  action: Action;
  /** OneMap's raw English instruction. Debugging only — NEVER spoken. */
  rawInstruction: string;
  /** Distance from the previous manoeuvre, in metres. */
  distanceM: number;
}

export interface RouteCandidate {
  id: string;
  /** Decoded from OneMap's encoded `route_geometry`. See core/geo.decodePolyline. */
  polyline: LatLng[];
  manoeuvres: Manoeuvre[];
  totalDistanceM: number;
  totalTimeS: number;
  /** null for the direct O→D route; set for waypoint-generated variants. */
  viaWaypoint: LatLng | null;
}

// ─── Comfort scoring (the differentiator) ────────────────────────────────────

export interface ComfortWeights {
  shelter: number;
  rest: number;
  toilet: number;
  gap: number;
  distance: number;
  stairs: number;
}

export interface ComfortScore {
  /** Weighted total. Higher is better. Only meaningful compared to sibling candidates. */
  total: number;
  /** 0..1 — fraction of the path within SHELTER_RADIUS_M of a covered linkway. */
  shelterCoverage: number;
  restPoints: number;
  toiletsNear: number;
  longestUnshelteredRunM: number;
  /** Metres walked beyond the direct route. */
  extraDistanceM: number;
  stairsCount: number;
}

export interface ScoredRoute {
  candidate: RouteCandidate;
  score: ComfortScore;
  /**
   * Plain-language justification in the target language.
   * TEMPLATE-GENERATED from the numbers above — never written by the LLM.
   */
  rationale: string;
}

// ─── Steps (what the senior actually hears) ──────────────────────────────────

export interface Step {
  index: number;
  /** MUST be the id of a Landmark supplied to the LLM. Enforced by core/validate. */
  landmarkId: string;
  action: Action;
  /** Target language. This is what TTS speaks. */
  spokenText: string;
  /** Short form for the huge-type display. */
  displayText: string;
}

// ─── Journey ─────────────────────────────────────────────────────────────────

export type JourneyPhase =
  | 'idle'
  | 'listening'
  | 'resolving'
  | 'clarifying'
  | 'planning'
  | 'ready'
  | 'navigating'
  | 'arrived'
  | 'lost'
  | 'error';

export interface Journey {
  id: string;
  lang: Lang;
  origin: LatLng;
  destination: Place;
  route: ScoredRoute;
  /** The full allowed set. Every Step.landmarkId indexes into this. */
  landmarks: Landmark[];
  steps: Step[];
}

export interface JourneyState {
  phase: JourneyPhase;
  journey: Journey | null;
  currentStepIndex: number;
  transcript: string | null;
  clarifyQuestion: string | null;
  error: string | null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type ViolationKind =
  | 'unknown_landmark'
  | 'invented_proper_noun'
  | 'step_count_mismatch'
  | 'empty_spoken_text';

export interface Violation {
  kind: ViolationKind;
  detail: string;
  stepIndex?: number;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
}

// ─── Server wire types (/api/*) ──────────────────────────────────────────────

export interface UnderstandRequest {
  /** 16 kHz mono WAV, base64, no data-URI prefix. See CONTRACTS.md § Audio. */
  audioBase64: string;
  lang: Lang;
  at: LatLng;
}

export interface UnderstandResponse {
  transcript: string;
  /** Set when resolution was unambiguous. */
  destination: Place | null;
  /** Set when we need to ask the user a question instead. Exactly one of these two is non-null. */
  clarify: { question: string; candidates: Place[] } | null;
}

export interface PlanJourneyRequest {
  origin: LatLng;
  destinationId: string;
  lang: Lang;
}

export interface PlanJourneyResponse {
  journey: Journey;
  /** Losing candidates, for the judge view (`?judge=1`). */
  rejected: ScoredRoute[];
}

export interface ReanchorRequest {
  at: LatLng;
  lang: Lang;
  journeyId: string;
}

export interface ReanchorResponse {
  /** e.g. "您现在在 AMK Hub 附近" — already localised. */
  spokenText: string;
  nearest: Landmark | null;
  /** Present when we re-routed from the new position. */
  journey: Journey | null;
}
