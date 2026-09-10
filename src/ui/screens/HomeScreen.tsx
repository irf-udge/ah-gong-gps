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
//
// ⚠️ 2026-09-10: a REAL visitor at Singapore Institute of Management asked
// for directions to Clementi Mall and got routed from Ang Mo Kio — 189
// minutes away. App.tsx's old per-tap GPS fetch had a 4s timeout and, on
// any failure, silently substituted the AMK demo fixture as if it were the
// user's real position, so a slow/denied fix produced a real, wrong route
// instead of an error. Fix: the mic button (and the rest of "one big
// button") now stays HIDDEN until App.tsx has a confirmed real fix
// (`locationStatus === 'ready'`) — see the `locating`/`error` branches
// below. Demo mode is the one exception: it never had this bug (it never
// calls real geolocation at all), so it keeps showing the button instantly.

import type { Lang } from '../../core/types';
import { ms, zh } from '../../phrases';
import { Icon } from '../components/Icon';

export type LocationStatus = 'locating' | 'ready' | 'error';

export interface HomeScreenProps {
  lang: Lang;
  onSpeak: () => void;
  onChangeLanguage: () => void;
  /** Demo mode always shows its own fixed "near AMK Hub" text and skips the location gate entirely — no real fix to show a judge testing indoors. */
  demoMode: boolean;
  /** Ignored in demo mode (always treated as 'ready'). Gates the mic button — see file header. */
  locationStatus: LocationStatus;
  /** Retry after 'error'. Ignored in demo mode. */
  onRetryLocation: () => void;
  /** Nearest building/block name from the real GPS fix. Null when there's no landmark/building nearby to identify the place (or the fix itself is still pending/failed) — real mode then shows no location line at all, rather than guessing. Ignored in demo mode. */
  locationLabel: string | null;
}

export function HomeScreen({ lang, onSpeak, onChangeLanguage, demoMode, locationStatus, onRetryLocation, locationLabel }: HomeScreenProps) {
  const book = lang === 'ms' ? ms : zh;
  const locationLine = demoMode
    ? (lang === 'ms' ? 'Anda berhampiran Blk 226, Ang Mo Kio' : '您在宏茂桥第226座附近')
    : locationLabel && (lang === 'ms' ? `Anda berhampiran ${locationLabel}` : `您在${locationLabel}附近`);
  const ready = demoMode || locationStatus === 'ready';
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
      {ready ? (
        <>
          <button type="button" className="mic-button" aria-label={book.tapToSpeak} onClick={onSpeak}><span className="mic-symbol">●</span><span>{lang === 'ms' ? 'Tekan dan cakap' : '按下，说出目的地'}</span></button>
          <p className="quick-destinations">AMK Hub　·　Wet market　·　Clinic</p>
        </>
      ) : locationStatus === 'locating' ? (
        <section aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--gap)' }}>
          <div className="pulse-dot" aria-hidden="true"><Icon name="pin" size={26} /></div>
          <p className="step-text" style={{ margin: 0, textAlign: 'center' }}>{book.determiningLocation}</p>
        </section>
      ) : (
        <section aria-live="assertive" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--gap)' }}>
          <p className="step-text" style={{ margin: 0, textAlign: 'center' }}>{book.locationUnavailable}</p>
          <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onRetryLocation}>{book.tryAgain}</button>
        </section>
      )}
    </main>
  );
}
