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

app.get('/api/onemap/search', notImplemented('GET /api/onemap/search'));
app.get('/api/onemap/revgeocode', notImplemented('GET /api/onemap/revgeocode'));
app.get('/api/onemap/route', notImplemented('GET /api/onemap/route'));
app.get('/api/onemap/theme', notImplemented('GET /api/onemap/theme'));

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  if (process.env.DEMO_MODE === '1') {
    console.log('[api] DEMO_MODE=1 — fixtures only, no outbound calls');
  }
});
