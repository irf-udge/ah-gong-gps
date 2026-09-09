// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// The clarification loop is a FEATURE, not an error path — the brief asks for
// it to be demoed explicitly. Speak the question aloud in the user's language
// and wait; do not just show text.
//
// Question text comes from the phrase bank (src/phrases), NOT from the LLM —
// it has to come back instantly.

import type { Lang, Place } from '../../core/types';
import { ms, zh } from '../../phrases';

export interface ClarifyScreenProps {
  lang: Lang;
  question: string;
  candidates: Place[];
  onPick: (place: Place) => void;
  onSayAgain: () => void;
}

/**
 * `question` is SPOKEN aloud (not just shown) — that happens in ui/App.tsx
 * (a useEffect reacting to the `clarifying` phase, same pattern as every
 * other TTS call in this app), not here. This component only renders it.
 */
export function ClarifyScreen({ lang, question, candidates, onPick, onSayAgain }: ClarifyScreenProps) {
  const book = lang === 'ms' ? ms : zh;
  const hasCandidates = candidates.length > 0;

  return (
    <main className="screen" style={{ justifyContent: 'space-between' }}>
      <section aria-live="polite" style={{ display: 'flex', alignItems: 'center', flex: hasCandidates ? undefined : 1 }}>
        <p className="step-text" style={{ margin: 0 }}>
          {question}
        </p>
      </section>

      {hasCandidates && (
        <nav aria-label={lang === 'ms' ? 'Pilihan' : '选项'} style={{ display: 'grid', gap: 'var(--gap)' }}>
          {candidates.map((place) => (
            <button key={place.id} type="button" className="btn-primary" onClick={() => onPick(place)}>
              {place.name}
            </button>
          ))}
        </nav>
      )}

      <button type="button" className={hasCandidates ? 'btn-danger' : 'btn-primary'} style={{ width: '100%' }} onClick={onSayAgain}>
        {book.sayAgain}
      </button>
    </main>
  );
}
