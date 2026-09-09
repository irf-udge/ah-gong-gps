# CONTRACTS

The authoritative reference. If code and this document disagree, **the code in
`src/core/types.ts` wins** — but tell Irfan, because one of them is a bug.

Read this before writing anything. Most of it is facts verified against live
APIs, and several of them contradict what you'd reasonably assume.

---

## 1. File ownership — what not to touch

Irfan now covers both the original A role (pipeline spine + comfort routing)
and the original B role (voice I/O), and the third teammate — now Lija —
covers what was C. File headers and this table reflect that merge; nothing
below is legacy naming.

Every source file opens with a header:

```ts
// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
```

| Owner | Area | Owns |
| --- | --- | --- |
| **Irfan** | Pipeline spine + comfort routing + Voice I/O | `src/core/**`, `src/providers/**`, `src/audio/**`, `src/phrases/**`, `server/**`, `data/**`, `fixtures/**` |
| **Lija** | Journey experience | `src/ui/**`, `src/journey/**`, `src/main.tsx` |

**Shared, Irfan-owned, everyone reads:** `src/core/types.ts`, `src/core/geo.ts`,
`src/providers/types.ts`, `fixtures/demo-route.json`.

Rules:

- **Never** edit a file you don't own. Need a change? Ask the owner.
- **Never** define a parallel type because the shape you want isn't in
  `core/types.ts`. Ask Irfan to add it. Two competing `Landmark` types is how
  this project dies.
- **Never** import a concrete provider class outside `src/providers/index.ts`.
  Depend on the interface. That's the whole point of the swap points.
- Root configs (`package.json`, `tsconfig.json`, `vite.config.ts`) are Irfan's.

---

## 2. Verified API facts

I checked these against the live services. Several contradict the project brief.

### 2.1 MERaLiON — speech-to-text ✅ hosted

The brief said MERaLiON was a downloadable ~9B model needing GPU self-hosting.
**That's out of date.** There's a hosted, OpenAI-compatible API — which is why
the dialect claim is a *live* demo, not a pre-recorded clip.

| | |
| --- | --- |
| Base | `https://api.meralion.ai` |
| ASR | `POST /v1/audio/transcriptions` |
| Model | `MERaLiON/MERaLiON-3-3B-ASR-CTM` |
| Auth | `Authorization: Bearer <key>` (or `X-API-Key`, or `?api_key=`) |
| Body | `{ audio_url, model?, stream?, keep_diarization_for_long_audio? }` |
| Response | `choices[0].message.content` |
| Liveness | `GET /v1/models` — **public, no key** |
| Quota | `GET /v1/rate-limit/status` — needs the key |

Also available: `/v1/audio/translations`, `/summarization`, `/emotion_detection`,
`/gender_detection`, `/speech_instruction`, `/audio_captioning`, `/emotion_gender`.

> ### ⚠️ Trap 1 — their JavaScript sample is broken
> The API console's JS example posts to `https://api.meralion.ai/audio/transcription`.
> **That is a 404.** So is `/audio/transcriptions`. Only `/v1/audio/transcriptions`
> works (I verified all three). Their curl and Python samples are correct; the JS
> one is not — and JS is what we write.

> ### ⚠️ Trap 2 — 16 kHz mono, or nothing
> Audio must be **wav/mp3/ogg at 16 kHz, mono**. `MediaRecorder` produces
> 48 kHz stereo WebM/Opus. They are incompatible. See § 4.

**MERaLiON has no text-to-speech endpoint.** Speech *out* is the browser's
`speechSynthesis`. Don't go looking.

⚠️ **Silent/non-speech audio returns the literal string `"(nospeech)\n"`** —
verified live with a synthetic tone, not real speech. Not an empty string, not
an error. `server/index.ts`'s `/api/understand` treats it the same as "didn't
catch that" (skips straight to the `notUnderstood` clarify response) rather
than wasting a Gemini extraction call parsing it as if it were real words.

#### Measured quota — our actual key, free tier

| | Limit | Notes |
| --- | --- | --- |
| Rate | **200 requests/minute** | Corrected 2026-09-10 — see below |
| Requests | 1 000 / month | Not the binding limit |
| Tokens | 100 000 / month | **This is what binds** |
| Audio | 3 600 s / month | Not the binding limit |

> ⚠️ **The "5 requests/minute" figure this doc used to have was wrong.** Live
> `GET /v1/rate-limit/status` on our real key returned
> `{ limit: 200, remaining: 200, window: "1 minute" }`; one real
> `transcribe()` call afterward dropped `remaining` to 199, confirming the
> endpoint tracks actual consumption, not a static ceiling that happened to
> read wrong. **Actual limit: 200 req/min.** Don't take either number on
> faith going forward — call `rateLimitStatus()` (`server/meralion.ts`) and
> read what it says; whatever tier this key is on may change again.

**Cost is a flat ~334 tokens per request, independent of clip length** — a 1.5 s
and a 6.0 s clip both billed 330 prompt tokens. This part re-measured cleanly:
the same live call above billed 330 prompt + 7 completion = 337 total tokens.
So the token budget is *per request*, not per second:

> ## 🔴 ~299 transcription requests for the whole month, shared across the team.
> The monthly *token* cap is what actually binds — the rate limit above is
> comfortably high and was never the real constraint.

Latency is good — **0.6–1.0 s** round trip — so this is a budget problem, not a
speed problem. Consequences, all mandatory:

- **`FixtureStt` is the development default.** Never point at MERaLiON during
  routine UI work; a hot-reload loop that re-transcribes will drain the month in
  an afternoon.
- **Cache transcriptions by audio hash.** `server/index.ts` does this —
  `transcribeMemoized`, keyed on a SHA-256 of the base64 audio via
  `server/cache.ts`'s `memoizeAsync`. Testing the same phrase twenty times
  costs one request, verified live (a repeat call returned in 68ms, no second
  MERaLiON round trip).
- **Handle `429` explicitly**, not just timeouts. Fail over to `WebSpeechStt`.
  This is load-shedding, not a nicety.
- Budget spend deliberately: this session spent exactly one real
  `transcribe()` call verifying the implementation works, plus whatever
  `rateLimitStatus()`/`ping()` calls (both free, no quota cost).

Check remaining headroom any time — this now works, verified, not a guess:

```bash
curl -s -H "Authorization: Bearer $MERALION_API_KEY" https://api.meralion.ai/v1/rate-limit/status
```

#### `src/providers/stt.ts` — two real bugs, both fixed

Building `MeraLionStt`/`WebSpeechStt`/`createStt()` and testing the actual
fallback chain live (mocking `fetch` and `SpeechRecognition` to force every
failure combination, not just the happy path) caught two bugs a pure
typecheck couldn't:

1. **`WebSpeechStt.isSupported()`'s `'x' in globalThis` check is fragile.**
   `in` tests whether a KEY exists, not whether it holds a real, usable
   constructor — verified live that setting the global to `undefined`
   (rather than leaving it absent) still reports `true`. That let
   `createStt()`'s fallback logic attempt a `WebSpeechStt.transcribe()` call
   that could never succeed. Fixed by checking
   `typeof ctor === 'function'` instead (via the same constructor-resolving
   helper `transcribe()` already needed internally).
2. **A second failure could still escape unwrapped.** The auto-failover
   logic only wrapped the case where `isSupported()` said no *before*
   attempting Web Speech — if it said yes but the actual attempt then also
   failed (permission denied, no speech heard, or simply bug #1 above before
   it was fixed), that raw error — e.g. `"WebSpeechStt error: not-allowed"` —
   propagated straight to the caller instead of a friendly message. Fixed by
   wrapping the fallback attempt in its own `try`/`catch`: every exit path
   from `createStt()`'s provider is now either a real success or the same
   `"Could not hear you (…) — please say it again."` message, never a raw
   internal error a senior would see.

Verified live, not just reasoned about: MERaLiON success (no failover
attempted), a 429, and a simulated network error each correctly triggering
fallback; Web Speech succeeding after a MERaLiON failure (full recovery, not
just "it fails gracefully"); both failing together producing the friendly
message; and the real `MERALION_TIMEOUT_MS` (6000 ms) actually timing out at
~6104 ms measured — not hanging forever, and not firing early. Also ran a
real, undeliberate-mock request from `MeraLionStt` through the actual browser
→ Vite dev proxy → real server → real MERaLiON, confirming the whole new
client-side path works end to end, not just the server side (already
verified separately when the route handlers were built).

### 2.2 OneMap — geocoding & routing

All endpoints need `Authorization`. Token lives ~3 days; refresh on 401 with a
single in-flight promise.

| Purpose | Endpoint |
| --- | --- |
| Token | `POST /api/auth/post/getToken` — `{ email, password }` |
| Search | `GET /api/common/elastic/search?searchVal=&returnGeom=Y&getAddrDetails=Y` |
| Reverse geocode | `GET /api/public/revgeocode?location=lat,lng&buffer=0-500&addressType=All` |
| Route | `GET /api/public/routingsvc/route?start=&end=&routeType=walk` |
| Theme | `GET /api/public/themesvc/retrieveTheme?queryName=&extents=lat1,lng1,lat2,lng2` |
| All themes | `GET /api/public/themesvc/getAllThemesInfo?moreInfo=Y` |

> ### ❌ There is NO barrier-free or covered-wayfinding routing API
> `routeType` accepts exactly `walk`, `drive`, `pt`, `cycle`. The docs' own error
> list is explicit:
>
> > `400 - Route type must be one of: drive, pt, walk, cycle.`
>
> Barrier-free navigation is an **in-app OneMap feature**, not an API capability.
>
> **This is why `src/core/comfort.ts` exists**, and it's the pitch: *OneMap holds
> Singapore's accessibility data but exposes no accessibility routing API — we
> built the routing layer that doesn't exist.* Don't hunt for the flag.

#### Verified response shapes

**Token.** Ours expires **2026-09-10 23:27 SGT** (72 h lifetime, `exp` in the JWT).
Send it as `Authorization: <token>` — no `Bearer` prefix.

**`/routingsvc/route?routeType=walk`** returns:

```jsonc
{
  "route_geometry": "<encoded polyline>",        // decode: core/geo.decodePolyline
  "route_summary": { "total_time": 537, "total_distance": 745 },
  "route_instructions": [ /* array of ARRAYS, 10 fields each */ ]
}
```

`route_instructions[i]` is a positional array, **not an object**:

| # | Meaning | Example |
|---|---|---|
| 0 | direction | `"Head"`, `"Right"`, `"Left"`, `"Slight Right"` |
| 1 | **road name — often `""`** | `""` |
| 2 | distance (m, int) | `39` |
| 3 | `"lat,lng"` | `"1.366506,103.845505"` |
| 4 | time (s) | `28` |
| 5 | distance string | `"39m"` |
| 6 / 7 | heading / previous heading | `"North West"` |
| 8 | mode | `"walking"` |
| 9 | human instruction | `"Head Northwest"` |

> **Field 1 is empty on most walk legs — there is literally no street name to
> give.** That is the strongest possible confirmation of the landmark approach.

> ⚠️ **Collapse the manoeuvres.** A real 745 m route came back as **7**
> instructions, including `"Slight Right"` and `"Keep Right At The Fork"`. Seven
> spoken steps for a 12-minute walk is far too many for a 70-year-old. Merge
> micro-turns into a handful of landmark-anchored decisions before the rewrite.

**`/themesvc/retrieveTheme?queryName=&extents=lat1,lng1,lat2,lng2`** returns
`{ SrchResults: [...] }` where **element 0 is metadata**
(`FeatCount`, `Theme_Name`, `Owner`), and features follow from index 1. Don't
map over it blindly. Features carry `NAME`, `ADDRESSBUILDINGNAME`,
`ADDRESSBLOCKHOUSENUMBER`, `LatLng`.

Other things that will bite you:

- **Reverse geocode returns BUILDINGS, not POIs.** Max 10 within the buffer
  (≤500 m for buildings, 20 m for roads). `BUILDINGNAME` is the literal string
  `"NIL"` for unnamed buildings — i.e. most HDB blocks — so fall back to
  `Block {BLOCK} {ROAD}`. (Corrected 2026-09-09: this used to say "null/absent"
  — live-verified against Blk 226 Ang Mo Kio Ave 1, a real unnamed block, the
  field comes back as the *string* `"NIL"`, not missing. `search`'s `BUILDING`
  field does the same. Check for the literal string — `null`/`undefined`
  checks alone will miss it.) Expect *"Block 226"* far more often than *"the
  coffee shop"*. Write the demo script around what the data actually returns.
- **`buffer` is NOT a hard cutoff either** — same failure mode as `extents` on
  theme queries, found independently while building `core/landmarks.ts`. A
  `buffer=50` request returned buildings up to **262 m** away; MRT stations
  were the worst offenders (233-262 m), ordinary HDB blocks a more modest but
  still-over 54-90 m. Reproduced at 3 different points along the real demo
  route, not a one-off. `server/onemap.ts`'s `reverseGeocode` now filters
  results to the actual haversine distance client-side — **never trust an
  OneMap radius/bbox parameter as a real cutoff**, this is now the second
  confirmed case.
- **Walk routes return `route_geometry` as an encoded polyline.** Decode with
  `core/geo.decodePolyline` (precision 5). `pt` returns a totally different
  OTP-shaped payload — we don't use it.
- **`route_instructions[i]`'s distance field is off-by-one from what our
  `Manoeuvre.distanceM` means.** OneMap's `[2]` on instruction `i` is the walk
  distance FROM this instruction's point TO the NEXT one. Our `Manoeuvre.distanceM`
  is documented as "distance from the previous manoeuvre" — the opposite
  direction. Verified against a real 745 m route: the first instruction
  ("Head") carried distance 39, not 0, and only summed to `total_distance`
  under the "distance to next" reading. `server/onemap.ts`'s `parseManoeuvres`
  shifts by one to correct this (`manoeuvre[i].distanceM = raw[i-1][2]`). Get
  this backwards in a new call site and every turn's lead-in distance is
  silently wrong — no type error will catch it.
- **Collapse micro-turns before anything speaks them.** The same 745 m route
  had 3 turns inside its first 77 m (16 m, 20 m, 41 m apart) — 7 raw
  instructions for a 12-minute walk. `server/onemap.ts`'s `collapseMicroTurns`
  (25 m threshold, never merges away the first or last manoeuvre) folds these
  into the following turn: 7 → 5. If you're consuming `route_instructions`
  from anywhere else, do the same — don't hand a senior 7 spoken turns.
- **`retrieveTheme`'s feature schema varies PER THEME**, verified across all 8
  `USEFUL_THEMES` live: only `NAME`, `Type`, `LatLng` are common to every one.
  `ADDRESSBUILDINGNAME`/`ADDRESSBLOCKHOUSENUMBER` (what an earlier pass of this
  doc claimed) only exist on some themes (e.g. `ssot_hawkercentres`) — others
  (`eldercare`) use `ADDRESSPOSTALCODE`/`ADDRESSSTREETNAME` instead, and
  `nationalparks` has neither. Don't destructure theme-specific fields without
  checking which theme you're in.
- **`LatLng`'s coordinate encoding depends on feature `Type`.** `Point` →
  `"lat,lng"` (plain pair, lat first — same as everywhere else in this app).
  `Line` → `"[[lng,lat],[lng,lat],...]"` (JSON-array string, **GeoJSON lng/lat
  order** — reversed from Point). Verified on `park_connector_loop`. We only
  need a pin per landmark, so `parseThemeLatLng` takes the line's first vertex.
- **`extents` (the bbox param) is NOT reliably honoured server-side.**
  `park_connector_loop` returned **784 features nationwide** for a bbox
  covering one estate — verified live, not a fluke (hits included park
  connectors tens of km away, e.g. "Southern Ridges Loop" near Mount Faber).
  `server/onemap.ts`'s `retrieveTheme` now filters every feature client-side
  against the requested bbox after the fact. **Never trust OneMap's own
  `extents` clipping again** — this cost `park_connector_loop` effectively all
  of its AMK-corridor results once filtered correctly, which is the honest
  answer, not a bug: most of what it returned was never actually in Ang Mo Kio.
- **Search now needs a token too** (docs banner). Unauthenticated calls currently
  still return results *with an error field attached* — a grace period, not a
  guarantee.
- **429 `Exceeded quota limit` is real.** One journey is ~10 reverse-geocode
  calls plus up to 8 routing calls. `server/onemap.ts` caches all four read
  calls (`search`, `reverseGeocode`, `walkRoute`, `retrieveTheme`) via
  `server/cache.ts`'s `LruCache`/`memoizeAsync`, keyed on coordinates rounded
  to 5 dp — live-verified by spying on `global.fetch`: identical calls produce
  exactly 1 real request, including when 3 fire concurrently (the in-flight
  *promise* is cached, not just the resolved value, so races share one
  request). A failed call evicts itself — a 429 is never remembered as "the
  answer," so the next call retries for real.

### 2.3 Comfort-layer data (shelter / bench / toilet) — NOT OneMap, NOT data.gov.sg

**Both dead ends, both fully re-verified. The real source is OpenStreetMap.**

**OneMap Themes — re-checked a second time, exhaustively.** Pulled a fresh
`getAllThemesInfo` and this time read **all 165 themes grouped by category**
by eye (not just a keyword grep) — every Community/Culture/Education/Emergency/
Environment/Family/Health/Recreation/Sports/uncategorised entry. Result
unchanged and now doubly confirmed:

| Layer | In OneMap Themes? |
|---|---|
| barrier-free / wheelchair / accessible | ❌ absent |
| lifts | ❌ absent (only *HDB Lift Upgrading Programme, under construction*) |
| toilets | ❌ absent |
| benches / seats / rest points | ❌ absent |
| sheltered / covered / linkway / walkway | ❌ absent (`shelter` only matches **bomb** shelters) |
| bus stops | ❌ absent |
| eldercare | ✅ `eldercare` |

> The brief claims Themes has *"barrier-free facilities, lifts, eldercare services."*
> **Only eldercare is real.** Full 165-theme dump: `data/full_theme_dump.txt`
> (kept as evidence); curated usable subset: `fixtures/onemap-themes.json`.

**data.gov.sg — confirmed dead via the actual search UI**, not just the
dataset-list API (which ignores `query` entirely and was the wrong endpoint to
judge this by). Drove the real search box:

| Search term | Results | Verdict |
|---|---|---|
| `covered linkway` | 43 | All false positives on the word *"covered"* — "Collective Agreements Certified by Type of Workers **Covered**", vaccine coverage stats. Zero infrastructure datasets. |
| `linkway` | 0 | *"No results found."* |
| `bench` | 10 | All **"bench**mark**"** — IMDA Infocomm rankings, SGX turnover. Zero park-furniture datasets. |

**Confirmed: neither exists on either platform, under any term tried.**

#### The replacement: OpenStreetMap via the Overpass API

Free, no key, no registration, queryable by bounding box — verified live:

```
Nationwide (out count, whole-SG bbox):
  way[covered=yes][highway=*]  → 14,980 ways
  node[amenity=bench]          →  1,300 nodes
Demo corridor alone (Ang Mo Kio, DEMO_BBOX):
  198 covered ways · 38 building-passage linkways · 9 benches · 3 toilets
  (one toilet tagged wheelchair=yes)
```

That's not a fluke of one contributor mapping our specific corridor — the
nationwide count proves it's genuine island-wide coverage.

Endpoint: `POST https://overpass-api.de/api/interpreter`, body `data=<Overpass QL>`.
Ways need `out geom tags` to get full polylines (not just a center point);
`out center tags` is enough for nodes. See `data/etl.ts` for the exact queries.

> ⚠️ **`covered=yes` is not automatically pedestrian.** A verified sample hit
> was *"Ang Mo Kio Bus Interchange"* — `highway=service`, `bus=yes`, `access=no`:
> a covered **bus driveway**, not a walkway. Filter `highway` to
> `footway|path|pedestrian|corridor|steps`; treat `tunnel=building_passage`
> as its own always-pedestrian query. Both are already split out in `data/etl.ts`.
>
> ⚠️ **ODbL attribution is required.** Unlike OneMap's Singapore Open Data
> Licence, OSM data is ODbL — the app needs a visible *"© OpenStreetMap
> contributors"* credit (About screen, footer, or the pitch deck's sources
> slide). New obligation neither of the other two sources carried.
>
> ⚠️ **Build-time only.** `overpass-api.de` is a shared community server.
> The ETL queries it **once**, bakes a static `data/amenities.json`, and commits
> that. Nothing in the request path calls Overpass at runtime — same pattern as
> the data.gov.sg plan it replaces.
>
> ⚠️ **Overpass's Apache front-end 406s any request with no `User-Agent`
> header** — verified live, and this is exactly what Node's `fetch`/`https`
> send by default (curl always sends one, which is why every manual/docs
> example that anyone would copy "just works"). Confirmed by elimination: a
> raw `https.request`, identical otherwise, still 406'd with no UA; adding
> any real UA string fixed it immediately — not content negotiation on
> Accept/encoding, strictly presence of the header. `data/etl.ts` sends a
> descriptive one (`ah-gong-gps-etl/1.0 (...)`, plain ASCII only — an em-dash
> in the header value throws `Cannot convert argument to a ByteString`,
> also found live on the very next request after adding the header).
>
> ⚠️ **Overpass's own bbox filter isn't perfectly tight either** — verified
> live: 6 of 182 elements for `DEMO_BBOX` had their first geometry point
> outside the requested box (expected for ways that merely cross the
> boundary, given "first vertex" is our representative point — not
> necessarily a bug in Overpass the way OneMap's `extents`/`buffer` are, but
> the same defensive lesson applies). `data/etl.ts`'s `buildAmenityIndex`
> clips every Poi to `DEMO_BBOX` client-side before writing the baked file —
> same "never trust a server's own spatial filter" rule as § 2.2 now, twice
> confirmed on OneMap and once on Overpass.

**Toilets, too** — `node[amenity=toilets]` came back in the same demo-corridor
pull, so OSM covers all three missing comfort layers through one source instead
of stitching together OneMap + data.gov.sg + LTA DataMall.

What OneMap Themes *is* still good for is **landmarks**. The 11 usable layers
are saved in `fixtures/onemap-themes.json`. Best for our user: `ssot_hawkercentres`,
`communityclubs`, `eldercare`, `moh_hospitals`, `registered_pharmacy`,
`nationalparks`, `park_connector_loop`.

Verified real AMK landmarks from `ssot_hawkercentres`: *Teck Ghee Square (Blk 409)*,
*Chong Boon Market and Food Centre (Blk 453A)*, *Cheng San Market (Blk 527)*.

> **Green Man+ is still excluded** — the dataset is outdated. Not in the
> scoring, not in the pitch. (Unrelated to this OSM finding; carried over.)

---

## 3. Provider interfaces

The five swap points, from `src/providers/types.ts`. Every one has a real
implementation and a `Fixture*` one; `DEMO_MODE=1` swaps the whole set.

```ts
interface SttProvider     { name: string; transcribe(wav: Blob, lang: Lang, at: LatLng): Promise<Transcription> }
interface TtsProvider     { name: string; speak(text, lang): Promise<void>; cancel(): void
                            primeForUserGesture(): void; availableLangs(): Lang[] }
interface RoutingProvider { name: string; walkRoute(from: LatLng, to: LatLng): Promise<RouteCandidate> }
interface PlaceProvider   { name: string; search(q): Promise<Place[]>
                            reverseGeocode(at: LatLng, bufferM: number): Promise<Building[]>
                            theme(queryName: string, bbox: BBox): Promise<Poi[]> }
interface LocationProvider{ name: string; start(cb: (p: Position) => void, onError?: (err: Error) => void): void; stop(): void }
```

> ⚠️ `LocationProvider.start()`'s `onError` param isn't in the original
> design — added implementing `GeolocationProvider`, which needs a way to
> surface a real `GeolocationPositionError` (permission denied, position
> unavailable, timeout) to the caller instead of either swallowing it or
> throwing async where nothing could catch it. Optional and unused by
> `SimulatedProvider`/`ManualProvider`, which can't fail this way.

> ⚠️ `SttProvider.transcribe()`'s `at: LatLng` param isn't in the original
> design — added wiring up `MeraLionStt`, which calls `POST /api/understand`
> and that endpoint requires `at` (nearby-buildings context for Gemini's
> destination extraction). `WebSpeechStt`/`FixtureStt` just ignore it.
> `MeraLionStt.transcribe()` itself deliberately returns only
> `{text, confidence}`, discarding `/api/understand`'s `destination`/
> `clarify` fields — `SttProvider` is scoped to "just transcribe"; the real
> (non-demo) orchestration layer should call `/api/understand` directly for
> the combined result, not double-call through this provider.

| Interface | Real | Fallback | Fixture |
| --- | --- | --- | --- |
| `SttProvider` | `MeraLionStt` — **DONE, LIVE-VERIFIED**, real round trip through the browser, Vite's proxy, the real server, to real MERaLiON | `WebSpeechStt` (6 s timeout) — **DONE, LIVE-VERIFIED**, two real bugs found and fixed, see § 2.1 below | `FixtureStt` |
| `TtsProvider` | `BrowserTts` | — | `FixtureTts` (headless tests only — see below) |
| `RoutingProvider` | `OneMapRouting` | — | `FixtureRouting` |
| `PlaceProvider` | `OneMapPlaces` | — | `FixturePlaces` |
| `LocationProvider` | `SimulatedProvider` | `GeolocationProvider`, `ManualProvider` | — |

Note `SimulatedProvider` is the **primary** demo path, not a fallback — judges
are indoors.

> ⚠️ **`DEMO_MODE=1` does NOT swap TTS to `FixtureTts`.** `createProviders()`
> uses `BrowserTts` in both the real and demo paths — MERaLiON has no TTS
> endpoint and `speechSynthesis` needs no network, so there's nothing to
> fixture, and going *silent* is the one thing an on-stage kill switch must
> never do. `FixtureTts` (a no-op) exists for headless/CI tests, not for demos.

### `Providers` — four of the five, not all five

```ts
interface Providers { stt: SttProvider; tts: TtsProvider; routing: RoutingProvider; places: PlaceProvider }
```

**`location` is deliberately not a member.** `SimulatedProvider`'s constructor
needs the route polyline up front, and no route exists yet when the rest of
the bundle is built (once, at app start). Get one separately, once a journey
exists:

```ts
function createLocationProvider(mode: 'simulated'|'gps'|'manual', path?: readonly LatLng[], speedMps?: number): LocationProvider
```

`'simulated'` throws immediately if `path` is missing/empty — a caller bug,
not a case to paper over. `speedMps` is `'simulated'`-only (ignored for
`'gps'`/`'manual'`) and defaults to `SIM_SPEED_MPS` — 1 m/s, realistic
walking pace, meant for developing/testing the geofence logic, NOT for an
on-stage demo. Pass an accelerated value explicitly for actual playback; see
§ below for why this parameter had to be added after the fact.
`createProviders()` and `createLocationProvider()` are both implemented
(`src/providers/index.ts`) and runtime-verified, not just typechecked.

### Fixture-mode journey assembly

For a **complete** demo journey — not just individual provider calls —
`src/providers/fixtures.ts` exports:

```ts
buildDemoJourney(lang: Lang): Journey       // origin, destination, scored route, landmarks, steps — all from the fixture
buildDemoRejected(lang: Lang): ScoredRoute[] // the losing candidate(s), for the judge view
```

These deliberately bypass `core/comfort.ts` and `server/llm.ts` entirely — no
candidate generation, no LLM rewrite, zero network calls. **Call this instead
of `POST /api/journey` when `demoMode` is true** — that's the CP1 target
(DEVPLAN §CP1). Verified at runtime: every step's `landmarkId` resolves
inside that same journey's `landmarks`, and the losing candidate genuinely
scores lower than the winner (not just present for show).

---

## 4. Audio contract

Non-negotiable, because MERaLiON rejects everything else:

| | |
| --- | --- |
| Sample rate | **16 000 Hz** |
| Channels | **1 (mono)** |
| Format | WAV (16-bit PCM), or mp3/ogg |
| Transport | base64, **no** data-URI prefix — the server adds `data:audio/wav;base64,` |

**Do not use `MediaRecorder`.** Pull raw PCM through Web Audio instead:

1. `getUserMedia({ audio: { channelCount: 1, echoCancellation: true } })`
2. `new AudioContext({ sampleRate: 16000 })` — then **verify `ctx.sampleRate`**;
   Safari often ignores the request, so resample manually when it does.
3. `AudioWorklet` (not `ScriptProcessor` — deprecated and glitchy) to accumulate
   Float32 frames.
4. Float32 → Int16 PCM, prepend a 44-byte RIFF/WAVE header.

Size check: 5 s ≈ 160 KB PCM ≈ 213 KB base64. Note `server/index.ts` raises the
Express JSON limit to 10 MB — the 100 KB default would 413 every request.

**`src/audio/capture.ts` is implemented and verified — two real bugs found
live, neither of which a pure unit test would have caught:**

> ### ⚠️ Bug 1 — a worklet with no path to `destination` gets silently starved
> Connecting `sourceNode → workletNode` and stopping there (so the mic never
> plays back out loud) seemed reasonable. It's wrong: without SOME path to
> `audioContext.destination`, the render graph doesn't reliably pull that
> branch at all on this browser — `process()` either doesn't fire or fires
> with silence. **Reproduced directly**: fed a real 440Hz test tone through
> the unconnected graph and got an all-zero WAV back, every time.
>
> Fix: route through a `gain=0` node before `destination`. Keeps the graph
> "live" without the user ever hearing themselves:
> ```ts
> const silentGain = audioContext.createGain();
> silentGain.gain.value = 0;
> workletNode.connect(silentGain);
> silentGain.connect(audioContext.destination);
> ```

> ### ⚠️ Bug 2 — a cold-start race that can eat the first word
> The FIRST `AudioContext` + `AudioWorklet` + `getUserMedia` chain on a fresh
> page load has real startup latency (audio device negotiation, worklet
> module compilation). A recording that starts capturing immediately after
> `start()` resolves can capture nothing but that startup silence for its
> first stretch. **Reproduced twice**, independently: identical code, same
> synthetic test tone, all-zero WAV on a cold page load, correct WAV once
> the pipeline had already been exercised once on the same page.
>
> This matters for real usage, not just the test harness: a senior tapping
> the button and saying something short ("TTSH") immediately could lose the
> first word to this if unaddressed.
>
> Fix: `start()` doesn't resolve once the graph is wired up — it resolves
> once the FIRST real buffer has actually arrived from the worklet (bounded
> to 500ms, so a genuinely broken mic can't hang the caller forever;
> recording proceeds regardless, this only delays telling the caller "go
> ahead and speak now"). Re-verified fixed across 3 consecutive fresh-page
> loads afterward — measured `start()` resolve latency ~140-180ms each time,
> comfortably inside the 500ms bound.

Both found by testing the **real** module in a real browser (Vite dev-serves
`.ts` directly — `import('/src/audio/capture.ts')` from the console runs the
actual shipped code), not by reasoning about the code or trusting `tsc`.
`encodeWav`/`resample`/`blobToBase64` are pure and unit-tested in Node
separately (18 assertions — WAV header round-trips to exactly 16000 Hz /
1 channel / 16-bit, Int16 clamps without wraparound, base64 round-trips
across the chunk boundary).

⚠️ **Still missing: an automated test in CI**, not just the one-off manual
verification runs above that found these two bugs.

---

## 5. Core types

Full definitions in `src/core/types.ts`. The ones that matter most:

- **`Landmark`** — the *only* things the LLM may refer to. Every one came from a
  real API response or a baked dataset. `name` is emitted verbatim.
- **`RouteCandidate`** — decoded polyline + manoeuvres. Several per journey; we
  score and rank them.
- **`ComfortScore`** — shelter coverage, rest points, toilets, longest
  unsheltered run, extra distance, stairs.
- **`PoiKind`** — extended 2026-09-09 with `hospital`/`pharmacy`/`polyclinic`.
  3 of the 8 curated `USEFUL_THEMES` (`moh_hospitals`, `registered_pharmacy`,
  `vaccination_polyclinics`) had no matching kind before this — `retrieveTheme`
  needs one for every theme it's asked to map, and throws rather than
  mis-tagging an unmapped one. Same pattern as `Poi.path` below: extend the
  shared type when a real, live-verified need shows up, don't work around it.
- **`Step`** — what the senior hears. `landmarkId` **must** exist in the
  journey's `landmarks`.
- **`JourneyState`** — phase, journey, current step index. `clarifyCandidates:
  Place[]` added 2026-09-09 wiring up `ClarifyScreen` for real — `clarifyQuestion`
  alone had nowhere to hold `UnderstandResponse.clarify.candidates` for the
  screen's tappable options. Empty when the question has no candidates (e.g.
  "didn't catch that"). `journey/machine.ts`'s `reduce()` also gained a
  `RESOLVED` handler under `clarifying` (previously only `resolving` had one)
  — the state diagram had never drawn a path for "the user tapped a
  candidate," even though that's the entire reason `clarify.candidates`
  exists; without it, `ClarifyScreen.onPick` calling `/api/journey` and
  dispatching `RESOLVED` was a silent no-op.
- **`PlanJourneyRequest`/`ReanchorRequest`** — changed 2026-09-10, wiring up
  `server/index.ts`'s route handlers. Both used to carry a bare id
  (`destinationId`/`journeyId: string`) for the server to "look up" — but
  there is no server-side journey/place store, and OneMap has no "get by id"
  endpoint, so a bare id had nothing to resolve against. Both now carry the
  full object instead (`destination: Place` on each) — the client already
  has it (from `UnderstandResponse.destination` or a `ClarifyScreen.onPick`),
  so it's passed through rather than the server trying to resurrect one.

---

## 6. LLM output & validation

### The schema is the guard

`server/llm.ts:buildStepSchema()` builds `landmark_id` as an **enum of this
route's real landmark ids**. The schema literally cannot express an invented
landmark. That's the cheap answer to "how do we validate LLM output against the
supplied landmark list".

```ts
{ steps: [{ index, landmark_id /* enum */, action, spoken_text, display_text }] }
```

### The model: Gemini, live-verified — not what the docs said

**`gemini-3.5-flash-lite` for both calls.** Not a cheap/quality split — tested
live and both calls use it. Verified against a real key on 2026-09-09,
because the docs and the live API disagreed:

- `ai.google.dev`'s pricing page listed the entire `gemini-2.5-*` line as
  free-tier-eligible. **Wrong for a real key** — every 2.5 model (flash-lite,
  flash, pro) 404s: *"no longer available to new users."* Docs lag live
  rollouts; don't trust them over an actual probe against your own key.
- Working models found by directly probing the API: `gemini-3.5-flash-lite`,
  `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`.
  `gemini-3.8-flash` exists but returned `503 high demand` — not reliable
  enough to depend on for a demo.
- **Latency decided it, not capability.** Same structured-output prompt
  shape, measured: `gemini-3.5-flash` ~6-7s (even with thinking disabled)
  vs `gemini-3.5-flash-lite` ~1.2-1.7s, consistent across repeated calls.
  6-7s is a real risk with judges watching; 1.2-1.7s isn't. The rewrite
  task is deliberately short, simple, landmark-anchored sentences — a
  product requirement (§8), not a concession — so lite's quality ceiling
  was never actually the constraint.
- **`thinkingConfig: { thinkingBudget: 0 }` returns a flat `400 INVALID_ARGUMENT`
  on `gemini-3.5-flash-lite`** — isolated directly, independent of the
  schema. `-1` (automatic) and omitting the field both work. The SDK's own
  `.d.ts` warns allowed ranges are model-dependent; this is that, in
  practice. `server/llm.ts` omits `thinkingConfig` entirely — nothing was
  gained by fighting for a lower budget than the ~1.2-1.7s already measured.
- Structured output uses `responseJsonSchema` (plain JSON Schema — not the
  older `responseSchema` + proprietary `Type.STRING` enum shape). Confirmed
  both in the SDK's `.d.ts` and live: `buildStepSchema()`'s existing
  plain-JSON-Schema output was passed straight through with zero conversion,
  and the `landmark_id` enum constraint held on every step across a live
  end-to-end run in **both** Mandarin and Malay — no invented landmark ever
  came back.

### Prompt constraints (non-negotiable)

- Use **only** landmarks supplied in this request. Never invent one.
- Emit proper nouns **verbatim**. Never translate "NTUC" or "AMK Hub" —
  free translation is the subtler hallucination and it's easy to miss.
  Keeping English names inside a Mandarin sentence is how Singaporeans
  actually speak. It's correct.
- No street names. No distances in metres — seniors navigate by landmarks, and
  distance prompts cause anxiety rather than clarity.
- One short sentence per step.

### Validation, defence in depth

`core/validate.ts:validateSteps()` — **DONE, LIVE-VERIFIED** against real
fixture data in both languages, not just typechecked. Checks, all collected
in one pass (no early return — the retry prompt works much better when it
sees everything):

1. Every `landmark_id` is in the supplied set (`unknown_landmark`).
2. Proper-noun scan — any Latin-script token not in the lexicon
   (`buildLexicon`, drawn from every landmark's `name`/`nameZh`/`nameMs`) or
   `GENERIC_ALLOWLIST` is an invented name (`invented_proper_noun`).
3. Step count matches manoeuvre count (`step_count_mismatch`).
4. `spokenText` isn't empty/whitespace-only (`empty_spoken_text`) — silence
   reads as broken (§8), so an empty string is a real failure mode, not a
   theoretical one.

> ⚠️ **`validateSteps()` takes a `lang: Lang` parameter — not in the original
> stub signature.** The proper-noun scan is language-dependent and this is
> the only way it can know which language it's scanning: **Malay is itself
> written in Latin script.** "Any Latin-script token not in the lexicon" is
> correct for `zh` (ordinary Mandarin has none at all — a Latin token is
> either a real proper noun kept verbatim or invented) but would be
> **catastrophically wrong** for `ms` — verified against the real fixture,
> a real Malay step like *"Berjalan ke Pasar Blok 226H."* is almost entirely
> ordinary Latin-script words, none of which are proper nouns. Naively
> applying the `zh` rule would flag nearly every word of every Malay
> sentence as hallucinated. Fixed: for `ms`, only a token that's
> **capitalized AND not simply the sentence-initial word** (ordinary
> grammatical capitalization, not a name) counts as suspect — verified
> zero false positives on the real `ms` fixture, and that an invented
> capitalized name mid-sentence (`"Berjalan ke Sunshine Plaza."`) is still
> caught.
>
> ⚠️ **This found a second real bug, in `templateSteps()` itself** — the
> "safe by construction" fallback isn't safe by assertion, it's safe because
> it was checked: feeding `templateSteps()`'s own output back through
> `validateSteps()` caught a genuine bug on the first run. The `arrive`
> template reuses the phrase book's `arrived` string ("Anda sudah sampai")
> as the second half of a joined sentence — but that string is written
> capitalized because it's ALSO spoken standalone elsewhere
> (`ui/App.tsx`'s arrival effect). Reused mid-sentence, "Anda" reads as (and
> was flagged as) an invented proper noun. Fixed by lowercasing it for the
> mid-sentence case only — the grammatically correct behaviour, not a
> validator workaround. `thenStraight`/`thenTurnLeft`/`thenTurnRight` didn't
> need this; they're already written lowercase since they were never meant
> to stand alone.

On failure: retry once with the violations fed back. On the second failure, use
`validate.templateSteps()` — safe by construction, and now actually verified
to be (see above), not just asserted to be.

> This whole retry chain is now real, not just designed: `server/llm.ts`'s
> `rewriteToSteps()` takes an optional 4th `feedback?: readonly Violation[]`
> parameter (not in the original stub signature — there was nowhere to put
> the violations before), which appends them to the prompt as concrete
> corrections on retry. `server/index.ts`'s `planJourneyCore` wires the whole
> chain: `rewriteToSteps` → `validateSteps` → (on failure) `rewriteToSteps`
> with feedback → `validateSteps` → (on a second failure) `templateSteps`.
> Live-verified end to end via `POST /api/journey` — the real Gemini call
> passed validation on the first attempt, so the retry path itself is
> implemented and exercised by `core/validate.ts`'s own deliberate-failure
> tests, not yet by a real Gemini failure. See § below for the full run.

> ## 🚨 THE ONE RULE
> **Nothing is ever spoken that has not passed `validateSteps()`.**
>
> A hallucinated landmark leaves a senior standing at a junction looking for a
> building that doesn't exist. That is worse than no app at all.

### Route handlers — live-verified, not fixtures

`server/index.ts`'s three pipeline endpoints are real, not 501 stubs, and
have all been run against the actual live services (MERaLiON, OneMap,
Gemini) — not `DEMO_MODE`, not mocks.

**`POST /api/journey`** (real origin → AMK Hub, `zh`): one HTTP call exercised
the entire pipeline — `generateCandidates` (4 real OneMap-routed candidates)
→ `scoreRoute`/`rankRoutes` (the winner genuinely beat all 3 rejected
candidates on comfort score, not by construction) → `collectLandmarks` (11
real landmarks across 5 manoeuvres) → `rewriteToSteps` (natural, varied
Chinese sentences — confirmed NOT template-style by checking they don't all
start with the same fixed phrase) → checked again through `validateSteps`
independently: `ok: true`, zero violations. 3.5 s round trip.

**`POST /api/reanchor`** (a mid-route position, `ms`): real nearest-landmark
lookup plus a full re-route, 200 OK, ~4 s once measured cleanly (see the
Windows dev-workflow note in DEVPLAN.md — an early measurement said 118 s,
which was a false alarm from a stale duplicate server process, not the
route-handler code). Caught one real bug in the process: `recalculating`
("Saya cari jalan semula") is written capitalized in the phrase book for the
same "also spoken standalone" reason `arrived` was — and had the exact same
mid-sentence-capitalization bug when composed into the reassurance sentence.
Unlike `templateSteps`' output, this text never passes through
`validateSteps()` (it's a standalone phrase, not a `Step[]`), so nothing
would have caught it automatically — found only by reading the actual live
response text. Fixed by exporting `core/validate.ts`'s `lowercaseFirst` for
reuse in `server/index.ts`.

**`POST /api/understand`**: the `"(nospeech)"` short-circuit was verified via
a real MERaLiON call through the actual endpoint (correct `clarify` response,
`notUnderstood` phrase); the audio-hash cache was confirmed working (repeat
call, identical audio, 68 ms — no second MERaLiON round trip). The
destination-extraction path (`extractDestination` → `search` → dedupe) was
verified with real Gemini + OneMap calls made directly rather than through a
second `transcribe()` spend (real speech audio isn't producible
server-side) — this also reproduced, on demand, the exact "AMK Hub returns 3
postal variants" ambiguity noted in § 2.2, and confirmed
`server/index.ts`'s `dedupeByName` collapses them to the single real
destination it actually is.

---

## 7. Fixture shape

`fixtures/demo-route.json` — Blk 226 Ang Mo Kio Ave 1 → AMK Hub. Hand-written so
B and C can build a complete app before any key exists. Replace the values with
real OneMap responses once the token lands, but **keep the shape**.

```jsonc
{
  "meta":        { "isRealApiData": false, ... },
  "transcript":  { "zh": "...", "ms": "..." },   // what the user said
  "origin":      LatLng,
  "destination": Place,
  "route":       RouteCandidate,                  // the winning candidate
  "score":       ComfortScore,
  "rationale":   { "zh": "...", "ms": "..." },
  "rejected":    [{ candidate, score, rationale }], // losers, for the judge view
  "landmarks":   Landmark[],                      // the allowed set
  "steps":       { "zh": Step[], "ms": Step[] },
  "amenities":   Poi[]                            // shelter/bench/toilet/lift
}
```

The fixture deliberately includes a **losing** route (shorter, but an overhead
bridge and 21% shelter) so the judge view has something real to contrast against
the winner (82% shelter, 2 benches, no stairs).

---

## 8. UI rules that are product requirements

Not style preferences — these are the reason the product exists.

- **One primary action per screen.** The home screen is one big button.
- **Never render a list of upcoming steps.** One step at a time. A list is
  working-memory load, and working memory is exactly what declines with age.
  This is the easiest rule to break by accident.
- **No map on senior-facing screens.** The map is the barrier we're removing.
  Maps are allowed in the judge view only.
- Type: step text ≥ 44px, body ≥ 28px, nothing senior-facing below 24px.
- Contrast: high, both directions. Never grey-on-grey.
- Tap targets ≥ 64px.
- **Error tolerance everywhere.** Assume mis-transcription. Always offer
  "say it again".
- The clarification loop is a **feature to demo**, not an error path.

Tokens are in `src/ui/theme.css`.

---

## 9. Geometry (turf.js)

`core/geo.ts` is built on **`@turf/turf` (v7.4.0)**, not hand-rolled trig. Verified
against the actual installed package (ran real inputs, printed real outputs —
see the git history of this section for the check script) before writing any
of the code that depends on it, because a couple of these shapes are easy to
misremember and would fail silently (wrong units, wrong property name) rather
than throw.

> ⚠️ **Turf positions are `[lng, lat]`** — the opposite order from our
> `LatLng {lat, lng}` used everywhere else. Every conversion goes through
> `toPosition`/`fromPosition`/`toPoint`/`toLineString` in `geo.ts` — never
> build a turf `Position` by hand anywhere else. A silently-swapped coordinate
> is exactly the kind of bug that only shows up as "the shelter score is
> nonsense" three hours before a deadline.

### Function → use-case map

| Need | Turf function | Notes |
|---|---|---|
| Distance, bearing | `@turf/distance`, `@turf/bearing` | Pass `{ units: 'meters' }`. `bearing` returns **-180..180**; `geo.bearingDeg` normalises to our documented 0..360. |
| Total route length | `@turf/length` | — |
| Closest point on a route + progress | `@turf/nearest-point-on-line` | Result properties are `dist` (metres to the line) and `location` (metres **along** the line) — verified exact key names live, don't guess these. `location` is what step-advance/off-route geofencing should key off (monotonic), not raw proximity to a manoeuvre point. |
| Extract one leg of a route | `@turf/line-slice` | Both endpoints get snapped to the line first. |
| Point N metres along a route | `@turf/along` | Feeds both shelter-coverage sampling and `SimulatedProvider`'s walked position. |
| "Comfort envelope" around a route | `@turf/buffer` | `buffer()` can return `undefined` for degenerate input — `geo.routeBuffer` throws rather than silently propagating `undefined`. |
| Point amenities within that envelope | `@turf/points-within-polygon` | One bulk filter, not a loop of manual distance checks. Used for **both** candidate-waypoint selection (any kind) and bench/toilet counting (pre-filter by kind first). |
| Shelter coverage (a LINE amenity, not points) | `@turf/point-to-line-distance` | `points-within-polygon` doesn't apply here — shelter is linear. `geo.sampleShelterCoverage` instead samples the route every 10 m via `along` and tests each sample against the shelter ways via this function. |

### Why `Poi` grew a `path` field

Shelter data from OSM/Overpass (§2.3) is **lines** (covered walkways), not
points — the original `Poi { at: LatLng }` couldn't represent that. `Poi` now
carries an optional `path?: LatLng[]`, set only for `kind: 'shelter'`; `at`
stays populated (the way's first vertex) so anything that only needs a pin
location keeps working unchanged. `poisWithinRadius` reads `.at` for every
kind (a shelter way's first vertex is a fine stand-in as a waypoint
candidate); `sampleShelterCoverage` is the one place that needs the full
`.path`.

### Two real bugs the smoke test caught — both fixed, worth knowing about

Ran the new code against **real** Overpass amenity data (the AMK pull from
§2.3) and the real fixture route with a mock `RoutingProvider` (OneMap's own
`walkRoute` isn't implemented yet, so this exercises `comfort.ts`/`geo.ts`,
not OneMap) before trusting any of it:

1. **The bus-interchange gotcha showed up for real.** The raw `covered=yes`
   pull included `highway=service` ways (the AMK Bus Interchange driveway).
   `data/etl.ts`'s pedestrian-`highway` filter (§2.3) has to run before
   anything reaches `Poi[]`, not after — the smoke test builds `Poi[]` the
   same way the real ETL should and explicitly counts what it excluded.
2. **`describeScore`'s fallback made a false claim.** A via-waypoint
   candidate that was 9 m *longer* than the direct route, with 21% shelter
   coverage (just under the original 25% threshold), fell through every
   condition and hit an unconditional `shortestWalk` fallback — "这条路比较近"
   ("this route is shorter") on a route that wasn't. Not an LLM
   hallucination, but the same failure *shape*: a false claim reaching
   output. Fixed by (a) lowering the `partlySheltered` threshold to 10% so
   genuine partial coverage isn't left with nothing to say, and (b) only ever
   using `shortestWalk` when `extraDistanceM` is actually ~0. An empty
   rationale string is now the correct fallback when nothing true applies —
   callers should treat `""` as "nothing to show/speak," not an error.

Both are documented inline in `comfort.ts` at the exact line they were fixed.

### A third bug, found the same way, in `journey/machine.ts`'s `shouldAdvance`

`nearestOnPolyline`'s own doc comment names `journey/machine.ts`'s geofencing
as its intended consumer, for exactly this reason. The first implementation
didn't take the hint — it checked raw straight-line distance to the previous
manoeuvre for hysteresis instead. That passed every unit test written against
it in isolation, and only broke under an end-to-end test that drove real
`shouldAdvance()` calls off the actual `SimulatedProvider`.

**The bug:** when two consecutive manoeuvres sit closer together than
`GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M` (35 m default), "within RADIUS of
the target manoeuvre AND beyond RADIUS+HYSTERESIS of the previous one" is
**geometrically impossible** to satisfy at the same time — by the triangle
inequality, no point can be that close to one and that far from the other if
the two are themselves closer together than the sum. Navigation stalled at
that step **permanently**, not just for one noisy sample. Not a rare edge
case: a synthetic 6 m gap triggered it on the first real-time run, and the
real demo route's tightest actual gap (40.8 m straight-line, between two
manoeuvres `server/onemap.ts`'s `collapseMicroTurns` didn't merge because
they're above its own 25 m threshold — see § 2.2) sits close enough to the
35 m danger zone that a different real route easily could fall under it.
`collapseMicroTurns`' merge threshold and `shouldAdvance`'s hysteresis margin
are two different numbers for two different reasons; nothing currently
guarantees the former keeps every gap above the latter.

**The fix:** switched to `nearestOnPolyline`'s `distanceAlongM` — progress
along the route, not point-to-point distance — for both the radius check and
the hysteresis margin. Scalar progress values don't have the
impossible-constraint failure mode: any threshold along a line is always
reachable by continuing to walk forward, regardless of how physically close
two manoeuvres are. Re-verified: a 1 m-resolution fine-grained walk over the
real 5-manoeuvre route (0 skips, strictly increasing, each manoeuvre fires
exactly once) and the exact 6 m-gap case that used to stall forever both now
resolve correctly.

**Separately, also worth knowing:** `SimulatedProvider`'s 500 ms tick rate
times an extreme speed multiplier can skip a fence's radius entirely between
two samples — confirmed at 400 m/s (~800x realistic walking pace), which was
originally chosen purely to make a test run fast and inadvertently exposed
this too. Not fixed, because no real demo scenario needs anywhere near that
speed: a realistic "sped up for the stage" multiplier (verified safe at
5x = 5 m/s) has no such risk, and the safe ceiling is roughly
`2×GEOFENCE_RADIUS_M / (TICK_MS/1000)` ≈ 100 m/s. Don't crank the judge-view
speed slider past that without re-checking.

### Two more real gaps, found wiring up `ui/App.tsx`

Same pattern again: build the actual consumer, run it for real, find what's
missing.

1. **Nothing returned to `idle`.** `journey/machine.ts`'s `JourneyEvent` union
   had `SAY_AGAIN` (→ `listening`) as the only universal escape hatch —
   there was no event that ever produced `idle` once the flow left it.
   `ArrivedScreen`'s "go home" button had nothing to dispatch. Added `RESET`
   (universal, same tier as `SAY_AGAIN`/`ERROR`): wipes back to
   `initialState` from any phase.
2. **`createLocationProvider` had no way to run faster than
   `SIM_SPEED_MPS`.** Its signature only took `(mode, path)` — no speed
   parameter existed at all. At the realistic 1 m/s default, timing an
   actual live run showed a ~700m route takes on the order of 12 minutes to
   walk, which is obviously unusable for an on-stage demo despite
   `SimulatedProvider`'s own doc explicitly framing `setSpeed()`/`jumpTo()`
   as "the actual on-stage mechanism, not an afterthought" — the
   *construction-time* path to a fast demo simply didn't exist yet. Added an
   optional `speedMps` param to `createLocationProvider` (ignored for
   `'gps'`/`'manual'`, passed straight through to `SimulatedProvider`
   otherwise). `ui/App.tsx` now drives the demo walk at 20x — verified live,
   walks the real route in well under a minute with zero console errors,
   reaching `arrived` in three separate clean-tab runs (Mandarin, Malay, and
   a plain reliability re-check).
