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
import { search, reverseGeocode, walkRoute, retrieveTheme } from './onemap';

const app = express();
const PORT = Number(process.env.API_PORT ?? 8787);

app.use(cors());

// ⚠️ Express defaults to a 100 KB JSON limit. A 5-second 16 kHz mono WAV is
// ~213 KB as base64, so the default silently 413s every transcription request.
app.use(express.json({ limit: '10mb' }));

const notImplemented = (name: string) => (_req: express.Request, res: express.Response) => {
  res.status(501).json({ error: 'NOT_IMPLEMENTED', endpoint: name });
};

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

// ─── Pipeline ────────────────────────────────────────────────────────────────

/** Body: UnderstandRequest → UnderstandResponse. MERaLiON ASR + Gemini extraction. */
app.post('/api/understand', notImplemented('POST /api/understand'));

/** Body: PlanJourneyRequest → PlanJourneyResponse. Route + comfort + landmarks + rewrite. */
app.post('/api/journey', notImplemented('POST /api/journey'));

/** Body: ReanchorRequest → ReanchorResponse. The "I'm lost" button. */
app.post('/api/reanchor', notImplemented('POST /api/reanchor'));

// ─── OneMap proxy ────────────────────────────────────────────────────────────
// Thin passthroughs so the token stays server-side. Cache aggressively here:
// OneMap returns `429 Exceeded quota limit` and a single journey is ~10
// reverse-geocode calls plus up to 8 routing calls.

/**
 * Wraps a handler so a thrown error becomes a JSON error response instead of
 * an unhandled rejection. A validation error (bad/missing query param) throws
 * with a `status` of 400; anything else — a real OneMap failure — is a 502,
 * since the fault is upstream, not with the caller's request.
 */
function onemapRoute(handler: (req: express.Request) => Promise<unknown>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      const status = err instanceof Error && 'status' in err ? Number((err as { status: unknown }).status) : 502;
      const errorCode = status === 400 ? 'bad_request' : 'onemap_upstream_failed';
      res.status(status).json({ error: errorCode, detail: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** Parses a required numeric query param; throws (→ 400 via onemapRoute) if missing or not a number. */
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
  onemapRoute(async (req) => {
    const q = req.query.q;
    if (typeof q !== 'string' || q === '') throw Object.assign(new Error('missing query param "q"'), { status: 400 });
    return search(q);
  }),
);

app.get(
  '/api/onemap/revgeocode',
  onemapRoute(async (req) => {
    const lat = requireNumber(req, 'lat');
    const lng = requireNumber(req, 'lng');
    const bufferM = requireNumber(req, 'bufferM');
    return reverseGeocode({ lat, lng }, bufferM);
  }),
);

app.get(
  '/api/onemap/route',
  onemapRoute(async (req) => {
    const fromLat = requireNumber(req, 'fromLat');
    const fromLng = requireNumber(req, 'fromLng');
    const toLat = requireNumber(req, 'toLat');
    const toLng = requireNumber(req, 'toLng');
    return walkRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
  }),
);

app.get(
  '/api/onemap/theme',
  onemapRoute(async (req) => {
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

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  if (process.env.DEMO_MODE === '1') {
    console.log('[api] DEMO_MODE=1 — fixtures only, no outbound calls');
  }
});
