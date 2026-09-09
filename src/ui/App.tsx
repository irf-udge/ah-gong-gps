// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// The screen router AND the top-level orchestration: owns the JourneyState
// reducer, builds the providers, and drives the DEMO-MODE pipeline end to
// end (tap -> canned transcript -> buildDemoJourney -> speak each step ->
// simulated walk -> arrive). A router with nothing wiring state transitions
// to it wouldn't actually route anywhere, so this file owns both.
//
// ⚠️ CP1 SCOPE: only the fixture/demo path is wired here. Real STT/OneMap
// orchestration (non-demo `runDemoFlow` equivalent) is a later checkpoint —
// see DEVPLAN.md's CP2/CP3 for Irfan's side of that. Nothing here should be
// mistaken for the real pipeline; `buildDemoJourney` bypasses
// core/comfort.ts and server/llm.ts entirely on purpose (see its own doc).
//
// Screen map: idle -> HomeScreen, listening/resolving -> ListeningScreen,
// clarifying -> ClarifyScreen, navigating -> JourneyScreen, arrived ->
// ArrivedScreen, ?judge=1 -> JudgeView (checked first, independent of
// phase). planning/ready/lost/error don't have dedicated screens yet
// (CP2/CP3/CP4) — they fall back to ListeningScreen rather than a blank one.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { haversineM } from '../core/geo';
import type { Journey, Lang, Landmark, Position } from '../core/types';
import { GEOFENCE_RADIUS_M } from '../journey/location';
import { initialState, reduce, shouldAdvance } from '../journey/machine';
import { createLocationProvider, createProviders, readProviderOptions } from '../providers';
import { buildDemoJourney, buildDemoRejected, buildDemoScoredRoute, DEMO_FIXTURE } from '../providers/fixtures';
import type { LocationProvider } from '../providers/types';
import { requestMicPermission } from '../audio/capture';
import { ArrivedScreen } from './screens/ArrivedScreen';
import { ClarifyScreen } from './screens/ClarifyScreen';
import { HomeScreen } from './screens/HomeScreen';
import { JourneyScreen } from './screens/JourneyScreen';
import { JudgeView } from './screens/JudgeView';
import { ListeningScreen } from './screens/ListeningScreen';

/** Demo-mode pacing: how long "listening" shows before the canned transcript "arrives". Long enough to read, short enough not to feel broken. */
const DEMO_LISTEN_MS = 1200;
/**
 * Playback speed for the simulated walk. NOT SIM_SPEED_MPS's realistic 1x —
 * that's ~12 minutes for a real ~700m route, found live wiring this up.
 * 20x (verified safe against GEOFENCE_RADIUS_M/TICK_MS earlier this session)
 * walks a ~700m route in well under a minute — long enough to actually watch
 * steps advance on stage, not so long it stalls the demo.
 */
const DEMO_WALK_SPEED_MPS = 20;

/**
 * Which language the DEMO runs in — picked once, upfront, via `?lang=ms`
 * (default `zh`). This is deliberately NOT a UI toggle (that would violate
 * "one action per screen") and NOT journey/machine.ts's resolveLang (which
 * only has something to read once a journey already exists — nothing tells
 * it which language to LISTEN in beforehand). Fine for CP1: real language
 * detection from actual speech is a later checkpoint, not a fixture concern.
 */
function resolveDemoLang(): Lang {
  const params = new URLSearchParams(window.location.search);
  return params.get('lang') === 'ms' ? 'ms' : 'zh';
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const opts = useMemo(() => readProviderOptions(), []);
  const providers = useMemo(() => createProviders(opts), [opts]);
  const lang = useMemo(() => resolveDemoLang(), []);
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

  // Speak the current step whenever navigation enters it — fires on the
  // initial ready->navigating transition too, since state.phase is one of
  // the deps and currentStepIndex is already 0 by then (set by RESOLVED).
  useEffect(() => {
    if (state.phase !== 'navigating' || !state.journey) return;
    const step = state.journey.steps[state.currentStepIndex];
    if (!step) return;
    providers.tts.speak(step.spokenText, state.journey.lang).catch(() => {
      // Speech failing shouldn't block navigation — the visible step text is still there.
    });
  }, [state.phase, state.currentStepIndex, state.journey, providers.tts]);

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
    try {
      // Best-effort only — demo mode never transcribes real audio, so a
      // denial (or no mic at all) must not block the fixture-only path.
      void requestMicPermission().catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, DEMO_LISTEN_MS));
      const demoLangKey = lang === 'ms' ? 'ms' : 'zh';
      dispatch({ type: 'TRANSCRIPT', text: DEMO_FIXTURE.transcript[demoLangKey] });

      const journey = buildDemoJourney(lang);
      dispatch({ type: 'RESOLVED', journey });
      dispatch({ type: 'START_JOURNEY' });
      startSimulatedWalk(journey);
    } catch (err) {
      dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
    }
  }, [lang, startSimulatedWalk]);

  const handleSpeak = useCallback(() => {
    // MUST be synchronous, first thing in the raw click handler — see
    // tts.ts's file header on why (iOS requires speechSynthesis be invoked
    // inside the actual user gesture, not a later microtask).
    providers.tts.primeForUserGesture();
    dispatch({ type: 'TAP_SPEAK' });
    void runDemoFlow();
  }, [providers.tts, runDemoFlow]);

  const handleSayAgain = useCallback(() => dispatch({ type: 'SAY_AGAIN' }), []);
  const handleReset = useCallback(() => dispatch({ type: 'RESET' }), []);

  if (judgeMode) {
    return (
      <JudgeView
        chosen={buildDemoScoredRoute(lang)}
        rejected={buildDemoRejected(lang)}
        landmarks={state.journey?.landmarks ?? (DEMO_FIXTURE.landmarks as Landmark[])}
      />
    );
  }

  switch (state.phase) {
    case 'idle':
      return <HomeScreen lang={lang} onSpeak={handleSpeak} />;

    case 'listening':
    case 'resolving':
      return <ListeningScreen lang={lang} thinking={state.phase === 'resolving'} onSayAgain={handleSayAgain} />;

    case 'clarifying':
      return (
        <ClarifyScreen
          lang={lang}
          question={state.clarifyQuestion ?? ''}
          candidates={[]}
          // No real destination-resolution logic exists yet (this phase is
          // unreachable from the current demo flow — buildDemoJourney never
          // produces ambiguity) — a safe placeholder until that lands.
          onPick={handleSayAgain}
          onSayAgain={handleSayAgain}
        />
      );

    case 'navigating': {
      const step = state.journey?.steps[state.currentStepIndex];
      if (!state.journey || !step) return <HomeScreen lang={lang} onSpeak={handleSpeak} />; // defensive — shouldn't happen
      return (
        <JourneyScreen
          lang={lang}
          step={step}
          stepCount={state.journey.steps.length}
          onImLost={() => dispatch({ type: 'IM_LOST' })}
          onRepeat={() => providers.tts.speak(step.spokenText, lang).catch(() => {})}
        />
      );
    }

    case 'arrived':
      return state.journey ? (
        <ArrivedScreen lang={lang} destination={state.journey.destination} onHome={handleReset} />
      ) : (
        <HomeScreen lang={lang} onSpeak={handleSpeak} />
      );

    default:
      // 'planning' (never set by reduce() — see machine.ts), 'ready'
      // (auto-advances to 'navigating' in the same tick, never rendered),
      // 'lost' and 'error' (CP4/no dedicated screen yet) all land here.
      return <ListeningScreen lang={lang} thinking={true} onSayAgain={handleSayAgain} />;
  }
}
