// OWNER: Lija (Journey experience) — do not edit unless you are the owner.

import type { Lang, Place } from '../../core/types';
import { ms, zh } from '../../phrases';

export interface ArrivedScreenProps {
  lang: Lang;
  destination: Place;
  onHome: () => void;
}

export function ArrivedScreen({ lang, destination, onHome }: ArrivedScreenProps) {
  const book = lang === 'ms' ? ms : zh;

  return (
    <main className="screen" style={{ justifyContent: 'space-between', alignItems: 'center', textAlign: 'center' }}>
      <div aria-hidden="true" />
      <section aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--gap)' }}>
        <p className="step-text" style={{ margin: 0, color: 'var(--ok)' }}>
          {book.arrived}
        </p>
        {/* destination.name is emitted verbatim, same rule as everywhere else — see CONTRACTS.md § Validation */}
        <p style={{ margin: 0, fontSize: 'var(--fs-lg)', color: 'var(--fg-muted)' }}>{destination.name}</p>
      </section>
      <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onHome}>
        {book.goHome}
      </button>
    </main>
  );
}
