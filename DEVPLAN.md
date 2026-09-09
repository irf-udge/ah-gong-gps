# DEVPLAN

Demo in **2–3 days**. Three people. Read [`CONTRACTS.md`](./CONTRACTS.md) first —
it contains verified API facts that contradict what you'd assume.

**Guiding principle:** a complete demo exists by the end of Day 1, running
entirely on fixtures. Everything after that raises fidelity. There is never a
point where nothing runs.

---

## ⛔ Phase 0 — blockers (first 2 hours, before any feature code)

These are cheap to do now and expensive to discover late. Do them in parallel.

- [x] ~~**A —** Register MERaLiON key + record the quota.~~ **DONE — key is in
      `.env` and verified live (HTTP 200, 0.6–1.0 s round trip).**
      **Quota measured: free tier, 5 req/min, and a flat ~334 tokens per request
      regardless of clip length → the 100k token cap binds at ~299 requests for
      the whole month, across all three of us.** See `CONTRACTS.md` § 2.1.
      → **Therefore: `FixtureStt` is the dev default, cache by audio hash, and
      handle 429 explicitly.** Do not point routine UI work at MERaLiON.
- [x] ~~**A —** Register OneMap.~~ **DONE — raw token in `.env`, verified live
      against search, revgeocode, route and themes (all HTTP 200).**
      > 🔴 **TOKEN EXPIRES 2026-09-10 23:27 SGT.** That is a hard 72-hour clock,
      > and it lands *on* the late end of our demo window. A raw token cannot
      > self-refresh.
- [ ] **A — do this anyway:** get `ONEMAP_EMAIL` + `ONEMAP_PASSWORD` so the
      server can mint its own tokens and refresh on 401. Ten minutes now removes
      a single point of failure that kills every route and landmark on stage.
- [x] ~~**A —** Enumerate OneMap themes.~~ **DONE — 165 layers, 11 usable, saved
      to `fixtures/onemap-themes.json`.** Result: **no** shelter / bench / toilet
      / lift / bus-stop layer exists. Themes are a *landmark* source only.
- [ ] **A —** Anthropic key in `.env`. Verify with `curl localhost:8787/api/health`.
- [ ] **B — ⚠️ Highest-value 10 minutes of the project.** On the **actual demo
      phone**, run `speechSynthesis.getVoices()` and confirm a **`zh-CN`** and a
      **`ms-MY`** voice exist. If Malay is missing, half the demo is dead and we
      need to know now, not on Day 3.
- [ ] **C —** Pick the demo device and confirm HTTPS tunnelling works on it
      (`cloudflared tunnel --url http://localhost:5173`). Mic and GPS need a
      secure context.
- [x] ~~**A —** Find covered-linkway/bench/toilet data.~~ **RESOLVED.**
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
| **CP0** | Day 1, hour 2 | A's `core/types.ts`, `core/geo.ts` and `fixtures/demo-route.json` are pushed. **B and C are blocked until this lands** — ship it rough. ✅ *already in the scaffold* |
| **CP1** | End of Day 1 | **Vertical slice on fixtures.** C's UI + state machine drives B's TTS over A's fixture data; the simulated journey plays end to end and speaks. *A complete demo exists.* |
| **CP2** | Mid Day 2 | Real MERaLiON transcription (B) and real OneMap routes + landmarks (A). C swaps the fixture route for the live one. |
| **CP3** | End of Day 2 | Claude rewrite + validation live. Comfort re-ranking and the judge view working. |
| **CP4** | Day 3 | Malay parity, "I'm lost", real GPS, hardening, rehearsal. |

---

## 👤 A — Pipeline spine + comfort routing (50%)

Owns `src/core/**`, `src/providers/{index,types,onemap,fixtures}.ts`,
`server/**`, `data/**`, `fixtures/**`.

### CP0 — the unblock package (hard deadline, hour 2)
- [x] `src/core/types.ts` — every shared type
- [x] `src/core/geo.ts` — haversine, bearing, polyline decode, point-to-segment
- [x] `fixtures/demo-route.json` — full journey, both languages
- [ ] Push it. Tell B and C.

### CP1 — server skeleton
- [ ] `server/onemap.ts` — token fetch + refresh (single in-flight promise on 401)
- [ ] `server/index.ts` — implement the four `/api/onemap/*` proxies
- [ ] LRU cache keyed on coords rounded to 5 dp — **not optional**, OneMap 429s
- [ ] `providers/fixtures.ts` — make `DEMO_MODE=1` fully work end to end
- [ ] `providers/index.ts` — wire `createProviders()`

### CP2 — real geography
- [ ] `server/onemap.ts` — `search`, `reverseGeocode`, `walkRoute`, `retrieveTheme`
- [ ] `providers/onemap.ts` — browser-side clients hitting our proxy
- [ ] `core/landmarks.ts` — `collectLandmarks`, `rankForManoeuvre`, `localisedName`
- [x] ~~Run `listAllThemes()` and pick useful layers.~~ **DONE** — see
      `USEFUL_THEMES` in `server/onemap.ts`. Landmarks only; no comfort layers exist.
- [ ] `data/etl.ts` — query Overpass (4 layers), classify, clip to corridor, bake `data/amenities.json`

### CP3 — language + validation
- [ ] `server/meralion.ts` — `transcribe`, `ping`, `rateLimitStatus`
- [ ] `server/llm.ts` — `extractDestination` (effort `low`), `rewriteToSteps`
- [ ] `core/validate.ts` — `buildLexicon`, `validateSteps`, `templateSteps`
- [ ] Retry-once-then-template fallback wired in
- [ ] `POST /api/understand`, `/api/journey`, `/api/reanchor`

### CP3/CP4 — the differentiator
- [ ] `core/comfort.ts` — `generateCandidates` (waypoint variants, **parallel** calls)
- [ ] `core/comfort.ts` — `scoreRoute`, `describeScore`, `rankRoutes`
- [ ] Return `rejected` candidates so C's judge view has something to show
- [ ] Pre-warm the demo route's cache for stage day

---

## 👤 B — Voice I/O (25%)

Owns `src/audio/**`, `src/providers/{stt,tts}.ts`, `src/phrases/**`.

**You are not blocked by anyone.** Everything below can be built against a local
`.wav` file and the MERaLiON API directly.

### CP0
- [ ] **The voice check** (see Phase 0). Do this before anything else.

### CP1 — capture + speak
- [ ] `audio/capture.ts` — `createRecorder`, `encodeWav`, `resample`, `blobToBase64`
      → **16 kHz mono WAV**. Read `CONTRACTS.md` § 4 first; don't use `MediaRecorder`.
- [ ] **Test asserting the output really is 16 kHz mono.** Most likely silent breakage.
- [ ] `providers/tts.ts` — `BrowserTts.speak/cancel/availableLangs`
- [ ] `primeForUserGesture()` — iOS won't speak later unless synthesis was first
      invoked inside a user gesture. Hook it to the big button's first tap.
- [ ] Handle Chrome's async `getVoices()` — it returns `[]` until `voiceschanged`
- [ ] `phrases/` — review the starter zh/ms strings; **read them aloud**

### CP2 — real transcription
- [ ] `providers/stt.ts` — `MeraLionStt` (via `POST /api/understand`)
- [ ] ⚠️ Use `/v1/audio/transcriptions`. The console's JS sample's path is a 404.
- [ ] `WebSpeechStt` fallback + `createStt()` racing a 6 s timeout
- [ ] **Fail over on `429` too, not just timeout** — the free tier is 5 req/min
      and three of us testing at once will trip it
- [ ] **Keep `FixtureStt` as your default while building UI.** We have ~299
      MERaLiON requests for the entire month, shared. Point at the real API only
      when you're specifically testing transcription.
- [ ] `requestMicPermission()` on first tap, so the OS prompt lands at a moment
      the user understands

### CP4
- [ ] Malay parity — every phrase, both directions
- [ ] "Say it again" reachable from every state; never dead-end the user

---

## 👤 C — Journey experience (25%)

Owns `src/ui/**`, `src/journey/**`, `src/main.tsx`.

**You are not blocked by anyone** — build against `fixtures/demo-route.json`.

### CP1 — the shell and the simulated walk
- [ ] `journey/location.ts` — **`SimulatedProvider` first.** It's the primary demo
      path (judges are indoors) and the only way to develop without walking
      around Ang Mo Kio. Give it speed control + `jumpTo`.
- [ ] `journey/machine.ts` — `reduce()` over `JourneyEvent`
- [ ] `journey/machine.ts` — `shouldAdvance()`: monotonic, hysteresis, debounced
- [ ] `ui/App.tsx` — replace the scaffold placeholder with the screen router
- [ ] `HomeScreen` — one big button, nothing else
- [ ] `JourneyScreen` — **ONE step, never a list**
- [ ] Wire C's UI → B's TTS → A's fixture data. **This is CP1.**

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
