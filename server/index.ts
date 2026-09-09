// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// The thin API layer. It exists for exactly one reason: three secrets that must
// never reach the browser — the MERaLiON key, the OneMap token, the Gemini
// key. Everything else stays client-side.
//
// Routes are registered and return 501 until implemented, so `npm run dev`
// always comes up cleanly and the frontend can be built against real URLs.

import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createHash } from 'node:crypto';
import amenitiesData from '../data/amenities.json';
// ⚠️ Explicit .js extensions below — added deploying to Vercel. tsx (local
// dev) and Vite (the client bundle) both resolve extensionless/`.js`-suffixed
// TS specifiers flexibly, but Vercel's Node.js function runtime transpiles
// this file in isolation and hands it to Node's OWN ESM loader at runtime,
// which requires a fully-specified extension on every relative import —
// found live as `ERR_MODULE_NOT_FOUND` for every route, including /api/health.
// `moduleResolution: "bundler"` (tsconfig.json) explicitly permits a `.js`
// specifier resolving to a sibling `.ts` file, so this doesn't affect
// typechecking, Vite, or tsx — only makes Node's own loader happy too.
import { search, reverseGeocode, walkRoute, retrieveTheme } from './onemap.js';
import { transcribe } from './meralion.js';
import { extractDestination, rewriteToSteps } from './llm.js';
import { memoizeAsync } from './cache.js';
import { generateCandidates, scoreRoute, rankRoutes, describeScore } from '../src/core/comfort.js';
import { collectLandmarks, localisedName } from '../src/core/landmarks.js';
import { validateSteps, templateSteps, lowercaseFirst } from '../src/core/validate.js';
import { haversineM } from '../src/core/geo.js';
import { fill, ms, zh } from '../src/phrases/index.js';
import type {
  Building,
  Journey,
  Lang,
  LatLng,
  Manoeuvre,
  Place,
  PlanJourneyRequest,
  PlanJourneyResponse,
  Poi,
  ReanchorRequest,
  ReanchorResponse,
  ScoredRoute,
  UnderstandRequest,
  UnderstandResponse,
} from '../src/core/types';
import type { PlaceProvider, RoutingProvider } from '../src/providers/types';

const app = express();
const PORT = Number(process.env.API_PORT ?? 8787);

app.use(cors());

// ⚠️ Express defaults to a 100 KB JSON limit. A 5-second 16 kHz mono WAV is
// ~213 KB as base64, so the default silently 413s every transcription request.
app.use(express.json({ limit: '10mb' }));

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    demoMode: process.env.DEMO_MODE === '1',
    // Report which secrets are present WITHOUT leaking them — this is the
    // fastest way for a teammate to diagnose "why is nothing working".
    keys: {
      meralion: Boolean(process.env.MERALION_API_KEY),
      // Either auth path counts — a token-only setup is valid too (see
      // CONTRACTS.md § OneMap), just without auto-refresh on expiry.
      onemap: Boolean(process.env.ONEMAP_TOKEN || (process.env.ONEMAP_EMAIL && process.env.ONEMAP_PASSWORD)),
      gemini: Boolean(process.env.GEMINI_API_KEY),
    },
  });
});

// ─── Shared route-handler plumbing ─────────────────────────────────────────

/**
 * Wraps a handler so a thrown error becomes a JSON error response instead of
 * an unhandled rejection. A validation error (bad/missing body/query field)
 * throws with a `status` of 400; anything else — a real upstream failure
 * (OneMap, MERaLiON, Gemini) — is a 502, since the fault isn't the caller's
 * request. Shared by the OneMap proxies below AND the pipeline endpoints —
 * not OneMap-specific despite where it started.
 */
function apiRoute(handler: (req: express.Request) => Promise<unknown>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      const status = err instanceof Error && 'status' in err ? Number((err as { status: unknown }).status) : 502;
      const errorCode = status === 400 ? 'bad_request' : 'upstream_failed';
      res.status(status).json({ error: errorCode, detail: err instanceof Error ? err.message : String(err) });
    }
  };
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

const VALID_LANGS = new Set<string>(['zh', 'ms', 'en', 'ta']);
function requireLang(value: unknown, field: string): Lang {
  if (typeof value !== 'string' || !VALID_LANGS.has(value)) throw badRequest(`missing or invalid "${field}"`);
  return value as Lang;
}

function requireLatLng(value: unknown, field: string): LatLng {
  const v = value as Partial<LatLng> | undefined;
  if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number') throw badRequest(`missing or invalid "${field}"`);
  return { lat: v.lat, lng: v.lng };
}

function requirePlace(value: unknown, field: string): Place {
  const v = value as Partial<Place> | undefined;
  if (!v || typeof v.id !== 'string' || typeof v.name !== 'string') throw badRequest(`missing or invalid "${field}"`);
  requireLatLng(v.at, `${field}.at`);
  return v as Place;
}

function phraseBook(lang: Lang) {
  return lang === 'ms' ? ms : zh;
}

/** zh uses a full-width comma; everything else reads better with a plain one. Matches core/validate.ts's same choice. */
function clauseSeparator(lang: Lang): string {
  return lang === 'zh' ? '，' : ', ';
}

// ─── Providers, built once and reused across requests ──────────────────────
// Plain object literals satisfying the interfaces in src/providers/types —
// server/onemap.ts's exported functions are already stateless (and already
// cached, see server/cache.ts), so there's nothing per-request to construct.

const routing: RoutingProvider = { name: 'onemap-server', walkRoute };
const places: PlaceProvider = { name: 'onemap-server', search, reverseGeocode, theme: retrieveTheme };

const amenities = amenitiesData.pois as Poi[];

// ─── Speech-in helpers ──────────────────────────────────────────────────────

/**
 * MERaLiON returns the literal string "(nospeech)" for silent/toneless audio
 * — verified live (see server/meralion.ts's file header) — not an empty
 * string, not an error. Treat it the same as "didn't catch that."
 */
function isNoSpeech(transcript: string): boolean {
  return transcript.trim().toLowerCase() === '(nospeech)';
}

/** Costs real MERaLiON quota — cache by audio hash so testing the same clip twenty times costs one request. */
const transcribeMemoized = memoizeAsync(
  transcribe,
  (audioBase64: string) => createHash('sha256').update(audioBase64).digest('hex'),
  200,
);

/** Radius for "nearby buildings" context handed to Gemini's extractDestination — for context only, never authoritative. */
const NEARBY_CONTEXT_RADIUS_M = 200;

function buildingToPlace(b: Building, index: number): Place {
  const name = b.buildingName ?? (b.block && b.road ? `Block ${b.block} ${b.road}` : (b.road ?? 'Unknown'));
  return {
    id: b.postal ? `postal:${b.postal}` : `nearby:${index}`,
    name,
    address: [b.block, b.road].filter(Boolean).join(' ') || (b.postal ?? ''),
    postal: b.postal,
    block: b.block,
    road: b.road,
    at: b.at,
  };
}

/**
 * OneMap search for the same real building can return several entries that
 * differ only by postal sub-address (verified live — searching "AMK Hub"
 * itself returns 3: postal 569933/569934/567751, same BUILDING name). Those
 * aren't a genuine ambiguity worth asking the user to resolve; collapse them.
 */
function dedupeByName(candidates: readonly Place[]): Place[] {
  const seen = new Map<string, Place>();
  for (const p of candidates) {
    const key = p.name.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

// ─── Journey planning — shared by /api/journey and /api/reanchor ──────────

/**
 * Route + comfort scoring + landmark collection + LLM rewrite (retry once
 * with violations fed back, then the safe-by-construction template fallback
 * on a second failure) — CONTRACTS.md § 6's whole pipeline in one place, run
 * for real (not the fixture path — see providers/fixtures.ts::buildDemoJourney
 * for that).
 */
async function planJourneyCore(
  origin: LatLng,
  destination: Place,
  lang: Lang,
): Promise<{ journey: Journey; rejected: ScoredRoute[] }> {
  const candidates = await generateCandidates(origin, destination.at, routing, amenities);
  const directDistanceM = haversineM(origin, destination.at);

  const scored: ScoredRoute[] = candidates.map((candidate) => {
    const score = scoreRoute(candidate, amenities, directDistanceM);
    return { candidate, score, rationale: describeScore(score, lang) };
  });

  const ranked = rankRoutes(scored);
  const winner = ranked[0];
  if (!winner) throw new Error('planJourneyCore: no route candidates generated');
  const rejected = ranked.slice(1);

  const landmarks = await collectLandmarks(winner.candidate.manoeuvres, places, amenities);
  const expectedStepCount = winner.candidate.manoeuvres.length;

  let steps = await rewriteToSteps(winner.candidate.manoeuvres, landmarks, lang);
  let validation = validateSteps(steps, landmarks, expectedStepCount, lang);

  if (!validation.ok) {
    steps = await rewriteToSteps(winner.candidate.manoeuvres, landmarks, lang, validation.violations);
    validation = validateSteps(steps, landmarks, expectedStepCount, lang);
  }
  if (!validation.ok) {
    // THE ONE RULE (CONTRACTS.md § 6): nothing is ever spoken that hasn't
    // passed validateSteps(). Two failures means safe-by-construction, not a
    // third roll of the dice.
    steps = templateSteps(winner.candidate.manoeuvres, landmarks, lang);
  }

  const journey: Journey = {
    id: crypto.randomUUID(),
    lang,
    origin,
    destination,
    route: winner,
    landmarks,
    steps,
  };

  return { journey, rejected };
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/** Body: UnderstandRequest → UnderstandResponse. MERaLiON ASR + Gemini extraction. */
app.post(
  '/api/understand',
  apiRoute(async (req) => {
    const body = req.body as Partial<UnderstandRequest>;
    if (typeof body.audioBase64 !== 'string' || body.audioBase64 === '') throw badRequest('missing "audioBase64"');
    const lang = requireLang(body.lang, 'lang');
    const at = requireLatLng(body.at, 'at');

    const transcription = await transcribeMemoized(body.audioBase64);
    const transcript = transcription.text;

    if (isNoSpeech(transcript)) {
      const response: UnderstandResponse = {
        transcript,
        destination: null,
        clarify: { question: phraseBook(lang).notUnderstood, candidates: [] },
      };
      return response;
    }

    const nearbyBuildings = await reverseGeocode(at, NEARBY_CONTEXT_RADIUS_M).catch(() => []);
    const nearbyContext = nearbyBuildings.map(buildingToPlace);

    const extraction = await extractDestination(transcript, nearbyContext);
    // Prefer the DETECTED language over the request's hint once we have one
    // — Gemini's own detection is more likely correct than what the client
    // guessed before hearing anything.
    const responseLang = extraction.lang && VALID_LANGS.has(extraction.lang) ? extraction.lang : lang;
    const book = phraseBook(responseLang);

    if (!extraction.isDestinationRequest || !extraction.destinationPhrase) {
      const response: UnderstandResponse = {
        transcript,
        destination: null,
        clarify: { question: book.notUnderstood, candidates: [] },
      };
      return response;
    }

    const results = await search(extraction.destinationPhrase);
    const candidates = dedupeByName(results);

    let response: UnderstandResponse;
    if (candidates.length === 0) {
      response = { transcript, destination: null, clarify: { question: book.notUnderstood, candidates: [] } };
    } else if (candidates.length === 1) {
      response = { transcript, destination: candidates[0] ?? null, clarify: null };
    } else {
      const top = candidates[0];
      response = {
        transcript,
        destination: null,
        clarify: { question: top ? fill(book.confirmDestination, { place: top.name }) : book.notUnderstood, candidates },
      };
    }
    return response;
  }),
);

/** Body: PlanJourneyRequest → PlanJourneyResponse. Route + comfort + landmarks + rewrite. */
app.post(
  '/api/journey',
  apiRoute(async (req) => {
    const body = req.body as Partial<PlanJourneyRequest>;
    const origin = requireLatLng(body.origin, 'origin');
    const destination = requirePlace(body.destination, 'destination');
    const lang = requireLang(body.lang, 'lang');

    const { journey, rejected } = await planJourneyCore(origin, destination, lang);
    const response: PlanJourneyResponse = { journey, rejected };
    return response;
  }),
);

/** Body: ReanchorRequest → ReanchorResponse. The "I'm lost" button. */
app.post(
  '/api/reanchor',
  apiRoute(async (req) => {
    const body = req.body as Partial<ReanchorRequest>;
    const at = requireLatLng(body.at, 'at');
    const destination = requirePlace(body.destination, 'destination');
    const lang = requireLang(body.lang, 'lang');

    const syntheticManoeuvre: Manoeuvre = { index: 0, at, action: 'straight', rawInstruction: '', distanceM: 0 };
    const nearbyLandmarks = await collectLandmarks([syntheticManoeuvre], places, amenities);
    const nearest = nearbyLandmarks[0] ?? null;

    const book = phraseBook(lang);
    // book.recalculating is written capitalized (also spoken standalone
    // elsewhere) — lowercased for mid-sentence reuse here, same fix and same
    // reason as core/validate.ts's templateSteps composing `arrived`.
    const spokenText = nearest
      ? `${fill(book.youAreNear, { landmark: localisedName(nearest, lang) })}${clauseSeparator(lang)}${lowercaseFirst(book.recalculating)}`
      : book.recalculating;

    // "I'm lost" reassuring the user beats it failing outright — a failed
    // re-route still gets a spoken landmark anchor, just no new route.
    let journey: Journey | null = null;
    try {
      journey = (await planJourneyCore(at, destination, lang)).journey;
    } catch (err) {
      console.error('[reanchor] re-route failed, falling back to reassurance only:', err);
      journey = null;
    }

    const response: ReanchorResponse = { spokenText, nearest, journey };
    return response;
  }),
);

// ─── OneMap proxy ────────────────────────────────────────────────────────────
// Thin passthroughs so the token stays server-side. Cache aggressively here:
// OneMap returns `429 Exceeded quota limit` and a single journey is ~10
// reverse-geocode calls plus up to 8 routing calls.

/** Parses a required numeric query param; throws (→ 400 via apiRoute) if missing or not a number. */
function requireNumber(req: express.Request, key: string): number {
  const raw = req.query[key];
  const n = Number(raw);
  if (typeof raw !== 'string' || raw === '' || !Number.isFinite(n)) {
    throw Object.assign(new Error(`missing or invalid query param "${key}"`), { status: 400 });
  }
  return n;
}

app.get(
  '/api/onemap/search',
  apiRoute(async (req) => {
    const q = req.query.q;
    if (typeof q !== 'string' || q === '') throw Object.assign(new Error('missing query param "q"'), { status: 400 });
    return search(q);
  }),
);

app.get(
  '/api/onemap/revgeocode',
  apiRoute(async (req) => {
    const lat = requireNumber(req, 'lat');
    const lng = requireNumber(req, 'lng');
    const bufferM = requireNumber(req, 'bufferM');
    return reverseGeocode({ lat, lng }, bufferM);
  }),
);

app.get(
  '/api/onemap/route',
  apiRoute(async (req) => {
    const fromLat = requireNumber(req, 'fromLat');
    const fromLng = requireNumber(req, 'fromLng');
    const toLat = requireNumber(req, 'toLat');
    const toLng = requireNumber(req, 'toLng');
    return walkRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
  }),
);

app.get(
  '/api/onemap/theme',
  apiRoute(async (req) => {
    const queryName = req.query.queryName;
    if (typeof queryName !== 'string' || queryName === '') {
      throw Object.assign(new Error('missing query param "queryName"'), { status: 400 });
    }
    const minLat = requireNumber(req, 'minLat');
    const minLng = requireNumber(req, 'minLng');
    const maxLat = requireNumber(req, 'maxLat');
    const maxLng = requireNumber(req, 'maxLng');
    return retrieveTheme(queryName, { minLat, minLng, maxLat, maxLng });
  }),
);

// ⚠️ Guarded, not unconditional — added deploying to Vercel. A Vercel
// serverless function invokes this module's default export directly per
// request (see api/index.ts); it never calls .listen() itself, and binding
// a port inside that runtime is pointless at best. `VERCEL` is set
// automatically in that environment (not something we set ourselves) — see
// https://vercel.com/docs/environment-variables/system-environment-variables.
// `npm run dev:api` (no VERCEL var) is unaffected.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    if (process.env.DEMO_MODE === '1') {
      console.log('[api] DEMO_MODE=1 — fixtures only, no outbound calls');
    }
  });
}

export default app;
