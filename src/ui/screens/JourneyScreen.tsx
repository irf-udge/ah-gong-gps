// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// ⚠️ ONE STEP AT A TIME. Never render a list of upcoming turns — that is
// working-memory load, and working memory is exactly what declines with age.
// The brief is explicit about this; it is the easiest rule to break by accident.
//
// Layout: current step in --fs-step, an always-visible "I'm lost" button, and
// nothing else. No map on this screen.

import type { Lang, Step } from '../../core/types';
import { ms, zh } from '../../phrases';

export interface JourneyScreenProps {
  lang: Lang;
  step: Step;
  /** For a progress dot row only — do NOT render the other steps' text. */
  stepCount: number;
  onImLost: () => void;
  onRepeat: () => void;
}

export function JourneyScreen({ lang, step, stepCount, onImLost, onRepeat }: JourneyScreenProps) {
  const book = lang === 'ms' ? ms : zh;
  const lostLabel = lang === 'ms' ? 'Saya sesat' : '我迷路了';
  const currentStep = Math.min(step.index + 1, stepCount);

  return (
    <main className="screen" style={{ justifyContent: 'space-between' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }} aria-label={`${currentStep} of ${stepCount}`}>
          {currentStep} / {stepCount}
        </span>
        <span style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-muted)' }} aria-hidden="true">
          {lang === 'ms' ? 'Langkah' : '步骤'}
        </span>
      </header>

      <section aria-live="polite" style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
        <p className="step-text" style={{ margin: 0, width: '100%' }}>
          {step.displayText}
        </p>
      </section>

      <nav aria-label={lang === 'ms' ? 'Pilihan perjalanan' : '行程选项'} style={{ display: 'grid', gap: 'var(--gap)' }}>
        <button type="button" className="btn-primary" onClick={onRepeat}>
          {book.sayAgain}
        </button>
        <button type="button" className="btn-danger" onClick={onImLost}>
          {lostLabel}
        </button>
      </nav>
    </main>
  );
}
