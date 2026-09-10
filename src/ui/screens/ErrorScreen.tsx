// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// Shown when state.phase === 'error' — genuinely something failed (a
// network call threw, mic permission was denied, ...). This used to fall
// through to the SAME fallback as "still working" (ListeningScreen with
// thinking=true): a silent mic-pulse spinner with no sign anything had gone
// wrong, and no visible reason to tap anything. CONTRACTS.md § 8: "Error
// tolerance everywhere" — this screen is that: a clearly-labelled failure
// state with a real way out. Deliberately reuses book.notUnderstood rather
// than a new phrase: this app's whole error philosophy is "assume
// mis-transcription everywhere" (machine.ts's own header) — never surface a
// raw technical message (network error, permission denial, ...) to a
// low-literacy senior, just the same honest "didn't catch that" framing used
// everywhere else.
//
// ⚠️ 2026-09-10: the button used to be "say it again" (SAY_AGAIN — re-listen
// immediately, straight back into a live mic recording). Changed to "Try
// Again" (RESET — back to the idle/home screen) instead: from a genuine
// error (as opposed to ListeningScreen's own onSayAgain, used for an honest
// "didn't catch that" with nothing actually broken), auto-restarting the mic
// can walk straight back into the same failure with no chance to fix
// whatever caused it (e.g. a denied mic permission needs the OS-level
// prompt/settings addressed first, not another getUserMedia call) — RESET
// gives the user a stable, known-good screen to act from instead.

import type { Lang } from '../../core/types';
import { ms, zh } from '../../phrases';
import { Icon } from '../components/Icon';

export interface ErrorScreenProps {
  lang: Lang;
  onTryAgain: () => void;
}

export function ErrorScreen({ lang, onTryAgain }: ErrorScreenProps) {
  const book = lang === 'ms' ? ms : zh;

  return (
    <main className="screen" style={{ justifyContent: 'space-between', alignItems: 'center', textAlign: 'center' }}>
      <div aria-hidden="true" />
      <section aria-live="assertive" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--gap)' }}>
        <div className="error-icon" aria-hidden="true">
          <Icon name="alert" size={56} />
        </div>
        <p className="step-text" style={{ margin: 0 }}>
          {book.notUnderstood}
        </p>
      </section>
      <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onTryAgain}>
        {book.tryAgain}
      </button>
    </main>
  );
}
