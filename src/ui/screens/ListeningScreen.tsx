// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// Shown while capturing and while waiting on MERaLiON. Needs a visible "still
// working" state — a silent screen reads as broken to a 70-year-old, and the
// round trip can take a couple of seconds.
//
// Always offer "say it again". Assume mis-transcription everywhere.

import type { Lang } from '../../core/types';
import { ms, zh } from '../../phrases';

export interface ListeningScreenProps {
  lang: Lang;
  /** true once we've stopped recording and are waiting on transcription. */
  thinking: boolean;
  onSayAgain: () => void;
}

export function ListeningScreen({ lang, thinking, onSayAgain }: ListeningScreenProps) {
  const book = lang === 'ms' ? ms : zh;

  return (
    <main className="screen" style={{ justifyContent: 'space-between', alignItems: 'center', textAlign: 'center' }}>
      <div aria-hidden="true" />
      <section aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--gap)' }}>
        <div className="pulse-dot" aria-hidden="true" />
        <p className="step-text" style={{ margin: 0 }}>
          {thinking ? book.thinking : book.listening}
        </p>
      </section>
      <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onSayAgain}>
        {book.sayAgain}
      </button>
    </main>
  );
}
