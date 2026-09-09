# CONTRACTS

The authoritative reference. If code and this document disagree, **the code in
`src/core/types.ts` wins** — but tell A, because one of them is a bug.

Read this before writing anything. Most of it is facts I verified against live
APIs, and several of them contradict what you'd reasonably assume.

---

## 1. File ownership — what not to touch

Every source file opens with a header:

```ts
// OWNER: B (Voice I/O) — do not edit unless you are the owner.
```

| Owner | Area | Owns |
| --- | --- | --- |
| **A** | Pipeline spine + comfort routing | `src/core/**`, `src/providers/{index,types,onemap,fixtures}.ts`, `server/**`, `data/**`, `fixtures/**` |
| **B** | Voice I/O | `src/audio/**`, `src/providers/{stt,tts}.ts`, `src/phrases/**` |
| **C** | Journey experience | `src/ui/**`, `src/journey/**`, `src/main.tsx` |

**Shared, A-owned, everyone reads:** `src/core/types.ts`, `src/core/geo.ts`,
`src/providers/types.ts`, `fixtures/demo-route.json`.

Rules:

- **Never** edit a file you don't own. Need a change? Ask the owner.
- **Never** define a parallel type because the shape you want isn't in
  `core/types.ts`. Ask A to add it. Two competing `Landmark` types is how this
  project dies.
- **Never** import a concrete provider class outside `src/providers/index.ts`.
  Depend on the interface. That's the whole point of the swap points.
- Root configs (`package.json`, `tsconfig.json`, `vite.config.ts`) are A's.

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

#### Measured quota — our actual key, free tier

Verified by live calls, not guessed:

| | Limit | Notes |
| --- | --- | --- |
| Rate | **5 requests/minute** | Three devs testing at once will 429 each other |
| Requests | 1 000 / month | Not the binding limit |
| Tokens | 100 000 / month | **This is what binds** |
| Audio | 3 600 s / month | Not the binding limit |

**Cost is a flat ~334 tokens per request, independent of clip length** — a 1.5 s
and a 6.0 s clip both billed 330 prompt tokens. So the budget is *per request*,
not per second:

> ## 🔴 ~299 transcription requests for the whole month, shared across all three of us.
> Roughly 100 per person, for three days of development **and** the demo.

Latency is good — **0.6–1.0 s** round trip — so this is a budget problem, not a
speed problem. Consequences, all mandatory:

- **`FixtureStt` is the development default.** Never point at MERaLiON during
  routine UI work; a hot-reload loop that re-transcribes will drain the month in
  an afternoon.
- **Cache transcriptions by audio hash.** Testing the same phrase twenty times
  should cost one request.
- **Handle `429` explicitly**, not just timeouts — at 5 rpm you will hit it.
  Fail over to `WebSpeechStt`. This is load-shedding, not a nicety.
- Budget ~20 requests for rehearsal plus the live demo. That part is fine.

Check remaining headroom any time:

```bash
curl -s -H "Authorization: Bearer $MERALION_API_KEY" https://api.meralion.ai/keys/usage
```

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
  (≤500 m for buildings, 20 m for roads). `BUILDINGNAME` is null/absent for
  unnamed buildings — i.e. most HDB blocks — so fall back to `Block {BLOCK} {ROAD}`.
  Expect *"Block 226"* far more often than *"the coffee shop"*. Write the demo
  script around what the data actually returns.
- **Walk routes return `route_geometry` as an encoded polyline.** Decode with
  `core/geo.decodePolyline` (precision 5). `pt` returns a totally different
  OTP-shaped payload — we don't use it.
- **Search now needs a token too** (docs banner). Unauthenticated calls currently
  still return results *with an error field attached* — a grace period, not a
  guarantee.
- **429 `Exceeded quota limit` is real.** One journey is ~10 reverse-geocode
  calls plus up to 8 routing calls. Cache on coordinates rounded to 5 dp.

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
interface SttProvider     { name: string; transcribe(wav: Blob, lang: Lang): Promise<Transcription> }
interface TtsProvider     { name: string; speak(text, lang): Promise<void>; cancel(): void
                            primeForUserGesture(): void; availableLangs(): Lang[] }
interface RoutingProvider { name: string; walkRoute(from: LatLng, to: LatLng): Promise<RouteCandidate> }
interface PlaceProvider   { name: string; search(q): Promise<Place[]>
                            reverseGeocode(at: LatLng, bufferM: number): Promise<Building[]>
                            theme(queryName: string, bbox: BBox): Promise<Poi[]> }
interface LocationProvider{ name: string; start(cb: (p: Position) => void): void; stop(): void }
```

| Interface | Real | Fallback | Fixture |
| --- | --- | --- | --- |
| `SttProvider` | `MeraLionStt` | `WebSpeechStt` (6 s timeout) | `FixtureStt` |
| `TtsProvider` | `BrowserTts` | — | `FixtureTts` |
| `RoutingProvider` | `OneMapRouting` | — | `FixtureRouting` |
| `PlaceProvider` | `OneMapPlaces` | — | `FixturePlaces` |
| `LocationProvider` | `SimulatedProvider` | `GeolocationProvider`, `ManualProvider` | — |

Note `SimulatedProvider` is the **primary** demo path, not a fallback — judges
are indoors.

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

**Write a test that asserts the output is really 16 kHz mono.** This is the most
likely thing to break silently.

---

## 5. Core types

Full definitions in `src/core/types.ts`. The ones that matter most:

- **`Landmark`** — the *only* things the LLM may refer to. Every one came from a
  real API response or a baked dataset. `name` is emitted verbatim.
- **`RouteCandidate`** — decoded polyline + manoeuvres. Several per journey; we
  score and rank them.
- **`ComfortScore`** — shelter coverage, rest points, toilets, longest
  unsheltered run, extra distance, stairs.
- **`Step`** — what the senior hears. `landmarkId` **must** exist in the
  journey's `landmarks`.
- **`JourneyState`** — phase, journey, current step index.

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

`core/validate.ts:validateSteps()` checks:

1. Every `landmark_id` is in the supplied set.
2. Proper-noun scan — any Latin-script token not in the lexicon or
   `GENERIC_ALLOWLIST` is an invented name.
3. Step count matches manoeuvre count.

Collect **all** violations; don't early-return. The retry prompt works much
better when it sees everything.

On failure: retry once with the violations fed back. On the second failure, use
`validate.templateSteps()` — safe by construction.

> ## 🚨 THE ONE RULE
> **Nothing is ever spoken that has not passed `validateSteps()`.**
>
> A hallucinated landmark leaves a senior standing at a junction looking for a
> building that doesn't exist. That is worse than no app at all.

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
