// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// The screen router AND the top-level orchestration: owns the JourneyState
// reducer, builds the providers, and drives BOTH pipelines end to end. A
// router with nothing wiring state transitions to it wouldn't actually
// route anywhere, so this file owns both.
//
//   DEMO  (opts.demoMode, ?demo=1 or VITE_DEMO_MODE=1): runDemoFlow — tap ->
//   2.5s pacing -> canned transcript -> buildDemoJourney (bypasses
//   core/comfort.ts and server/llm.ts entirely on purpose, see its own doc)
//   -> ConfirmationScreen -> speak each step -> simulated walk -> arrive.
//   Zero network. Failure plan's layer 3 (see DEVPLAN.md) — also what a
//   judge testing indoors with no mic/GPS/network should demo instead.
//
//   REAL  (default when neither of the above is set): runRealFlow — tap ->
//   record 5s of real audio (audio/capture.ts) -> POST /api/understand
//   directly (not through providers.stt — see stt.ts's file header on why)
//   -> either resolveAndStart (unambiguous destination) or CLARIFY (asks,
//   waits for a tap or a re-listen) -> POST /api/journey -> ConfirmationScreen
//   (reviews the route, owns the actual "start" action — see
//   handleStartJourney) -> speak each real step -> walk it (GPS/simulated/
//   manual per ?loc=) -> arrive. "I'm lost" (handleImLost) calls
//   POST /api/reanchor the same way.
//
// Screen map: !langChosen -> LanguageScreen (screen zero, checked right
// after ?judge=1 — see resolveInitialLang below for why this exists), idle
// -> HomeScreen, listening/resolving -> ListeningScreen, clarifying ->
// ClarifyScreen, ready -> ConfirmationScreen, navigating -> JourneyScreen,
// arrived -> ArrivedScreen, ?judge=1 -> JudgeView (checked first,
// independent of phase and of langChosen — a judge doesn't need to pick a
// language). planning/lost/error don't have dedicated screens — they fall
// back to ListeningScreen rather than a blank one.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { haversineM } from '../core/geo';
import type {
  Journey,
  Lang,
  Landmark,
  LatLng,
  Place,
  Poi,
  PlanJourneyRequest,
  PlanJourneyResponse,
  Position,
  ReanchorRequest,
  ReanchorResponse,
  UnderstandRequest,
  UnderstandResponse,
} from '../core/types';
import { GEOFENCE_RADIUS_M } from '../journey/location';
import { initialState, reduce, shouldAdvance } from '../journey/machine';
import { createLocationProvider, createProviders, readProviderOptions } from '../providers';
import { buildDemoJourney, buildDemoRejected, buildDemoScoredRoute, DEMO_FIXTURE } from '../providers/fixtures';
import type { LocationProvider } from '../providers/types';
import type { Recorder } from '../audio/capture';
import { blobToBase64, createRecorder, requestMicPermission } from '../audio/capture';
import { ms, zh } from '../phrases';
import { ArrivedScreen } from './screens/ArrivedScreen';
import { ClarifyScreen } from './screens/ClarifyScreen';
import { HomeScreen } from './screens/HomeScreen';
import { JourneyScreen } from './screens/JourneyScreen';
import { ErrorScreen } from './screens/ErrorScreen';
import { JudgeView } from './screens/JudgeView';
import { LanguageScreen } from './screens/LanguageScreen';
import { ListeningScreen } from './screens/ListeningScreen';
import { ConfirmationScreen } from './screens/ConfirmationScreen';

/** Demo-mode pacing: how long "listening" shows before the canned transcript "arrives". Long enough to read, short enough not to feel broken. */
// Give an older user time to notice the listening state before the route
// confirmation appears during the fixture demo.
const DEMO_LISTEN_MS = 2500;
/**
 * Playback speed for the simulated walk. NOT SIM_SPEED_MPS's realistic 1x —
 * that's ~12 minutes for a real ~700m route, found live wiring this up.
 *
 * ⚠️ 2026-09-10: was 20 (72 km/h) — a real, demo-breaking bug, not just an
 * aggressive tuning choice. At that speed steps advanced faster than a
 * senior could read the display text, and faster than TTS could finish
 * speaking it — `BrowserTts.speak()` always cancels whatever's still
 * playing before starting the next utterance (see tts.ts's own doc: "must
 * never stack overlapping audio"), so on stage this meant EVERY step's
 * speech got cut off mid-sentence by the next advance, hiding the exact
 * "walked one landmark at a time, out loud" feature the demo exists to
 * show. Dropped to 5 (18 km/h) — still a visible fast-forward (a real
 * ~700m route finishes in ~2-3 min instead of ~12), slow enough that a
 * normal instruction sentence finishes speaking before the next geofence
 * is reached. Also now enforced directly, not just hoped for by tuning
 * this constant — see ttsSpeakingRef below, which holds STEP_ADVANCE until
 * the current step's speech has actually finished (or been deliberately
 * cancelled, e.g. by "I'm lost"), so an unusually long instruction can
 * never be cut off no matter what this number is set to.
 *
 * ⚠️ 2026-09-10: dropped again, 5 -> 3.5 (12.6 km/h) — ttsSpeakingRef already
 * makes it IMPOSSIBLE for speech to be cut off regardless of this number, so
 * this second drop is pure presentation pacing, not a correctness fix: at 5,
 * a longer instruction sentence still finishes only moments before the next
 * geofence arms, reading as rushed on stage. 3.5 leaves a comfortable gap
 * (a real ~700m route now finishes in ~3-4 min instead of ~2-3).
 *
 * ⚠️ 2026-09-10: raised again, 3.5 -> 5.5 (19.8 km/h) — 3.5 traded too much
 * the other way, dragging out a live presentation waiting on each geofence.
 * Still purely a pacing choice, not a correctness one: ttsSpeakingRef (see
 * above) holds STEP_ADVANCE/ARRIVED until the current step's speech has
 * actually finished regardless of what this number is, so raising this can
 * never bring back the original cut-off-speech bug — worst case the walker
 * reaches a geofence before its speech ends and STEP_ADVANCE simply waits,
 * rather than the geofence dictating pace.
 *
 * ⚠️ 2026-09-11: raised again, 5.5 -> 7 (25.2 km/h) — same reasoning as the
 * 5.5 bump above, tuned further toward "brisk but readable" for stage use.
 * ttsSpeakingRef is still the actual correctness guarantee, not this number.
 */
const DEMO_WALK_SPEED_MPS = 7;

/**
 * Real (non-demo) recording window. No push-to-talk/stop button exists —
 * "one action per screen" (see JourneyScreen.tsx's header) rules that out —
 * so this is a fixed window, same shape as DEMO_LISTEN_MS. 5s matches the
 * clip length used throughout audio/capture.ts's own doc comments and
 * CONTRACTS.md § Audio's sizing numbers, not picked independently.
 */
const REAL_RECORD_MS = 5_000;

/**
 * One-shot, FRESH position fix for /api/reanchor's `at` — "I'm lost" needs
 * where the walker is NOW, not the fix `userLocation` (below, in App())
 * captured back on the home screen before they started walking.
 *
 * ⚠️ 2026-09-10: this used to also back /api/understand's `at`, fetched
 * fresh on every mic tap with a 4s timeout, and fell back to
 * DEMO_FIXTURE.origin (AMK Hub) on ANY failure — denial, timeout, no
 * `navigator.geolocation`. A real visitor at Singapore Institute of
 * Management asked for directions to Clementi Mall and got routed FROM ANG
 * MO KIO, 189 minutes away: the fix silently didn't arrive in time (or was
 * denied) and the fallback quietly substituted a fake position instead of
 * surfacing an error. Real fix is `userLocation`/`locationStatus` in App()
 * below — the mic button is now simply unreachable until a real fix is
 * confirmed, so /api/understand no longer needs (or gets) a fallback path
 * at all. This function keeps the fallback-free shape for reanchor: no
 * `navigator.geolocation`/denial/timeout REJECTS rather than substituting
 * a guess, and handleImLost's own catch below already treats that as "keep
 * the existing route, just reassure" — which is the honest fallback,
 * unlike silently anchoring a reroute to the wrong city.
 */
function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message || 'Unable to determine location')),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 },
    );
  });
}

/**
 * ⚠️ 2026-09-10: this used to BE the whole language story — `?lang=ms` or
 * silently default to `zh`, no in-app way to switch. That's a dead end for
 * a user who can't read the script she landed on and has no way to type a
 * query string — not a minor inconvenience, a core-value-prop bug (same
 * severity class as CONTRACTS.md § 8's "no map" rule). Real fix is
 * LanguageScreen (screen zero, gated by `langChosen` below); these three
 * functions are just its supporting URL/localStorage plumbing now.
 */
const LANG_STORAGE_KEY = 'ezjalan:lang';

function readStoredLang(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_STORAGE_KEY);
    return v === 'zh' || v === 'ms' ? v : null; // validate, never blindly cast
  } catch {
    return null; // private browsing / storage disabled — fall through to the picker
  }
}

function writeStoredLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // best-effort only — a returning user re-picking once is a fine degradation
  }
}

/**
 * Resolve language on load, in priority order: an explicit `?lang=`
 * override (demo links, judges, testing — always wins), then a previously
 * PICKED language (LanguageScreen, persisted), then null — meaning nobody
 * has told us yet, so LanguageScreen must ask. Pure read only; persisting a
 * URL override is done in a useEffect in App() below, not here — this runs
 * inside a useMemo, and StrictMode double-invokes memo initializers in dev,
 * so a side effect here would run twice.
 */
function resolveInitialLang(): Lang | null {
  const param = new URLSearchParams(window.location.search).get('lang');
  if (param === 'zh' || param === 'ms') return param;
  return readStoredLang();
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const opts = useMemo(() => readProviderOptions(), []);
  const providers = useMemo(() => createProviders(opts), [opts]);

  // The home-screen location gate. `userLocation` is the anchor /api/understand
  // plans FROM — see getCurrentPosition()'s file header above for the bug
  // this replaces (a stale/denied fix silently substituting Ang Mo Kio for
  // a real visitor's real position). Demo mode never had that bug (it
  // never touches real geolocation) and keeps working instantly/offline:
  // both pieces of state start already 'ready', at the fixed demo origin.
  //
  // Real mode starts 'locating' and HomeScreen hides the mic button (and
  // everything else "one big button" competes with — see its own file
  // header) until this resolves — the button must never be reachable
  // before a REAL fix exists, that's the whole fix. `locationLabel` is a
  // second, independent thing built from the same fix: the nearest
  // building/block name for the "you are near X" line, left null (and the
  // line simply omitted by HomeScreen) whenever OneMap has no
  // building/landmark nearby to name — never guessed.
  const [userLocation, setUserLocation] = useState<LatLng | null>(opts.demoMode ? DEMO_FIXTURE.origin : null);
  const [locationStatus, setLocationStatus] = useState<'locating' | 'ready' | 'error'>(opts.demoMode ? 'ready' : 'locating');
  const [locationLabel, setLocationLabel] = useState<string | null>(null);

  const acquireLocation = useCallback(() => {
    if (opts.demoMode) return; // already 'ready' at DEMO_FIXTURE.origin above — never re-fetched
    if (!navigator.geolocation) {
      setLocationStatus('error');
      return;
    }
    setLocationStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(at);
        setLocationStatus('ready');
        providers.places
          .reverseGeocode(at, 100)
          .then((buildings) => {
            if (buildings.length === 0) return; // no nearby building/landmark — HomeScreen omits the line
            const nearest = buildings.reduce((a, b) => (haversineM(at, b.at) < haversineM(at, a.at) ? b : a));
            const label = nearest.buildingName ?? [nearest.block ? `Blk ${nearest.block}` : null, nearest.road].filter(Boolean).join(', ');
            if (label) setLocationLabel(label);
          })
          .catch(() => {}); // lookup itself failed — same as "nothing nearby": omit the line, routing already has userLocation
      },
      () => setLocationStatus('error'), // denied/unavailable/timed out — HomeScreen shows locationUnavailable + a retry button, never a silent guess
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, [opts.demoMode, providers.places]);

  // Kick off the very first fix on mount. Never retried automatically after
  // that — only the retry button (onRetryLocation -> acquireLocation) does.
  useEffect(() => {
    acquireLocation();
  }, [acquireLocation]);

  // `lang` itself stays ALWAYS a valid Lang (never null) — every closure
  // below that needs it (runDemoFlow, runRealFlow, resolveAndStart,
  // handleImLost, both TTS effects) is defined before any early return is
  // allowed to appear (Rules of Hooks), so typing `lang` as `Lang | null`
  // would force `lang!` assertions into every one of them: TS's
  // control-flow narrowing from a LATER `if (!langChosen) return` doesn't
  // retroactively apply to closures defined earlier in the function.
  // `langChosen` is the only new gate; the pre-choice 'zh' default below is
  // never actually observed by the user — state.phase starts at 'idle' and
  // nothing reaches HomeScreen (the only way any of those closures fire)
  // until langChosen is true.
  const initialLang = useMemo(() => resolveInitialLang(), []);
  const [lang, setLang] = useState<Lang>(initialLang ?? 'zh');
  const [langChosen, setLangChosen] = useState<boolean>(initialLang !== null);

  // Remember an explicit ?lang= override for next visit too — a proper
  // effect, not a side effect inside the useMemo above.
  useEffect(() => {
    if (initialLang !== null) writeStoredLang(initialLang);
  }, [initialLang]);

  const judgeMode = useMemo(() => new URLSearchParams(window.location.search).get('judge') === '1', []);

  const locationRef = useRef<LocationProvider | null>(null);

  // Single place that stops the walk simulation whenever we're not
  // navigating — covers every exit path (arrived, lost, say-again, reset,
  // error) without each handler needing its own cleanup call.
  useEffect(() => {
    if (state.phase !== 'navigating' && locationRef.current) {
      locationRef.current.stop();
      locationRef.current = null;
    }
  }, [state.phase]);
  useEffect(() => () => locationRef.current?.stop(), []);

  // The recorder currently capturing for runRealFlow, if any — lets
  // handleSayAgain abandon a take that's still in progress (mic held open,
  // buffer accumulating) instead of leaving it to finish and race the new
  // one. See handleSayAgain below.
  const activeRecorderRef = useRef<Recorder | null>(null);
  useEffect(() => () => activeRecorderRef.current?.cancel(), []);

  // Bumped by every runRealFlow/runDemoFlow call. A run captures its own id
  // and checks it before each dispatch past an await — if handleSayAgain (or
  // another tap) started a newer run in the meantime, the stale one's
  // eventual /api/understand or /api/journey response is discarded instead
  // of clobbering whatever the fresh run has already put on screen.
  const flowIdRef = useRef(0);

  // ⚠️ 2026-09-10: true for exactly as long as SOME utterance from any
  // speakTracked() call below is in flight — read by startSimulatedWalk's
  // position callback to hold STEP_ADVANCE until the current step's speech
  // has actually finished (naturally, or via a deliberate cancel(), e.g.
  // "I'm lost" — BrowserTts.speak() resolves rather than rejects on a
  // deliberate cancel, so this clears either way, never gets stuck).
  // Without this, the simulated walk could out-pace TTS and cut a step's
  // speech off mid-sentence purely by reaching the next geofence first —
  // real bug, found live, independent of how slow DEMO_WALK_SPEED_MPS is
  // tuned (see its own doc comment for the full story).
  const ttsSpeakingRef = useRef(false);
  const speakTracked = useCallback(
    (text: string, spokenLang: Lang) => {
      ttsSpeakingRef.current = true;
      return providers.tts.speak(text, spokenLang).finally(() => {
        ttsSpeakingRef.current = false;
      });
    },
    [providers.tts],
  );

  // Speak the current step whenever navigation enters it — fires on the
  // initial ready->navigating transition too, since state.phase is one of
  // the deps and currentStepIndex is already 0 by then (set by RESOLVED).
  useEffect(() => {
    if (state.phase !== 'navigating' || !state.journey) return;
    const step = state.journey.steps[state.currentStepIndex];
    if (!step) return;
    speakTracked(step.spokenText, state.journey.lang).catch(() => {
      // Speech failing shouldn't block navigation — the visible step text is still there.
    });
  }, [state.phase, state.currentStepIndex, state.journey, speakTracked]);

  const startSimulatedWalk = useCallback(
    (journey: Journey) => {
      locationRef.current?.stop();
      const speed = opts.location === 'simulated' ? DEMO_WALK_SPEED_MPS : undefined;
      const provider = createLocationProvider(opts.location, journey.route.candidate.polyline, speed);
      locationRef.current = provider;

      provider.start((position: Position) => {
        // Read fresh state via the ref, not the closed-over `state` from
        // whenever this callback was created — provider.start() registers
        // this once, but currentStepIndex/journey change on every advance.
        const current = stateRef.current;
        if (current.phase !== 'navigating' || !current.journey) return;
        // Hold every advance — including arrival — until the current step's
        // speech has actually finished (or been deliberately cancelled).
        // Re-checked on every position tick (every TICK_MS), so this adds at
        // most one tick of latency once speech naturally ends, not a stall.
        if (ttsSpeakingRef.current) return;

        if (haversineM(position.at, current.journey.destination.at) <= GEOFENCE_RADIUS_M) {
          locationRef.current?.stop();
          dispatch({ type: 'ARRIVED' });
          return;
        }

        const next = shouldAdvance(position, current.journey.steps, current.currentStepIndex, current.journey);
        if (next !== null) dispatch({ type: 'STEP_ADVANCE', index: next });
      });
    },
    [opts.location],
  );

  const runDemoFlow = useCallback(async () => {
    const myFlowId = ++flowIdRef.current;
    try {
      // Best-effort only — demo mode never transcribes real audio, so a
      // denial (or no mic at all) must not block the fixture-only path.
      void requestMicPermission().catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, DEMO_LISTEN_MS));
      if (flowIdRef.current !== myFlowId) return;
      const demoLangKey = lang === 'ms' ? 'ms' : 'zh';
      dispatch({ type: 'TRANSCRIPT', text: DEMO_FIXTURE.transcript[demoLangKey] });

      const journey = buildDemoJourney(lang);
      dispatch({ type: 'RESOLVED', journey });
      // ConfirmationScreen owns the final start action (see
      // handleStartJourney) — same as resolveAndStart below. Previously this
      // called startSimulatedWalk() immediately too, which silently started
      // a location-provider walk while ConfirmationScreen was still showing
      // (phase stuck at 'ready', so its STEP_ADVANCE/ARRIVED dispatches were
      // no-ops per journey/machine.ts's 'ready' case) — harmless in practice
      // since handleStartJourney's own startSimulatedWalk() call stops and
      // cleanly restarts it from position 0, but wasted work.
    } catch (err) {
      if (flowIdRef.current !== myFlowId) return;
      dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
    }
  }, [lang]);

  // Origin used to resolve the CURRENT clarify question — captured once per
  // listen so ClarifyScreen's onPick (which fires later, after the user
  // taps) still has the right position without re-asking the browser.
  const clarifyOriginRef = useRef<LatLng | null>(null);

  /**
   * Shared by the real flow's unambiguous case AND ClarifyScreen's onPick —
   * both end the same way: plan the route and hand off to ConfirmationScreen
   * for review. Despite the name, this no longer starts the walk itself —
   * `handleStartJourney` (ConfirmationScreen's onStart) owns that, same as
   * runDemoFlow's fixture path above.
   */
  const resolveAndStart = useCallback(
    async (destination: Place, origin: LatLng) => {
      const body: PlanJourneyRequest = { origin, destination, lang };
      const res = await fetch('/api/journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`/api/journey failed: ${res.status} ${await res.text()}`);
      const { journey } = (await res.json()) as PlanJourneyResponse;
      dispatch({ type: 'RESOLVED', journey });
    },
    [lang],
  );

  /**
   * Real (non-demo) pipeline: record real audio, call /api/understand
   * directly for the combined {transcript, destination, clarify} result —
   * per stt.ts's own file header, going through providers.stt here would
   * throw away destination/clarify and force a second, wasted round trip.
   */
  const runRealFlow = useCallback(async () => {
    const myFlowId = ++flowIdRef.current;
    try {
      const granted = await requestMicPermission();
      if (flowIdRef.current !== myFlowId) return;
      if (!granted) throw new Error('Microphone permission is required to speak your destination');

      // Not a fresh fetch — see getCurrentPosition()'s file header for why
      // that used to be here (and the wrong-city bug it caused). HomeScreen
      // only ever renders the mic button once locationStatus === 'ready',
      // so userLocation is guaranteed non-null on every real path into this
      // function; the throw below is a defensive backstop, not normal.
      if (!userLocation) throw new Error('Location not yet determined');
      const at = userLocation;
      if (flowIdRef.current !== myFlowId) return;
      clarifyOriginRef.current = at;

      // Fresh buffer every run: a leftover recorder from a take this flow is
      // superseding (see handleSayAgain) has already been cancelled there,
      // but guard here too in case anything else ever calls runRealFlow
      // while one is still active.
      activeRecorderRef.current?.cancel();
      const recorder = createRecorder();
      activeRecorderRef.current = recorder;
      await recorder.start();
      await new Promise((resolve) => setTimeout(resolve, REAL_RECORD_MS));
      const wav = await recorder.stop();
      if (activeRecorderRef.current === recorder) activeRecorderRef.current = null;
      if (flowIdRef.current !== myFlowId) return;
      const audioBase64 = await blobToBase64(wav);

      const understandBody: UnderstandRequest = { audioBase64, lang, at };
      const res = await fetch('/api/understand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(understandBody),
      });
      if (!res.ok) throw new Error(`/api/understand failed: ${res.status} ${await res.text()}`);
      const understanding = (await res.json()) as UnderstandResponse;
      if (flowIdRef.current !== myFlowId) return;

      dispatch({ type: 'TRANSCRIPT', text: understanding.transcript });

      if (understanding.destination) {
        await resolveAndStart(understanding.destination, at);
      } else if (understanding.clarify) {
        if (flowIdRef.current !== myFlowId) return;
        dispatch({ type: 'CLARIFY', question: understanding.clarify.question, candidates: understanding.clarify.candidates });
      } else {
        throw new Error('/api/understand returned neither a destination nor a clarify question');
      }
    } catch (err) {
      if (flowIdRef.current !== myFlowId) return;
      dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
    }
  }, [lang, resolveAndStart, userLocation]);

  // Speak the clarify question aloud, then wait — ClarifyScreen's own doc:
  // "speak the question aloud... and wait; do not just show text."
  // machine.ts's comment says the orchestration layer dispatches SAY_AGAIN
  // right after speaking so listening resumes automatically — true for the
  // plain "didn't catch that" case (no candidates), but NOT when there are
  // real tappable options: auto-restarting listening there would yank the
  // candidate buttons off screen before anyone could tap one, defeating
  // ClarifyScreen's whole reason to exist. So: auto-resume only when there's
  // nothing to tap; otherwise genuinely wait for onPick/onSayAgain.
  useEffect(() => {
    if (state.phase !== 'clarifying' || !state.clarifyQuestion) return;
    const hasCandidates = state.clarifyCandidates.length > 0;
    let cancelled = false;
    void speakTracked(state.clarifyQuestion, lang)
      .catch(() => {})
      .finally(() => {
        if (cancelled || hasCandidates) return;
        // Same fix as handleSayAgain below: SAY_AGAIN alone only flips the
        // UI to `listening`, it doesn't record anything — this auto-resume
        // has to actually kick off a fresh take too, or this comment's own
        // claim ("listening resumes automatically") stays false.
        dispatch({ type: 'SAY_AGAIN' });
        void (opts.demoMode ? runDemoFlow() : runRealFlow());
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.clarifyQuestion, state.clarifyCandidates, lang, speakTracked, opts.demoMode, runDemoFlow, runRealFlow]);

  const handleSpeak = useCallback(() => {
    // MUST be synchronous, first thing in the raw click handler — see
    // tts.ts's file header on why (iOS requires speechSynthesis be invoked
    // inside the actual user gesture, not a later microtask).
    providers.tts.primeForUserGesture();
    dispatch({ type: 'TAP_SPEAK' });
    void (opts.demoMode ? runDemoFlow() : runRealFlow());
  }, [providers.tts, opts.demoMode, runDemoFlow, runRealFlow]);

  // ⚠️ 2026-09-10: used to just dispatch SAY_AGAIN, which only flips the UI
  // to `listening` — machine.ts's reduce() has no side effect wired to that
  // event, so nothing actually restarted the mic. Now mirrors handleSpeak:
  // cancels any take still in flight (fresh buffer) and kicks off a real
  // recording; flowIdRef in runRealFlow/runDemoFlow stops the abandoned
  // take's eventual response from landing on top of this new one.
  const handleSayAgain = useCallback(() => {
    activeRecorderRef.current?.cancel();
    activeRecorderRef.current = null;
    // Same reasoning as handleSpeak: must run synchronously in the raw click
    // handler for iOS to accept the later speak() calls as user-gesture-primed.
    providers.tts.primeForUserGesture();
    dispatch({ type: 'SAY_AGAIN' });
    void (opts.demoMode ? runDemoFlow() : runRealFlow());
  }, [providers.tts, opts.demoMode, runDemoFlow, runRealFlow]);
  const handleReset = useCallback(() => dispatch({ type: 'RESET' }), []);
  const handleStartJourney = useCallback(() => {
    const journey = stateRef.current.journey;
    if (!journey) return;
    dispatch({ type: 'START_JOURNEY' });
    startSimulatedWalk(journey);
  }, [startSimulatedWalk]);

  const handleClarifyPick = useCallback(
    (place: Place) => {
      void (async () => {
        try {
          await resolveAndStart(place, clarifyOriginRef.current ?? DEMO_FIXTURE.origin);
        } catch (err) {
          dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
        }
      })();
    },
    [resolveAndStart],
  );

  const handleImLost = useCallback(() => {
    dispatch({ type: 'IM_LOST' });
    void (async () => {
      const journey = stateRef.current.journey;
      if (!journey) return;

      // DEMO_MODE's whole contract (Failure plan layer 3, DEVPLAN.md) is
      // ZERO network — /api/reanchor is a real OneMap/Gemini round trip, so
      // hitting it here would silently break that guarantee the one time a
      // judge taps "I'm lost" mid-demo. Canned reassurance instead, same
      // "keep the existing route/progress" shape as a real reanchor with no
      // re-route needed.
      if (opts.demoMode) {
        const demoLangKey = journey.lang === 'ms' ? 'ms' : 'zh';
        const book = demoLangKey === 'ms' ? ms : zh;
        await speakTracked(book.recalculating, journey.lang).catch(() => {});
        dispatch({ type: 'REANCHORED', journey: null });
        // ⚠️ REANCHORED with journey:null returns to `navigating` WITHOUT
        // touching locationRef — but the phase!==navigating cleanup effect
        // above already stopped and nulled it the moment IM_LOST fired.
        // Without an explicit restart here, tracking stays dead forever
        // (found live: the walk froze mid-route and never resumed).
        // SimulatedProvider.start() always resets to the path's beginning
        // (no resume-from-progress support — see journey/location.ts), so
        // this replays the already-walked portion instead of teleporting;
        // cosmetic only (currentStepIndex doesn't move until the walker
        // catches back up past it, then it jumps forward correctly) and,
        // unlike this quirk, GPS/manual modes resume with no replay at all.
        startSimulatedWalk(journey);
        return;
      }

      try {
        const at = await getCurrentPosition();
        const body: ReanchorRequest = { at, lang: journey.lang, destination: journey.destination };
        const res = await fetch('/api/reanchor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`/api/reanchor failed: ${res.status} ${await res.text()}`);
        const data = (await res.json()) as ReanchorResponse;
        await speakTracked(data.spokenText, journey.lang).catch(() => {});
        dispatch({ type: 'REANCHORED', journey: data.journey });
        // Same restart-required gap as the demo branch above — whichever
        // journey we end up tracking (the re-routed one, or the original if
        // no re-route was needed), the provider was already torn down by
        // IM_LOST and nothing else brings it back.
        startSimulatedWalk(data.journey ?? journey);
      } catch {
        // Server's own /api/reanchor doc: "reassuring the user beats it
        // failing outright." Mirror that here — REANCHORED with a null
        // journey keeps the existing route/progress and returns to
        // `navigating` instead of stranding the user in `lost` with no
        // dedicated screen.
        dispatch({ type: 'REANCHORED', journey: null });
        startSimulatedWalk(journey);
      }
    })();
  }, [opts.demoMode, speakTracked, startSimulatedWalk]);

  const handleChooseLang = useCallback((picked: Lang) => {
    writeStoredLang(picked);
    setLang(picked);
    setLangChosen(true);
  }, []);

  // HomeScreen's `.language` badge — a correction for a wrong initial pick,
  // not a settings menu (see HomeScreen.tsx's header for why this is safe:
  // it only ever renders where no journey is in progress). A straight
  // toggle is enough with exactly two selectable languages.
  const handleChangeLanguage = useCallback(() => {
    setLang((current) => {
      const next: Lang = current === 'ms' ? 'zh' : 'ms';
      writeStoredLang(next);
      return next;
    });
  }, []);

  if (judgeMode) {
    return (
      <JudgeView
        chosen={buildDemoScoredRoute(lang)}
        rejected={buildDemoRejected(lang)}
        landmarks={state.journey?.landmarks ?? (DEMO_FIXTURE.landmarks as Landmark[])}
        amenities={DEMO_FIXTURE.amenities as Poi[]}
        directDistanceM={haversineM(DEMO_FIXTURE.origin, DEMO_FIXTURE.destination.at)}
      />
    );
  }

  // Screen zero — see the file header and resolveInitialLang's doc for why
  // this exists. Checked after judgeMode (a judge doesn't need to pick a
  // language) and before the phase switch (every senior-facing screen below
  // needs a real, known lang).
  if (!langChosen) return <LanguageScreen onChoose={handleChooseLang} />;

  switch (state.phase) {
    case 'idle':
      return <HomeScreen lang={lang} onSpeak={handleSpeak} onChangeLanguage={handleChangeLanguage} demoMode={opts.demoMode} locationStatus={locationStatus} onRetryLocation={acquireLocation} locationLabel={locationLabel} />;

    case 'listening':
    case 'resolving':
      return <ListeningScreen lang={lang} thinking={state.phase === 'resolving'} onSayAgain={handleSayAgain} />;

    case 'clarifying':
      // Unreachable from the demo flow (buildDemoJourney never produces
      // ambiguity) — only the real flow (runRealFlow, via /api/understand)
      // ever dispatches CLARIFY.
      return (
        <ClarifyScreen
          lang={lang}
          question={state.clarifyQuestion ?? ''}
          candidates={state.clarifyCandidates}
          onPick={handleClarifyPick}
          onSayAgain={handleSayAgain}
        />
      );

    case 'ready':
      return state.journey ? <ConfirmationScreen journey={state.journey} lang={lang} onStart={handleStartJourney} onChange={handleReset} /> : <HomeScreen lang={lang} onSpeak={handleSpeak} onChangeLanguage={handleChangeLanguage} demoMode={opts.demoMode} locationStatus={locationStatus} onRetryLocation={acquireLocation} locationLabel={locationLabel} />;

    case 'navigating': {
      const step = state.journey?.steps[state.currentStepIndex];
      if (!state.journey || !step) return <HomeScreen lang={lang} onSpeak={handleSpeak} onChangeLanguage={handleChangeLanguage} demoMode={opts.demoMode} locationStatus={locationStatus} onRetryLocation={acquireLocation} locationLabel={locationLabel} />; // defensive — shouldn't happen
      // Resolved here, not in JourneyScreen — it already gets `step` and
      // this is the one place that also has `state.journey.landmarks` to
      // look it up against. Only used to refine the instruction icon; see
      // JourneyScreen's own resolveInstructionIcon for why it's optional.
      const landmark = state.journey.landmarks.find((l) => l.id === step.landmarkId);
      return (
        <JourneyScreen
          lang={lang}
          step={step}
          stepCount={state.journey.steps.length}
          onImLost={handleImLost}
          onRepeat={() => speakTracked(step.spokenText, lang).catch(() => {})}
          route={state.journey.route.candidate.polyline}
          landmark={landmark}
        />
      );
    }

    case 'arrived':
      return state.journey ? (
        <ArrivedScreen lang={lang} destination={state.journey.destination} onHome={handleReset} />
      ) : (
        <HomeScreen lang={lang} onSpeak={handleSpeak} onChangeLanguage={handleChangeLanguage} demoMode={opts.demoMode} locationStatus={locationStatus} onRetryLocation={acquireLocation} locationLabel={locationLabel} />
      );

    case 'error':
      // ⚠️ 2026-09-10: used to fall into the 'lost'/'planning' default below
      // (ListeningScreen thinking=true) — a silent mic-pulse spinner
      // indistinguishable from "still working," with no visible reason to
      // tap anything and no indication anything had failed at all. Recovers
      // via handleReset (RESET -> idle), not handleSayAgain — see
      // ErrorScreen.tsx's own header for why a genuine error shouldn't
      // auto-restart the mic straight back into the same failure.
      return <ErrorScreen lang={lang} onTryAgain={handleReset} />;

    default:
      // 'planning' (never set by reduce() — see machine.ts) and 'lost'
      // (genuinely "still figuring out where you are" — a real, transient
      // "thinking" state, not an error) land here. 'ready' and 'error' have
      // their own cases above and never reach this branch.
      return <ListeningScreen lang={lang} thinking={true} onSayAgain={handleSayAgain} />;
  }
}
