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

## 👤 Irfan — Pipeline spine + comfort routing + Voice I/O (99%)

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
- [x] ~~`providers/stt.ts` — `MeraLionStt` (via `POST /api/understand`)~~
      **DONE, LIVE-VERIFIED end to end** — real browser client, through
      Vite's proxy, through the real server, to real MERaLiON, one deliberate
      spend. `MeraLionStt.transcribe()` deliberately returns only
      `{text, confidence}` even though `/api/understand`'s response carries
      more (`destination`, `clarify`) — `SttProvider` is scoped to "just
      transcribe"; whoever wires up the real (non-demo) orchestration should
      call `/api/understand` directly for the combined result rather than
      double-calling through this provider. Documented inline.
      ⚠️ **`SttProvider.transcribe()` gained an `at: LatLng` parameter** — not
      in the original stub signature. `/api/understand` requires it
      (nearby-buildings context for Gemini's extraction) and nothing else
      told `transcribe()` where the user was. `FixtureStt`/`WebSpeechStt`
      just ignore it.
- [x] ⚠️ ~~Use `/v1/audio/transcriptions`~~ — this trap lives in
      `server/meralion.ts`, not here; this provider never calls MERaLiON
      directly, only our own server.
- [x] ~~`WebSpeechStt` fallback + `createStt()` racing a 6 s timeout~~ **DONE,
      LIVE-VERIFIED — caught two real bugs, both fixed:**
      1. **`WebSpeechStt.isSupported()`'s `'x' in globalThis` check is
         fragile** — verified live it reports `true` for a global that's
         merely a present KEY (e.g. explicitly set to `undefined`), not one
         that's an actually-usable constructor. Fixed to check
         `typeof === 'function'` instead (via the same constructor-resolving
         helper `transcribe()` already needed).
      2. **A second, unwrapped failure could escape `createStt()`'s
         fallback entirely.** The auto-failover class only wrapped the case
         where `WebSpeechStt.isSupported()` said no upfront — if it said yes
         but the actual attempt then failed too (permission denied, no
         speech heard), that raw error (e.g.
         `"WebSpeechStt error: not-allowed"`) propagated straight to the
         caller instead of the friendly "please say it again" message.
         Fixed by wrapping the fallback attempt in its own try/catch, so
         EVERY exit path is either a real success or the same friendly
         message — never a raw error a 70-year-old would see.
      Verified live: MERaLiON success (no failover), a 429, and a network
      error each correctly triggering fallback; WebSpeech succeeding after a
      MERaLiON failure; both failing together producing the friendly
      message; and the real `MERALION_TIMEOUT_MS` (6000ms) timing out at
      ~6104ms measured, not hanging forever.
- [x] ~~**Fail over on `429` too, not just timeout**~~ **DONE** —
      `MeraLionStt.transcribe()` throws a tagged error on a real 429 response
      (`status: 429` on the Error object); `AutoFailoverStt` doesn't
      special-case it beyond that — ANY meralion failure (429, timeout,
      network error) triggers the same fallback path, verified for all three
      kinds live.
      ⚠️ **The "5 req/min" figure here was also stale** — see
      `server/meralion.ts`'s CP3 entry above: live-verified actual limit is
      200 req/min. `MERALION_RPM_LIMIT` in this file corrected to match.
- [ ] **Keep `FixtureStt` as your default while building UI.** ~299 MERaLiON
      requests for the entire month, shared with the team. Point at the real
      API only when specifically testing transcription. (Guidance, not a
      code task — nothing to check off, just don't forget it once the real
      orchestration is wired into the UI.)
- [ ] `requestMicPermission()` on first tap, so the OS prompt lands at a
      moment the user understands. **Partially done** — `ui/App.tsx`'s demo
      flow already calls it best-effort on tap (see its own CP1 entry above),
      but that's the fixture path, which doesn't actually record or call a
      real `SttProvider`. Wiring the REAL record-then-`stt.transcribe()` flow
      into the UI is still open — this file (`providers/stt.ts`) is ready for
      it, nothing here is blocking it.

### CP3 — language + validation
- [x] ~~`server/meralion.ts` — `transcribe`, `ping`, `rateLimitStatus`~~
      **DONE, LIVE-VERIFIED — and corrected a stale documented fact.** `ping()`
      + `rateLimitStatus()` cost no quota; `transcribe()` was tested with
      exactly ONE real call (a synthetic tone), deliberately minimal given the
      quota constraint below. Two findings:
      1. **The old "5 req/min" figure was wrong.** Live `rateLimitStatus()`
         reported `{ limit: 200, remaining: 200, window: "1 minute" }`;
         `remaining` dropped to 199 after the one real `transcribe()` call,
         confirming the endpoint tracks real usage, not a static number.
         **Actual limit: 200 req/min.** Token cost held up under fresh
         measurement though — that same call billed 337 total tokens,
         consistent with the documented ~334 flat-per-request figure. The
         100k-token monthly cap itself was NOT re-verified (would mean
         burning real quota just to measure the ceiling).
      2. **Silent/non-speech audio returns the literal string `"(nospeech)\n"`**
         — not an empty string, not an error. `/api/understand` treats this
         the same as "didn't catch that" rather than wasting a Gemini
         extraction call on it — verified live via the real HTTP endpoint.
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
- [x] ~~Retry-once-then-template fallback wired in~~ **DONE** — see
      `server/index.ts`'s `planJourneyCore`: `rewriteToSteps` →
      `validateSteps`; on failure, `rewriteToSteps` again with
      `validation.violations` fed back (this is why `rewriteToSteps` now
      takes an optional 4th `feedback` param — wasn't in the original stub
      signature); on a SECOND failure, `templateSteps`. On the real live run
      below, the first Gemini attempt passed validation clean — the retry
      path is implemented and unit-reachable but hasn't fired on real output
      yet, only in the deliberate-failure tests in `core/validate.ts`'s own
      verification.
- [x] ~~`POST /api/understand`, `/api/journey`, `/api/reanchor`~~ **DONE,
      LIVE-VERIFIED end to end** — all three, against real MERaLiON, OneMap,
      and Gemini, not fixtures and not mocks.
      **`/api/journey`** (real origin → AMK Hub, zh): full real pipeline in
      one HTTP call — `generateCandidates` (4 candidates, real OneMap
      routing) → `scoreRoute`/`rankRoutes` (winner correctly beat all 3
      rejected on comfort score) → `collectLandmarks` (11 real landmarks) →
      `rewriteToSteps` (natural, varied Chinese sentences, not template-style)
      → fed back through `validateSteps` as an explicit check: `ok: true`,
      zero violations. 3.5s round trip.
      **`/api/reanchor`** (mid-route position, ms): real nearest-landmark
      lookup + a full re-route, 200 OK, ~4s. Caught a real bug in the
      process — `recalculating` ("Saya cari jalan semula") is written
      capitalized for the same "also spoken standalone" reason as
      `validateSteps`' `arrived` bug above, and had the exact same mid-sentence
      capitalization problem when composed into the reassurance sentence.
      Unlike the `templateSteps` case, this text never passes through
      `validateSteps()` at all (it's a standalone reassurance phrase, not a
      `Step[]`), so nothing would have caught it automatically — only found
      by actually reading the live response text. Fixed by exporting
      `core/validate.ts`'s `lowercaseFirst` helper for reuse here.
      **`/api/understand`**: nospeech path verified via a real MERaLiON call
      through the actual HTTP endpoint (correct `clarify` response using the
      `notUnderstood` phrase); confirmed the audio-hash cache works (a repeat
      call with identical audio returned in 68ms, no second MERaLiON spend).
      The destination-extraction path (`extractDestination` → `search` →
      dedupe) was verified with real Gemini + OneMap calls directly rather
      than through a second `transcribe()` spend, since real speech audio
      isn't producible server-side — confirmed real OneMap search for
      "AMK Hub" genuinely returns 3 postal-variant results for the same
      building, and the dedupe-by-name step collapses them to 1 (this is
      exactly the ambiguity `server/onemap.ts`'s CONTRACTS.md note already
      flagged; now there's a concrete fix for it).
      **Real architecture gap found and fixed, twice, before either endpoint
      was even callable:** `PlanJourneyRequest.destinationId: string` and
      `ReanchorRequest.journeyId: string` both assumed a server-side lookup
      that doesn't exist — there's no journey/place store, and OneMap has no
      "get by id" endpoint. Both now carry the full `Place`/`destination`
      object instead; the client already has it (from `UnderstandResponse`
      or a `ClarifyScreen.onPick`), so it's passed through rather than the
      server trying to resurrect one from a bare string.
      ⚠️ **Windows dev-workflow note, not a code issue:** `npx tsx <script>`
      spawns 3 processes (npx wrapper → tsx CLI wrapper → the actual node
      runtime), and the real runtime's command line doesn't contain the
      literal substring "tsx" — so `pkill -f "tsx server/index.ts"` only
      kills the wrapper layers, leaving the real server running and bound to
      the port. This produced a very confusing false alarm (one `/api/reanchor`
      call measured 118s) that had nothing to do with the route-handler code —
      a clean single-instance restart of the exact same code measured 3-4s.
      Use `netstat -ano` to find the real listening PID and `taskkill //F //PID`
      on Windows, not `pkill -f`.

### CP3/CP4 — the differentiator
- [x] ~~`core/comfort.ts` — `generateCandidates`, `scoreRoute`, `describeScore`,
      `rankRoutes`.~~ **DONE, built on `@turf/turf` (installed).** See
      `CONTRACTS.md` § 9 for the function map and two real bugs the smoke test
      caught (a non-pedestrian covered way, a false "shortest route" rationale
      claim) — both fixed and documented inline.
      ⚠️ **`stairsCount` is a placeholder (`0`)** — no data source wired up yet.
      OSM's `highway=steps` is queryable via the same Overpass pull that found
      shelter/bench/toilet but hasn't been pulled. Real gap, not fabricated.
- [x] ~~Wire `generateCandidates`/`scoreRoute` into `server/llm.ts`'s journey
      endpoint once `server/onemap.ts`'s `walkRoute` is real (CP2)~~ **DONE**
      — see `/api/journey` above; this is `planJourneyCore` in
      `server/index.ts`, live-verified against real OneMap routing, not the
      mock `RoutingProvider` the original smoke test used.
- [x] ~~Return `rejected` candidates so Lija's judge view has something to
      show~~ **DONE** — `PlanJourneyResponse.rejected` is populated from
      `rankRoutes`' non-winning candidates; confirmed live (3 rejected
      candidates, each with its own real comfort score, on the test run
      above). `JudgeView` itself is still a stub — this is the data it'll
      render once built.
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
- [x] ~~`JourneyScreen` — **ONE step, never a list**~~ **DONE, LIVE-VERIFIED**
      (Lija, via the `journey` branch — merged 2026-09-09, clean, no real
      conflicts despite a stale-diff false alarm; see below). Progress dots
      row (`N / stepCount`), current step in `.step-text`, always-visible
      "I'm lost" button. This checklist line was stale — the merge landed
      the real component, not just the props App.tsx was already passing.
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
- [x] ~~`ListeningScreen` — visible "still working" state; silence reads as
      broken~~ **DONE, LIVE-VERIFIED** (Irfan, on Lija's behalf — see
      2026-09-09 note below on why). Pulse-dot + `@keyframes pulse`
      (`ui/theme.css`, respects `prefers-reduced-motion`), text switches
      between `book.listening`/`book.thinking` on the `thinking` prop
      (`state.phase === 'resolving'`), `sayAgain` always visible.
- [x] ~~`ClarifyScreen` — speak the question aloud, then wait. It's a
      feature.~~ **DONE, LIVE-VERIFIED** end to end through the REAL (non-demo)
      pipeline — real recording, real `/api/understand` shape (mocked
      response, real request/response wiring), a real `/api/journey` call
      after tapping a candidate. Speaking + waiting lives in `ui/App.tsx` (a
      `useEffect` on the `clarifying` phase), not the component itself.
      Candidate buttons render as `btn-primary`; `sayAgain` renders
      `btn-danger` when candidates exist (a visual "none of these" signal),
      `btn-primary` otherwise.
- [x] ~~`ArrivedScreen`~~ **DONE, LIVE-VERIFIED.** `book.arrived` (colored
      `--ok`), destination name, `goHome` → dispatches `RESET`.
- [x] ~~`GeolocationProvider` + `ManualProvider`~~ **DONE.**
      `GeolocationProvider` wraps `navigator.geolocation.watchPosition`,
      surfaces failures through `LocationProvider.start()`'s new optional
      `onError` param (see § 3 in CONTRACTS.md) instead of swallowing them.
      `ManualProvider` takes `path` via constructor (same shape as
      `SimulatedProvider`, not a separate setter) — `start()` emits
      `path[0]`, `advance()` steps forward clamped at the end, never throws
      on repeated taps past it.
- [x] ~~`JudgeView` (`?judge=1`) — chosen vs rejected routes, score
      breakdowns, **live comfort weight sliders**, the landmark set, any
      validation violations~~ **DONE, LIVE-VERIFIED** — dragging the "Rest
      points" slider live re-ranked the table (🏆 moved from `cand-direct` to
      `cand-sheltered` mid-interaction, `-1.60`/`-1.66` → `-1.14`/`-0.73`),
      confirming this actually calls `scoreRoute`/`rankRoutes` on every
      change and isn't a static snapshot. `JudgeViewProps` gained
      `amenities: Poi[]` and `directDistanceM: number` (not in the original
      stub — `scoreRoute()` needs both and nothing else supplied them) plus
      optional `violations?: Violation[]`.

  **2026-09-09 — merged Lija's `journey` branch, then implemented all of the
  above on her behalf.** Fetch showed a diff that first looked like ~1185
  lines of deletions across Irfan-owned files; `git merge-base` + `git show`
  on her actual commit showed that was just `journey` being 5 commits behind
  `main`, not real conflicting changes — her one commit only touched
  `JourneyScreen.tsx` (+33/-2). Merged clean, verified live, pushed. With
  Lija now actively committing (unlike earlier in the project), building the
  rest of her scope risked real conflicts — confirmed with the user before
  proceeding anyway.

  Real bugs found and fixed along the way, beyond the screens/providers
  themselves:
  1. **`.btn-danger` was silently broken since JourneyScreen's first build.**
     `ui/theme.css` used `composes: btn-primary`, which is CSS-Modules-only
     syntax — meaningless in this plain global stylesheet. Verified live via
     `getComputedStyle`: `minHeight`/`padding`/`fontSize`/`fontWeight`/
     `border`/`borderRadius` were all silently falling back to browser
     defaults (only the directly-declared `background`/`color` worked) —
     under the 64px tap-target minimum the whole product is built around.
     Fixed by duplicating `.btn-primary`'s properties directly.
  2. **`App.tsx`'s real (non-demo) pipeline wasn't wired to anything.**
     `runDemoFlow` was the only flow that ever ran, regardless of
     `opts.demoMode` — the default (`demoMode: false`, no query params) was
     supposed to run the real MERaLiON/OneMap/Gemini pipeline (Failure plan
     layers 1-2 in this doc), but nothing ever called
     `audio/capture.ts:createRecorder()` or `/api/understand`/`/api/journey`
     from the UI at all. Added `runRealFlow` (record 5s → `/api/understand`
     directly, not through `providers.stt` — see `stt.ts`'s own header on
     why → `/api/journey` or `CLARIFY`), branched on `opts.demoMode` in
     `handleSpeak`.
  3. **`journey/machine.ts`'s `reduce()` had no path from `clarifying` to
     `ready`.** The state diagram only drew clarifying's exit as the
     say-again loop back to `listening` — there was never a `RESOLVED`
     handler under `case 'clarifying'`, even though `clarify.candidates`
     existing at all is specifically for tappable resolution. Found live:
     tapping a real candidate called `/api/journey` correctly but the
     dispatch was a silent no-op, screen just sat there. Added `RESOLVED`
     handling to the `clarifying` case (see CONTRACTS.md § 5).
  4. **"I'm lost" during a demo run silently broke `DEMO_MODE`'s zero-network
     contract.** The naive wiring called the real `/api/reanchor` regardless
     of `opts.demoMode` — a real OneMap/Gemini round trip mid-demo, exactly
     what Failure plan layer 3 promises never happens. Demo mode now speaks
     a canned `book.recalculating` and reanchors with no network at all.
  5. **Reanchoring (either path) never restarted location tracking.** The
     universal "stop the walk when phase isn't navigating" effect tears down
     `locationRef` the moment `IM_LOST` fires; dispatching `REANCHORED` back
     to `navigating` doesn't undo that on its own. Without an explicit
     `startSimulatedWalk()` call after both the demo-mode and the
     no-new-journey real-mode reanchor, the walk froze permanently at
     whatever step it was on — reproduced live (stalled at step 2/4 for 10s+
     with zero further advancement). Fixed by restarting the provider with
     whichever journey ends up current. `SimulatedProvider.start()` always
     resets to path position 0 (no resume-from-progress support), so this
     replays the already-walked portion of a simulated route instead of
     resuming from where it was — cosmetic only (`currentStepIndex` doesn't
     move until the walker catches back up past it), and GPS/manual modes
     have no such replay at all.

### CP4
- [x] ~~"I'm lost" flow end to end~~ **DONE, LIVE-VERIFIED** (both demo-mode
      and, via mocked-but-real-shaped `/api/reanchor`, the real path) — see
      the 2026-09-09 note above (fixes 4 and 5 were both found testing this
      specifically).
- [ ] Sunlight legibility pass on the real device — needs a physical phone
      outdoors, out of reach here.
- [x] Verified by inspection (updated 2026-09-10, see merge note below): no
      senior-facing screen renders a *real* map (tiles/pan/zoom/street
      detail) or a list of upcoming steps. `ConfirmationScreen` and
      `JourneyScreen` do render `RoutePreview` — a static schematic line, not
      a real map — as a deliberate, team-agreed exception (CONTRACTS.md § 8).
      `JudgeView` is the only screen with a full map/route table, and it's
      judge-only (`?judge=1`, never reached by the senior-facing state
      machine).
- [x] ~~Language must be reachable without typing a URL~~ **DONE, 2026-09-10**
      — see the note below. Real, user-reported bug: `zh` vs `ms` used to
      come ONLY from `?lang=ms`, no in-app switcher anywhere, defaulting
      silently to `zh`. Fixed with `LanguageScreen` (screen zero).

### 2026-09-10 — merged Lija's `lija` branch (UI bootstrap: new screens + redesign)

`origin/lija` (not `origin/journey`, which is stale) turned out not to be
behind `main` at all — `git merge-base main origin/lija` was exactly main's
tip, so this was a clean fast-forward, not a divergent-history merge. She
shipped: `ConfirmationScreen` (new `ready`-phase screen — route summary +
comfort rationale + Start/Change, sitting between "resolved" and
"navigating"), `Icon`/`Trail`/`RoutePreview` components, a full visual
redesign (warm palette, "EZ Jalan" branding in the UI copy and README —
`package.json`'s `ah-gong-gps` name is untouched, so this is UI-facing only
for now), and a `vite.config.ts` fix bridging `DEMO_MODE`→`VITE_DEMO_MODE`.
`ListeningScreen` was extended (an icon added), not removed.

One real bug found and fixed post-merge: her `ConfirmationScreen` refactor
correctly stopped `resolveAndStart` (real pipeline) from auto-starting the
walk — the comment *"ConfirmationScreen owns the final start action"* — but
the parallel `runDemoFlow` (fixture path) kept its `startSimulatedWalk()`
call after removing only the `START_JOURNEY` dispatch. Net effect: in demo
mode, the location-provider walk silently started the instant the
destination resolved, one whole `ConfirmationScreen` dwell-time before the
user ever tapped Start — invisible in practice (`ready`-phase
`STEP_ADVANCE`/`ARRIVED` dispatches are no-ops per `journey/machine.ts`, and
`handleStartJourney` stops-and-restarts the provider fresh from position 0
when actually tapped) but wasted work and inconsistent with her own stated
intent. Removed the leftover call so both paths match.

### 2026-09-10 — added LanguageScreen (screen zero): language is no longer URL-only

Real, user-reported bug, not a style nit: `ui/App.tsx`'s `resolveDemoLang()`
picked `zh` vs `ms` ONLY from `?lang=ms` in the URL, defaulting silently to
`zh` with no in-app switcher anywhere (confirmed — zero grep hits for one).
A Malay-reading user landing on the plain URL got every string on her first
screen — header, eyebrow, headline, location line, the one big button — in a
script she cannot read, with no escape except typing a query string, exactly
the capability this app's target user doesn't have. The old doc comment's
"a UI toggle would violate one action per screen" reasoning had picked the
wrong tradeoff: a screen with two buttons for one decision is navigable
(same shape as `ClarifyScreen`'s candidate picker); a screen in the wrong
script is a dead end. Same severity class as CONTRACTS.md § 8's "no map"
rule — a core-value-prop bug, not a preference.

Fixed with `LanguageScreen` (new, `src/ui/screens/`) — screen zero, shown
before `HomeScreen` until a language is chosen: two equal-weight buttons,
`中文` / `Bahasa Melayu`, each labelled only in its own script, deliberately
no other text on screen at all (any prompt would itself need a script,
reintroducing the exact problem). Choice persists (`localStorage`, key
`ezjalan:lang`) so a returning user goes straight to the mic screen.
`?lang=` still works as an explicit override (demo links, judges, testing)
and now also gets persisted once used, so it's remembered on a later visit
without the param. `?judge=1` still bypasses the picker entirely — a judge
doesn't need to pick a language first, and `JudgeView` is internal debug UI.

Typing decision worth recording: `lang` in `App()` stays ALWAYS a valid
non-null `Lang` (defaulting to `'zh'` pre-choice, never actually observed by
the user since nothing senior-facing renders until the new `langChosen`
boolean flips true) rather than becoming `Lang | null` throughout. The
latter would have forced `lang!` assertions or guards into ~5 call sites
(`runDemoFlow`, `runRealFlow`, `resolveAndStart`, `handleImLost`, both TTS
effects) — all defined before any early return is allowed to appear (Rules
of Hooks), so TS's control-flow narrowing from a later `if (!langChosen)
return` can't retroactively apply to those closures. A separate boolean gate
avoided that blast radius entirely.

No other file needed changes at the time — `HomeScreen`'s `.language` badge
and inline `lang === 'ms' ? ... : ...` ternaries already worked correctly
once `lang` was populated. Deliberately NOT in scope THEN: an ongoing
in-app language switcher (a one-time picker + persistence only, matching
the literal ask) — flagged as a follow-up since a wrong pick's only
recovery was clearing site data or revisiting with `?lang=`.

### 2026-09-10 (later same day) — made the `.language` badge tappable

The flagged follow-up above, done: `HomeScreen`'s `.language` badge is now
a real `<button>` (was a plain `<span>`) — tapping it toggles directly
between `zh`/`ms` (only two real options, so a straight toggle beats
reopening the full `LanguageScreen`) and persists the new choice the same
way `LanguageScreen` does. Safe with no confirmation needed: this badge
only ever renders on `HomeScreen`, which only renders when `state.phase` is
`'idle'` (or a defensive fallback for a missing journey) — there is never
an in-progress journey underneath it to invalidate. Deliberate, narrow,
documented exception to two rules: `HomeScreen`'s own "no settings" header
comment (this is a correction affordance, not a menu) and CONTRACTS.md §
8's 64px tap-target rule (padding+negative-margin gives a comfortable
invisible hit area without visually bloating the header — acceptable for a
rarely-used corrective control, not a primary action).

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

- [x] `npm run typecheck` clean (verified 2026-09-09, whole project)
- [x] ~~`npm test` green — comfort scoring, validation rejecting known-bad
      output, geofence hysteresis, polyline decode, 16 kHz audio
      assertion~~ **DONE, 2026-09-10** — 76 assertions across 5 files,
      colocated as `*.test.ts` next to the code they cover (no test config
      needed; vitest's default include pattern already matched):
      - `core/comfort.test.ts` (16) — `scoreRoute` against synthetic
        sheltered/exposed routes, `extraDistanceM` clamping at 0,
        `describeScore`'s phrase selection including the exact
        "shortestWalk shouldn't fire alongside a real clause" regression
        this file's own doc describes, `rankRoutes` ordering.
      - `core/validate.test.ts` (18) — the actual point of this file:
        confirmed `validateSteps` REJECTS a hallucinated `landmark_id`, an
        invented English proper noun in `zh` text, a step-count mismatch,
        and empty spoken text, while accepting real landmark names kept
        verbatim and the generic allowlist. The `ms` language-dependent
        scan needed two attempts — the first version asserted this file's
        own doc example ("Berjalan ke Pasar Blok 226H.") passes generically,
        but it only passes in the real system because "Pasar"/"Blok"/"226H"
        are literally that journey's landmark name, in the lexicon — a
        lexicon hit short-circuits the ms capitalization heuristic
        entirely. Fixed by giving the test a matching landmark, same as a
        real journey would have.
      - `journey/machine.test.ts` (13) — `reduce()`'s happy path,
        universal escape hatches (SAY_AGAIN/ERROR/RESET), the
        `clarifying`→`RESOLVED` path added this week, and out-of-phase
        no-ops; `shouldAdvance`'s radius/hysteresis boundaries plus the
        exact tight-gap regression this file's header names by name (two
        manoeuvres closer together than RADIUS+HYSTERESIS, walked
        1m-per-tick end to end, confirming it never stalls).
      - `core/geo.test.ts` (18) — `decodePolyline` against the canonical
        Google polyline-algorithm reference vector (not derived from our
        own code), `haversineM`/`bearingDeg` against independently
        computable real-world values, `pointAlong`/`nearestOnPolyline`
        clamping and on-segment snapping, `poisWithinRadius`,
        `sampleShelterCoverage`, `boundsOf`.
      - `audio/capture.test.ts` (11) — `encodeWav`'s RIFF/WAVE header
        fields (16 kHz, mono, 16-bit PCM, correct chunk sizes), PCM sample
        clamping at the ±1 boundary, `resample`'s identity/empty/
        downsampling cases.
      `createRecorder()` itself (real `getUserMedia`/`AudioContext`/
      `AudioWorklet`) and `generateCandidates()` (needs a live
      `RoutingProvider`) are still live-verified only, not unit tested —
      both need real browser/network state that isn't worth mocking here.
- [ ] `DEMO_MODE=1` completes button → arrival with no network
- [ ] Live run on the demo corridor; every `landmark_id` resolves to a real record
- [ ] Rewrite run 20× on the demo route, **zero** validation failures
- [ ] Chosen route beats the direct route on shelter coverage in the judge view
- [ ] On the demo phone: mic, zh-CN + ms-MY speech, GPS advance over one real
      block, "I'm lost" from an off-route position
- [ ] Network-pull rehearsal passes
- [x] ~~Deployed to Vercel, reachable from a phone browser with no login~~
      **DONE, 2026-09-10** — see the note below; two real deploy-time bugs
      found and fixed, and public access needed an explicit protection
      change.

### 2026-09-10 — deployed to Vercel; found two real ESM-only runtime bugs

The frontend (`vite build` → `dist/`) was already auto-deploying fine via
Vercel's own Vite detection from the earlier "just link the repo" step, but
every `/api/*` call 404'd — nothing on Vercel was ever running the Express
server, confirmed live (`GET /api/health` → 404). Fixed with the standard
pattern: `api/index.ts` re-exports `server/index.ts`'s Express `app` as the
default export, `vercel.json` rewrites `/api/(.*)` to that one function so
Express's own already-`/api/`-prefixed routes keep matching unchanged, and
`server/index.ts`'s `app.listen()` is now guarded on `!process.env.VERCEL`
(set automatically by the platform) since a serverless function invokes the
exported app directly per request and never needs to bind a port.

That alone still 500'd on every request (`FUNCTION_INVOCATION_FAILED`) —
found via `get_runtime_logs`, not visible anywhere in the build output.
**Two real, sequential bugs, both specific to Node's own ESM loader** (tsx
locally and Vite for the client bundle both paper over these — this only
ever showed up in the actually-deployed runtime):
1. `ERR_MODULE_NOT_FOUND` — every relative import needs a fully-specified
   extension (`from './onemap.js'`, not `from './onemap'`) for Node's native
   ESM resolution, unlike tsx/Vite's flexible bundler-style resolution.
   Fixed across the whole graph `api/index.ts` actually loads at runtime:
   `server/index.ts` + everything it imports (`onemap.ts`, `meralion.ts`,
   `llm.ts`, `cache.ts`, and the `src/core/comfort|landmarks|validate.ts` +
   `src/phrases` it pulls in). `import type` lines untouched — those are
   erased at compile time, so the extension is moot for them.
   `moduleResolution: "bundler"` (tsconfig.json) explicitly permits a `.js`
   specifier resolving to a sibling `.ts` file, so this didn't change
   typechecking, Vite, or tsx at all — confirmed via a full
   tsc/build/test/`dev:api` pass after each fix.
2. `ERR_IMPORT_ATTRIBUTE_MISSING` — Node 22+ (Vercel's function runtime is
   Node 24.x) requires an explicit `with { type: 'json' }` attribute on a
   JSON import; `import amenitiesData from '../data/amenities.json'` alone
   now throws instead of just working.

Also had to explicitly disable the project's Vercel Authentication (SSO)
deployment protection — it was `all_except_custom_domains`, which still
gates every `*.vercel.app` URL (this project has no custom domain), so a
phone not logged into the Vercel account would've hit a login wall. Flagging
this explicitly since it's a real access-control change, not just code: the
deployment is now genuinely public, with no auth in front of it.

**Still open, not done here:** `MERALION_API_KEY`/`ONEMAP_EMAIL`/
`ONEMAP_PASSWORD`/`GEMINI_API_KEY` are not set as Vercel project environment
variables (confirmed live — `/api/health` reports all three `false` on the
deployment, `true` locally) — no available tool can set them, so the real
(non-demo) pipeline will 502 on Vercel until they're added by hand via the
dashboard. `?demo=1` needs none of them and was live-verified working end
to end on the actual production URL.
