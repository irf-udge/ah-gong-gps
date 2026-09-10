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
// ⚠️ 2026-09-10: the `.language` badge IS tappable, despite "no settings"
// above — deliberate, narrow exception, not a menu. LanguageScreen (screen
// zero) fixed "no way to switch language at all," but a wrong pick there
// still had zero in-app recovery — exactly the same escape-hatch problem,
// one level deeper. Safe to toggle immediately with no confirmation: this
// badge only ever renders here, and HomeScreen only renders when
// state.phase is 'idle' (or a defensive fallback for a missing journey), so
// there is never an in-progress journey underneath it to invalidate.
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
  onChangeLanguage: () => void;
  /** Demo mode always shows its own fixed "near AMK Hub" text — no real fix to show a judge testing indoors. */
  demoMode: boolean;
  /** Nearest building/block name from a real GPS fix. Null while unresolved or unavailable — real mode then shows no location line at all, rather than guessing. Ignored in demo mode. */
  locationLabel: string | null;
}

export function HomeScreen({ lang, onSpeak, onChangeLanguage, demoMode, locationLabel }: HomeScreenProps) {
  const book = lang === 'ms' ? ms : zh;
  const locationLine = demoMode
    ? (lang === 'ms' ? 'Anda berhampiran Blk 226, Ang Mo Kio' : '您在宏茂桥第226座附近')
    : locationLabel && (lang === 'ms' ? `Anda berhampiran ${locationLabel}` : `您在${locationLabel}附近`);
  return (
    <main className="screen home-screen">
      <header className="brand">
        <span>EZ Jalan</span>
        <button
          type="button"
          className="language"
          onClick={onChangeLanguage}
          aria-label="中文 / Bahasa Melayu — tap to switch language"
        >
          {lang === 'ms' ? 'Bahasa Melayu' : '中文'}
        </button>
      </header>
      <section className="home-copy"><p className="eyebrow">{lang === 'ms' ? 'Jalan dengan tenang' : '轻松出发'}</p><h1>{lang === 'ms' ? 'Ke mana anda mahu pergi?' : '您想去哪里？'}</h1>{locationLine && <p className="location-line">{locationLine}</p>}</section>
      <button type="button" className="mic-button" aria-label={book.tapToSpeak} onClick={onSpeak}><span className="mic-symbol">●</span><span>{lang === 'ms' ? 'Tekan dan cakap' : '按下，说出目的地'}</span></button>
      <p className="quick-destinations">AMK Hub　·　Wet market　·　Clinic</p>
    </main>
  );
}
