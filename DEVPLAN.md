# DEVPLAN

Demo in **2–3 days**. Two people — Irfan and Lija. Read [`CONTRACTS.md`](./CONTRACTS.md)
first — it contains verified API facts that contradict what you'd assume.

**Guiding principle:** a complete demo exists by the end of Day 1, running
entirely on fixtures. Everything after that raises fidelity. There is never a
point where nothing runs.

---

## ⛔ Phase 0 — blockers (first 2 hours, before any feature code)

These are cheap to do now and expensive to discover late. Do them in parallel.

- [x] ~~**Irfan —** Register MERaLiON key + record the quota.~~ **DONE — key is in
      `.env` and verified live (HTTP 200, 0.6–1.0 s round trip).**
      **Quota measured: free tier, 5 req/min, and a flat ~334 tokens per request
      regardless of clip length → the 100k token cap binds at ~299 requests for
      the whole month, between the two of us.** See `CONTRACTS.md` § 2.1.
      → **Therefore: `FixtureStt` is the dev default, cache by audio hash, and
      handle 429 explicitly.** Do not point routine UI work at MERaLiON.
- [x] ~~**Irfan —** Register OneMap.~~ **DONE — raw token in `.env`, verified live
      against search, revgeocode, route and themes (all HTTP 200).**
      > 🔴 **TOKEN EXPIRES 2026-09-10 23:27 SGT.** That is a hard 72-hour clock,
      > and it lands *on* the late end of our demo window. A raw token cannot
      > self-refresh.
- [x] ~~**Irfan — do this anyway:** get `ONEMAP_EMAIL` + `ONEMAP_PASSWORD`~~
      **DONE.** Both in `.env`, and `server/onemap.ts` prefers them over the
      raw token specifically for this reason — live-verified minting/refresh
      throughout the CP2 OneMap work (see `getToken()`).
- [x] ~~**Irfan —** Enumerate OneMap themes.~~ **DONE — 165 layers, 11 usable, saved
      to `fixtures/onemap-themes.json`.** Result: **no** shelter / bench / toilet
      / lift / bus-stop layer exists. Themes are a *landmark* source only.
- [x] ~~**Irfan —** Gemini key in `.env`~~ **DONE — confirmed via
      `/api/health` (`keys.gemini: true`) and live-tested end to end
      (`server/llm.ts`'s extraction + rewrite calls, see CP3 below).**
- [ ] **Irfan — ⚠️ Highest-value 10 minutes of the project.** On the **actual demo
      phone**, run `speechSynthesis.getVoices()` and confirm a **`zh-CN`** and a
      **`ms-MY`** voice exist. If Malay is missing, half the demo is dead and we
      need to know now, not on Day 3.
- [ ] **Lija —** Pick the demo device and confirm HTTPS tunnelling works on it
      (`cloudflared tunnel --url http://localhost:5173`). Mic and GPS need a
      secure context.
- [x] ~~**Irfan —** Find covered-linkway/bench/toilet data.~~ **RESOLVED.**
      data.gov.sg confirmed dead a second time — drove the actual search UI:
      "covered linkway" (43 results, all false positives on the word
      "covered"), "linkway" (0 results), "bench" (10 results, all
      "benchmark"). OneMap Themes re-checked exhaustively too (all 165, by eye,
      not just grep) — still nothing.
      **Replacement found: OpenStreetMap via the Overpass API** (free, no key).
      Verified live: 14,980 covered ways + 1,300 benches **nationwide**; in the
      AMK demo corridor alone, 198 covered ways, 38 building-passage linkways,
      9 benches, 3 toilets. One source now covers all three missing layers.
      See `CONTRACTS.md` § 2.3 and `data/etl.ts` (query shape + the pedestrian-
      filtering gotcha — `covered=yes` also matches covered bus driveways).
      ⚠️ **New: ODbL attribution required** — add "© OpenStreetMap contributors"
      somewhere visible (About screen or the deck's sources slide).

> **Already decided, don't re-litigate:** Green Man+ is out (outdated dataset).
> Family live-view is out (needs real backend state). Pre-generated TTS is out
> (browser synthesis is local; there's no latency to hide).

---

## Checkpoints

| | When | Must be true |
| --- | --- | --- |
| **CP0** | Day 1, hour 2 | Irfan's `core/types.ts`, `core/geo.ts` and `fixtures/demo-route.json` are pushed. **Lija is blocked until this lands** — ship it rough. ✅ *already in the scaffold* |
| **CP1** | End of Day 1 | **Vertical slice on fixtures.** Lija's UI + state machine drives the TTS and fixture data Irfan built; the simulated journey plays end to end and speaks. *A complete demo exists.* |
| **CP2** | Mid Day 2 | Real MERaLiON transcription and real OneMap routes + landmarks (Irfan, both). Lija swaps the fixture route for the live one. |
| **CP3** | End of Day 2 | Gemini rewrite + validation live. Comfort re-ranking and the judge view working. |
| **CP4** | Day 3 | Malay parity, "I'm lost", real GPS, hardening, rehearsal. |

---

## 👤 Irfan — Pipeline spine + comfort routing + Voice I/O (93%)

Owns `src/core/**`, `src/providers/**`, `src/audio/**`, `src/phrases/**`,
`server/**`, `data/**`, `fixtures/**`. (Originally two roles — A: pipeline
spine + comfort routing, B: voice I/O — now one person; nothing below is
split by role anymore, just grouped by checkpoint.)

### CP0 — the unblock package (hard deadline, hour 2)
- [x] `src/core/types.ts` — every shared type
- [x] `src/core/geo.ts` — haversine, bearing, polyline decode, point-to-segment
- [x] `fixtures/demo-route.json` — full journey, both languages
- [ ] Push it. Tell Lija.

### CP1 — fixture-mode wiring + capture/speak
- [x] ~~`providers/fixtures.ts` — make `DEMO_MODE=1` fully work end to end.~~
      **DONE, runtime-verified (not just typechecked).** `FixturePlaces`,
      `FixtureRouting`, `FixtureStt` all implemented against the real fixture
      JSON. Added `buildDemoJourney(lang)` / `buildDemoRejected(lang)` — a
      complete, pre-scored `Journey` assembled straight from the fixture, zero
      network, zero LLM calls. **Lija: call this instead of `POST /api/journey`
      when `demoMode` is true** — that's the actual CP1 target. See
      CONTRACTS.md § Provider interfaces.
- [x] ~~`providers/index.ts` — wire `createProviders()`.~~ **DONE, runtime-
      verified.** One real design fix along the way: `location` came out of
      the `Providers` bundle entirely (`SimulatedProvider` needs a route
      polyline that doesn't exist at app-start time) — it's now a separate
      `createLocationProvider(mode, path?)` call Lija's `journey/machine.ts`
      makes once a journey exists. Confirmed it correctly instantiates Lija's
      `SimulatedProvider` class and throws clearly on a missing path, without
      touching `journey/location.ts` itself.
      ⚠️ Confirmed **TTS is `BrowserTts` in BOTH real and demo mode** — not
      `FixtureTts` (that's for headless tests; going silent is the one thing
      a demo kill switch must never do).
- [x] ~~`audio/capture.ts` — `createRecorder`, `encodeWav`, `resample`,
      `blobToBase64`.~~ **DONE, verified two ways.** Pure functions
      (`encodeWav`, `resample`, `blobToBase64`) unit-tested in Node — 18
      assertions, including parsing the WAV header back out and confirming
      **16000 Hz, 1 channel, 16-bit** (the actual contract, not just "didn't
      throw"), Int16 clamping with no wraparound, and base64 round-tripping
      correctly across the chunk boundary. `createRecorder()` (real
      AudioWorklet + getUserMedia) verified live in the browser pane with a
      synthetic 440Hz test tone standing in for a mic — see CONTRACTS.md § 4
      for two real bugs this caught that a pure unit test never would have:
      1. **Silent recordings from an unconnected worklet.** Without a path
         to `destination`, the render graph didn't pull the capture branch
         at all — reproduced directly (all-zero WAV from a real input tone),
         fixed by routing through a `gain=0` node to keep the graph "live"
         without audible playback.
      2. **A cold-start race that can eat the first word of an utterance.**
         The FIRST `AudioContext`+`AudioWorklet`+`getUserMedia` chain on a
         fresh page has real startup latency; a short recording immediately
         after `start()` can capture nothing but that startup silence.
         Reproduced 2x, fixed by having `start()` wait for the first genuine
         buffer from the worklet (bounded, 500ms max) before resolving,
         re-verified fixed across 3 consecutive fresh-page runs afterward.
      ⚠️ Still worth doing: an automated test asserting 16 kHz mono on CI,
      not just the one-off manual verification run above.
- [x] ~~`providers/tts.ts` — `BrowserTts.speak/cancel/availableLangs`,
      `primeForUserGesture()`.~~ **DONE, runtime-verified in a real browser**
      (Vite dev-serves `.ts` directly, so `import('/src/providers/tts.ts')`
      from the console exercises the real module — not a mock, not just
      `tsc`). Confirmed live: `speak()` resolves only after genuine
      completion (measured real elapsed time, not just "didn't throw");
      a deliberate `cancel()` **resolves** the promise (not reject) and
      returns almost immediately rather than waiting out the utterance;
      calling `speak()` twice back-to-back cancels the first cleanly with no
      stacked/overlapping audio; a language with no matching voice (`ms`, on
      the machine this ran on) degrades to the plain `.lang` string instead
      of throwing. `primeForUserGesture()` speaks a silent space
      synchronously — empty string is silently ignored by some engines.
      ⚠️ **Voices on that machine were `zh`/`en` only, no `ms`** — this is
      the browser-pane dev machine, **not** the real demo phone, so it does
      **not** replace the Phase 0 voice check. It does confirm the matching
      logic itself is correct against real `voice.lang` data, which was the
      part actually worth testing in code.
      Added `waitForVoicesReady()` — resolves once `getVoices()` has real
      entries (handles Chrome's async `voiceschanged` population, which
      `availableLangs()` can't itself await since the `TtsProvider` interface
      requires it stay synchronous). Call this once at app start so
      `availableLangs()` isn't reporting `[]` on Chrome's first tick.
- [ ] `phrases/` — review the starter zh/ms strings; **read them aloud**

### CP2 — real geography + real transcription
- [x] ~~`server/onemap.ts` — token fetch + refresh (single in-flight promise on
      401).~~ **DONE, LIVE-VERIFIED.** Prefers `ONEMAP_EMAIL`+`ONEMAP_PASSWORD`
      (recoverable) over a raw `ONEMAP_TOKEN` (isn't) even when both are set.
- [x] ~~`server/index.ts` — implement the four `/api/onemap/*` proxies.~~ **DONE**
      — thin handlers, 400 on bad/missing params, 502 on a real OneMap failure.
- [x] ~~LRU cache keyed on coords rounded to 5 dp — **not optional**, OneMap
      429s.~~ **DONE, LIVE-VERIFIED.** New `server/cache.ts`: a small generic
      `LruCache<K,V>` + `memoizeAsync` (caches the in-flight PROMISE, not just
      the value, so concurrent identical calls share one upstream request —
      verified 3 concurrent identical `walkRoute` calls produced exactly 1
      real network call). A failed call is never cached — it removes itself so
      the next call retries instead of replaying a 429 forever. Wired onto all
      four read functions in `server/onemap.ts` (`search`, `reverseGeocode`,
      `walkRoute`, `retrieveTheme`); `getToken`'s own single-in-flight-promise
      cache was untouched (already correct, verified still 1 token fetch
      across a 7-call test run). Confirmed live, by spying on `global.fetch`
      around real calls (not mocks): identical `walkRoute(from,to)` called
      twice → 1 network call; a genuinely different `to` → 2; 3 concurrent
      identical calls → 1. Pure LRU eviction/touch logic has 18 passing
      assertions run via `tsx` before it was ever wired to a real endpoint.
- [x] ~~`server/onemap.ts` — `search`, `reverseGeocode`, `walkRoute`,
      `retrieveTheme`, `listAllThemes`.~~ **DONE, LIVE-VERIFIED against the real
      key on 2026-09-09** — all 5 endpoints hit for real, not just typechecked.
      Found and fixed 4 real gotchas beyond what CONTRACTS.md already knew:
      1. **"No value" is the literal string `"NIL"`**, not null/absent, on
         both `search` and `revgeocode` — confirmed against Blk 226 Ang Mo Kio
         Ave 1, a genuinely unnamed HDB block.
      2. **`route_instructions[i]`'s distance field is off-by-one from what our
         `Manoeuvre.distanceM` means.** OneMap's distance on instruction `i` is
         the walk FROM that point TO the next one; ours is FROM the previous
         manoeuvre TO this one. Verified against a real route (Head's raw
         distance was 39, not 0) — get this backwards and every turn's lead-in
         distance is silently wrong, with no type error to catch it.
      3. **Collapsed micro-turns, as CONTRACTS.md's stub comment demanded.** A
         real 745 m route came back as 7 instructions with 3 turns inside the
         first 77 m; `collapseMicroTurns` (25 m threshold) folds those into the
         following turn — 7 raw instructions → 5 spoken-worthy manoeuvres.
      4. **`retrieveTheme`'s field schema differs PER THEME**, and coordinate
         encoding differs by feature `Type` (`Point`→`"lat,lng"`,
         `Line`→`"[[lng,lat],...]"`, GeoJSON order). Worse: `extents` isn't
         reliably honoured server-side — `park_connector_loop` returned 784
         features nationwide for a bbox covering one estate. Added a
         client-side bbox filter; never trust the server's clipping again.
      Extended `PoiKind` (core/types.ts) with `hospital`/`pharmacy`/`polyclinic`
      — 3 of the 8 `USEFUL_THEMES` had no matching kind before this.
- [x] ~~`providers/onemap.ts` — browser-side clients hitting our proxy.~~
      **DONE, LIVE-VERIFIED in a real browser** through the full chain:
      `OneMapPlaces`/`OneMapRouting` → Vite dev proxy → Express → real OneMap.
- [x] ~~`core/landmarks.ts` — `collectLandmarks`, `rankForManoeuvre`,
      `localisedName`.~~ **DONE, LIVE-VERIFIED** against the real route +
      real OneMap theme data (33 assertions, real network calls, not mocks).
      Found and fixed a real bug along the way: `reverseGeocode`'s `bufferM`
      isn't a hard cutoff either — same class of issue as `retrieveTheme`'s
      `extents` (see CONTRACTS.md § 2.2). A `buffer=50` request returned
      buildings up to 262 m away; fixed at the source in `server/onemap.ts`.
      That fix then EXPOSED a second real gap on the actual demo route: with
      the buffer correctly enforced, 2 of the 5 real manoeuvres had zero
      landmark candidates within `LANDMARK_RADIUS_M` (50 m) — a turn can sit
      at a junction with nothing named nearby. Added `FALLBACK_RADIUS_M`
      (150 m), tried only when the tight radius comes up empty; both gaps
      recovered with real nearby buildings (e.g. "SHELL ANG MO KIO AVENUE 6").
      Design calls made along the way, all documented inline:
      · Buildings/amenities with no usable name are **dropped, not degraded**
        to a generic label — a bare road name would be exactly the
        street-name-based direction this product exists to avoid, and an
        unnamed OSM amenity doesn't fit `Landmark.name`'s "verbatim, never
        translated" contract. They stay fully available to `core/comfort.ts`
        for scoring; they just never become a spoken landmark.
      · `rankForManoeuvre` sorts by recognisability tier FIRST (named building
        > named OneMap theme landmark > numbered block > bus stop > anonymous
        OSM amenity), distance only breaks ties within a tier — verified this
        is what "a named building beats an unnamed block" in the original
        stub comment actually requires, not distance-first sorting.
      · Landmark ids are scoped per-manoeuvre (`m{index}:...`) since the same
        physical building can legitimately anchor two different manoeuvres
        with two different distanceM/bearingDeg pairs, and `Journey.landmarks`
        is one flat array every `Step.landmarkId` must resolve unambiguously
        against.
      · Removed a duplicate `landmarkDisplayName` from `server/llm.ts` (its
        own comment said "not built yet, don't call into it" — now it is) and
        pointed it at the real `localisedName` instead.
- [x] ~~Run `listAllThemes()` and pick useful layers.~~ **DONE** — see
      `USEFUL_THEMES` in `server/onemap.ts`. Landmarks only; no comfort layers exist.
- [x] ~~`data/etl.ts` — query Overpass (4 layers), classify, clip to corridor,
      bake `data/amenities.json`.~~ **DONE, LIVE-VERIFIED AND RUN FOR REAL** —
      `data/amenities.json` is committed: 176 POIs (164 shelter, 9 bench, 3
      toilet) for `DEMO_BBOX`. `buildAmenityIndex()` classifies from tags off
      the SAME `PEDESTRIAN_HIGHWAYS` list `OVERPASS_QUERIES` itself is built
      from, so the query and the classifier can't drift apart — confirmed
      live: 0 of 182 raw elements came back unclassified. 3 of 4 category
      counts (building_passage=38, bench=9, toilet=3) matched this file's own
      previously-documented investigation numbers exactly; the 4th
      (covered-walkway) differs in the expected direction only because this
      pass adds a pedestrian-only filter the original investigation didn't
      have (132 vs 198 — narrower on purpose, see CONTRACTS.md § 2.3).
      Two real bugs found and fixed live, both in CONTRACTS.md § 2.3 now:
      1. Overpass's Apache front-end 406s any request with no `User-Agent`
         header — which is exactly what Node's `fetch` sends by default.
         Found by elimination (curl worked, raw `https.request` with the
         same missing header didn't); fixed by sending a descriptive UA.
      2. Overpass's own bbox filter isn't perfectly tight either (6/182
         elements outside `DEMO_BBOX` on the real corridor) — same lesson as
         OneMap's `extents`/`buffer`. `buildAmenityIndex` clips client-side.
      Also ran a full end-to-end integration smoke test with real data before
      calling this done: real `walkRoute` + the real baked `amenities.json`
      through `core/comfort.ts`'s `generateCandidates`/`scoreRoute` (4
      candidates, 18-31% shelter coverage, sensible ranking) AND
      `core/landmarks.ts`'s `collectLandmarks` (all 5 real manoeuvres got at
      least one landmark) — confirms this pass's output actually plugs into
      both of Irfan's earlier CP2/CP3 pieces, not just that the file compiles.
      New `data/README.md` (referenced by `.gitignore` but never written)
      documents the baked file's shape and the ODbL attribution obligation.
- [ ] `providers/stt.ts` — `MeraLionStt` (via `POST /api/understand`)
- [ ] ⚠️ Use `/v1/audio/transcriptions`. The console's JS sample's path is a 404.
- [ ] `WebSpeechStt` fallback + `createStt()` racing a 6 s timeout
- [ ] **Fail over on `429` too, not just timeout** — the free tier is 5 req/min
      and testing at busy moments could trip it
- [ ] **Keep `FixtureStt` as your default while building UI.** We have ~299
      MERaLiON requests for the entire month, shared with Lija. Point at the
      real API only when specifically testing transcription.
- [ ] `requestMicPermission()` on first tap, so the OS prompt lands at a moment
      the user understands

### CP3 — language + validation
- [ ] `server/meralion.ts` — `transcribe`, `ping`, `rateLimitStatus`
- [x] ~~`server/llm.ts` — `extractDestination`, `rewriteToSteps`.~~ **DONE AND
      LIVE-TESTED**, on Gemini (free tier), not Anthropic — see CONTRACTS.md
      § LLM for the full story. Both calls use `gemini-3.5-flash-lite` — the
      entire `gemini-2.5-*` line 404s for a real key despite what the docs
      said, and `gemini-3.5-flash` (non-lite) measured 6-7s vs lite's
      1.2-1.7s for the same structured-output call, too slow for a live demo.
      Ran end to end against real fixture data in **both** zh and ms —
      extraction correctly detects language and rejects non-destination
      utterances; every rewritten step's `landmark_id` stayed inside the
      supplied set, no invented landmarks in either language.
- [x] ~~`core/validate.ts` — `buildLexicon`, `validateSteps`,
      `templateSteps`~~ **DONE, LIVE-VERIFIED** against the real fixture in
      both languages — 21 assertions, not just typechecked.
      Two real bugs found and fixed (both written up in full in
      CONTRACTS.md § 6):
      1. **Malay is itself Latin-script.** The original "any Latin-script
         token not in the lexicon = invented" rule (correct for `zh`) would
         have flagged nearly every ordinary word in every `ms` sentence —
         confirmed by running the actual `ms` fixture text through a naive
         version first. Fixed with a language-aware scan (`ms` only flags
         capitalized, non-sentence-initial tokens); `validateSteps()` now
         takes a `lang: Lang` parameter that wasn't in the original stub
         signature, since nothing else tells it which language it's scanning.
      2. **`templateSteps()`'s "safe by construction" fallback had a real
         bug**, caught by feeding its own output back through
         `validateSteps()` — the `arrive` template reused the phrase book's
         standalone `arrived` string ("Anda sudah sampai") mid-sentence,
         where its capitalization reads as an invented proper noun. Fixed by
         lowercasing it for the mid-sentence case (the grammatically correct
         behaviour, not a validator workaround).
- [ ] Retry-once-then-template fallback wired in
- [ ] `POST /api/understand`, `/api/journey`, `/api/reanchor`

### CP3/CP4 — the differentiator
- [x] ~~`core/comfort.ts` — `generateCandidates`, `scoreRoute`, `describeScore`,
      `rankRoutes`.~~ **DONE, built on `@turf/turf` (installed).** See
      `CONTRACTS.md` § 9 for the function map and two real bugs the smoke test
      caught (a non-pedestrian covered way, a false "shortest route" rationale
      claim) — both fixed and documented inline.
      ⚠️ **`stairsCount` is a placeholder (`0`)** — no data source wired up yet.
      OSM's `highway=steps` is queryable via the same Overpass pull that found
      shelter/bench/toilet but hasn't been pulled. Real gap, not fabricated.
- [ ] Wire `generateCandidates`/`scoreRoute` into `server/llm.ts`'s journey
      endpoint once `server/onemap.ts`'s `walkRoute` is real (CP2) — tested so
      far against a mock `RoutingProvider`, not live OneMap.
- [ ] Return `rejected` candidates so Lija's judge view has something to show
- [ ] Pre-warm the demo route's cache for stage day

### CP4
- [ ] Malay parity — every phrase, both directions
- [ ] "Say it again" reachable from every state; never dead-end the user

---

## 👤 Lija — Journey experience (45%)

Owns `src/ui/**`, `src/journey/**`, `src/main.tsx`.

**You are not blocked by anyone** — build against `fixtures/demo-route.json`.

### CP1 — the shell and the simulated walk
- [x] ~~`journey/location.ts` — **`SimulatedProvider` first.**~~ **DONE,
      LIVE-VERIFIED** (Irfan implemented this on Lija's behalf — see commit).
      Speed control + `jumpTo`, built on `core/geo.ts`'s `pointAlong`
      (written for exactly this — see its own doc comment). Progress is
      recomputed fresh from wall-clock time on every tick, not accumulated
      tick-by-tick, so it can't drift. 13 assertions against real timers:
      monotonic advancement, clamping at the path end (an absurd 5000 m/s
      still lands within 1mm of the endpoint, never overshoots), `jumpTo`
      teleports immediately including out-of-range clamping, `setSpeed`
      changes pace with zero position discontinuity, `stop()` is idempotent.
      ⚠️ `SIM_SPEED_MPS` (1 m/s) is realistic walking pace, not stage pace —
      a 745m route would take ~12 min at 1x. `setSpeed()`/`jumpTo()` are the
      actual on-stage mechanism, not an afterthought; crank speed up for the
      demo, keep it at 1x for developing the geofence logic at a believable
      pace. See § below for a real constraint this interacts with.
- [x] ~~`journey/machine.ts` — `reduce()` over `JourneyEvent`~~ **DONE,
      LIVE-VERIFIED** (Irfan, on Lija's behalf). 36 assertions: the full
      happy-path flow, the clarify branch, lost/reanchor (including the
      `event.journey === null` "no re-route needed" case), universal
      `SAY_AGAIN`/`ERROR` from all 9 phases, and out-of-phase events being
      safe no-ops rather than crashing. `planning` (in this file's own ASCII
      diagram) is deliberately never set by `reduce()` — no `JourneyEvent`
      corresponds to it; by the time `RESOLVED` fires, the caller has already
      run destination resolution + routing + comfort + landmarks + rewrite,
      so `resolving` jumps straight to `ready`.
- [x] ~~`journey/machine.ts` — `shouldAdvance()`: monotonic, hysteresis,
      debounced~~ **DONE, LIVE-VERIFIED — caught and fixed a real bug** that
      only an end-to-end test with the actual `SimulatedProvider` surfaced.
      First version checked raw straight-line distance to the previous
      manoeuvre for hysteresis; when two consecutive manoeuvres sit closer
      together than `GEOFENCE_RADIUS_M + GEOFENCE_HYSTERESIS_M` (35m), "within
      RADIUS of the target AND beyond RADIUS+HYSTERESIS of the previous
      point" is geometrically **impossible** to satisfy at once (triangle
      inequality) — navigation stalled at that step **permanently**, not just
      for one jittery sample. Not a rare edge case either: a synthetic 6m gap
      exposed it immediately, and the real demo route's tightest real gap
      (40.8m straight-line) sits close enough to the 35m threshold that a
      different real route easily could too. Fixed by switching to
      `nearestOnPolyline`'s `distanceAlongM` — progress along the ROUTE, not
      point-to-point distance, exactly what that function's own doc comment
      already named this use case for. Scalar progress values don't have the
      impossible-constraint failure mode: any threshold along a line is
      always reachable by continuing to walk forward. Re-verified: a 1m-step
      fine-grained walk over the real 5-manoeuvre route (0 skips, strictly
      increasing, each manoeuvre fires exactly once) and the exact 6m-gap
      case that used to stall forever now resolves correctly.
      ⚠️ **Real constraint worth knowing, not fixed because no real demo
      scenario needs it:** `SimulatedProvider`'s tick rate (500ms) times an
      extreme speed multiplier CAN skip a fence's radius entirely between two
      samples — reproduced at 400 m/s (~800x realistic pace) on purpose to
      confirm the limit. A realistic "sped up for the stage" multiplier
      (verified at 5x = 5 m/s, and by construction safe up to roughly
      `2×GEOFENCE_RADIUS_M / (TICK_MS/1000)` ≈ 100 m/s) has no such risk.
      Don't crank the judge-view speed slider past that without re-checking.
- [x] ~~`ui/App.tsx` — replace the scaffold placeholder with the screen
      router~~ **DONE, LIVE-VERIFIED** (Irfan, on Lija's behalf). Owns both
      the phase->screen mapping AND the top-level orchestration (reducer,
      providers, the demo pipeline) — a router with nothing driving state
      transitions wouldn't route anywhere. `?judge=1` is checked first,
      independent of phase, rendering `JudgeView` with real fixture-derived
      props. `planning`/`ready`/`lost`/`error` fall back to `ListeningScreen`
      rather than a blank screen — none have a dedicated screen yet
      (`ready` auto-advances to `navigating` in the same tick and is never
      actually rendered; `planning` is unreachable — see machine.ts).
- [x] ~~`HomeScreen` — one big button, nothing else~~ **DONE, LIVE-VERIFIED.**
      Button fills the whole screen (`flex: 1` inside `.screen`), uses the
      REAL localised `tapToSpeak` phrase from `src/phrases` (not invented
      text) — confirmed rendering correctly for both `zh` and `ms`.
- [ ] `JourneyScreen` — **ONE step, never a list**. Still a stub — App.tsx
      passes it correct real props (`step`, `stepCount`, `onImLost`,
      `onRepeat`) but the component itself just renders placeholder text.
- [x] ~~Wire Lija's UI → Irfan's TTS and fixture data. **This is CP1.**~~
      **DONE, LIVE-VERIFIED — the full demo lifecycle plays end to end.**
      Tap -> `primeForUserGesture()` (synchronous, before any await, per
      tts.ts's file header) -> best-effort mic permission request (never
      blocks the fixture path on denial) -> 1.2s "listening" pacing ->
      canned transcript -> `buildDemoJourney(lang)` -> speaks each step via
      real `speechSynthesis` as `SimulatedProvider` walks the real route ->
      `arrived`. Verified in 3 separate clean browser tabs (zh, ms, and a
      plain reliability re-check), zero console errors each time; confirmed
      `speechSynthesis.speaking === true` during navigation (the actual
      speak() call, not just that it didn't throw).
      Two real gaps found and fixed while wiring this up, beyond the two
      already documented under `shouldAdvance` above:
      1. **No event returned to `idle`.** `ArrivedScreen`'s "go home" had
         nothing to dispatch — `SAY_AGAIN` goes to `listening`, not `idle`,
         and no other `JourneyEvent` reaches `idle` after the flow starts.
         Added `RESET` (universal, like `SAY_AGAIN`/`ERROR` — wipes back to
         `initialState` from any phase) to `journey/machine.ts`.
      2. **`createLocationProvider` had no way to run faster than
         `SIM_SPEED_MPS` (1 m/s).** At the realistic default, a ~700m route
         takes ~12 minutes to walk — found by actually timing a live run.
         Added an optional `speedMps` param (`providers/index.ts`), passed
         through to `SimulatedProvider` only for `'simulated'` mode; App.tsx
         now drives playback at 20x (verified safe against
         `GEOFENCE_RADIUS_M`/`TICK_MS` earlier this session).

### CP2/CP3
- [ ] `ListeningScreen` — visible "still working" state; silence reads as broken
- [ ] `ClarifyScreen` — speak the question aloud, then wait. It's a feature.
- [ ] `ArrivedScreen`
- [ ] `GeolocationProvider` + `ManualProvider`
- [ ] `JudgeView` (`?judge=1`) — chosen vs rejected routes, score breakdowns,
      **live comfort weight sliders**, the landmark set, any validation violations

### CP4
- [ ] "I'm lost" flow end to end
- [ ] Sunlight legibility pass on the real device
- [ ] Verify no senior-facing screen renders a map or a step list

---

## Failure plan

Four layers, strongest first:

1. **Pre-warmed cache** for the demo route — stage-day traffic never leaves the process.
2. **MERaLiON → Web Speech** auto-failover on a 6 s timeout.
3. **`DEMO_MODE=1`** — every provider becomes a fixture. Zero network.
4. **`ManualProvider`** — next/prev buttons if GPS and simulation both misbehave.

**Rehearse layer 3.** Pull the network mid-demo and confirm it degrades with no
visible break.

---

## Definition of done

- [ ] `npm run typecheck` clean
- [ ] `npm test` green — comfort scoring, validation rejecting known-bad output,
      geofence hysteresis, polyline decode, 16 kHz audio assertion
- [ ] `DEMO_MODE=1` completes button → arrival with no network
- [ ] Live run on the demo corridor; every `landmark_id` resolves to a real record
- [ ] Rewrite run 20× on the demo route, **zero** validation failures
- [ ] Chosen route beats the direct route on shelter coverage in the judge view
- [ ] On the demo phone: mic, zh-CN + ms-MY speech, GPS advance over one real
      block, "I'm lost" from an off-route position
- [ ] Network-pull rehearsal passes
