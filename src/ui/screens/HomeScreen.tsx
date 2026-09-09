// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// The whole home screen is ONE BIG BUTTON. Nothing else competes with it.
// The first tap must do three things at once:
//   1. request mic permission (audio/capture.requestMicPermission)
//   2. prime TTS for iOS (tts.primeForUserGesture — it will not speak later
//      unless speechSynthesis was first invoked inside a user gesture)
//   3. start recording
//
// No map. No menu. No settings.
//
// ⚠️ This component only owns step 2 — `onSpeak` is called SYNCHRONOUSLY from
// the raw click, and ui/App.tsx's handler primes TTS as the very first thing
// inside it (must happen before any `await`, see tts.ts's file header).
// Steps 1 and 3 are orchestrated by App.tsx too, not here — in DEMO_MODE
// specifically, mic permission is still requested best-effort (matching real
// device setup) but nothing is actually recorded, since the fixture path
// never transcribes real audio. This screen stays a plain presentational
// button; it doesn't know or care which mode is active.

import type { Lang } from '../../core/types';
import { ms, zh } from '../../phrases';

export interface HomeScreenProps {
  lang: Lang;
  onSpeak: () => void;
}

export function HomeScreen({ lang, onSpeak }: HomeScreenProps) {
  const book = lang === 'ms' ? ms : zh;
  return (
    <main className="screen" style={{ justifyContent: 'stretch' }}>
      <button type="button" className="btn-primary" style={{ flex: 1, fontSize: 'var(--fs-step)' }} onClick={onSpeak}>
        {book.tapToSpeak}
      </button>
    </main>
  );
}
