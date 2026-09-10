// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// Shown when state.phase === 'error' — genuinely something failed (a
// network call threw, mic permission was denied, ...). This used to fall
// through to the SAME fallback as "still working" (ListeningScreen with
// thinking=true): a silent mic-pulse spinner with no sign anything had gone
// wrong, and no visible reason to tap "say it again." "Say it again" itself
// already worked (SAY_AGAIN is a universal event handled before the phase
// switch in journey/machine.ts's reduce(), for every phase including
// 'error') — the bug was purely that nothing on screen told the user there
// was anything to escape from, so a real failure read as an unresponsive
// app with the only fix being a reload. CONTRACTS.md § 8: "Error tolerance
// everywhere... always offer say it again" — this screen IS that offer,
// made visible instead of invisible. Deliberately reuses book.notUnderstood
// rather than a new phrase: this app's whole error philosophy is "assume
// mis-transcription everywhere" (this file's own machine.ts header) — never
// surface a raw technical message (network error, permission denial, ...)
// to a low-literacy senior, just the same honest "didn't catch that, try
// again" framing used everywhere else.

import type { Lang } from '../../core/types';
import { ms, zh } from '../../phrases';
import { Icon } from '../components/Icon';

export interface ErrorScreenProps {
  lang: Lang;
  onSayAgain: () => void;
}

export function ErrorScreen({ lang, onSayAgain }: ErrorScreenProps) {
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
      <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onSayAgain}>
        {book.sayAgain}
      </button>
    </main>
  );
}
