// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// ⚠️ ONE STEP AT A TIME. Never render a list of upcoming turns — that is
// working-memory load, and working memory is exactly what declines with age.
// The brief is explicit about this; it is the easiest rule to break by accident.
//
// Layout: current step in --fs-step, an always-visible "I'm lost" button.
//
// ⚠️ 2026-09-10: CONTRACTS.md § 8's "no map" rule was written against a real
// interactive map (pan/zoom/street detail) — the actual barrier the product
// exists to remove. `RoutePreview` here is a deliberate, narrower exception:
// a static schematic line (start/end dots on the route's shape only, no
// tiles, no interaction) shown alongside — never instead of — the single
// current-step instruction above. Still no list of upcoming turns anywhere
// on this screen.

import type { Landmark, Lang, Step } from '../../core/types';
import { ms, zh } from '../../phrases';
import { RoutePreview } from '../components/RoutePreview';
import { Icon, type IconName } from '../components/Icon';
import { Trail } from '../components/Trail';

export interface JourneyScreenProps {
  lang: Lang;
  step: Step;
  /** For a progress dot row only — do NOT render the other steps' text. */
  stepCount: number;
  onImLost: () => void;
  onRepeat: () => void;
  route?: import('../../core/types').LatLng[];
  /** The real landmark this step anchors to (Journey.landmarks, looked up by step.landmarkId) — used ONLY to refine the icon when its category is unambiguous. Optional/defensive: the icon still degrades to a correct directional one if this is missing. */
  landmark?: Landmark;
  onPause?: () => void;
  paused?: boolean;
}

/**
 * ⚠️ 2026-09-10: this used to be `step.index === 0 ? 'bus' : step.index === 1
 * ? 'store' : 'coffee'` — picked by POSITION IN THE ROUTE, not by what the
 * step actually says. A right turn on step 2 got a coffee cup; a landmark
 * that was a hospital got a shopfront. For a low-literacy user the icon can
 * carry MORE weight than the text, so a wrong one actively misleads rather
 * than just looking odd.
 *
 * `step.action` decides it for any real turn/crossing/arrival — that IS the
 * instruction, it's never wrong, and showing the landmark's icon instead
 * would wrongly imply the landmark is what to do ("turn right at the bus
 * stop" is an instruction to turn right, not an instruction about a bus).
 * The one exception is `'start'`: the very first step has no turn to depict
 * at all ("walk to X"), so there the landmark's own category — when
 * confident — is the more useful icon than a generic "head this way" arrow.
 * Confident is deliberately narrow: bus_stop and hawker are the only kinds
 * with an unambiguous existing icon (a bus shelter unmistakably reads as
 * "bus stop," a hawker centre as "food"). Every other kind (bench, toilet,
 * lift, community, park, eldercare, hospital, pharmacy, polyclinic, generic
 * building/block) has no confident dedicated icon here — rather than force
 * one of the existing icons onto a landmark it doesn't actually depict
 * (exactly the bug this replaces), those fall through to the neutral
 * directional icon, same as a landmark-less `start` step.
 */
function resolveInstructionIcon(step: Step, landmark: Landmark | undefined): IconName {
  switch (step.action) {
    case 'arrive':
      return 'check';
    case 'left':
      return 'arrow-left';
    case 'right':
      return 'arrow-right';
    case 'cross':
      return 'cross';
    case 'start':
      if (landmark?.kind === 'bus_stop') return 'bus';
      if (landmark?.kind === 'hawker') return 'coffee';
      return 'arrow-up';
    case 'straight':
    default:
      return 'arrow-up';
  }
}

export function JourneyScreen({ lang, step, stepCount, onImLost, onRepeat, route, landmark, onPause, paused }: JourneyScreenProps) {
  const book = lang === 'ms' ? ms : zh;
  const lostLabel = lang === 'ms' ? 'Saya sesat' : '我迷路了';
  const currentStep = Math.min(step.index + 1, stepCount);
  const instructionIcon = resolveInstructionIcon(step, landmark);

  return (
    <main className="screen" style={{ justifyContent: 'space-between' }}>
      <Trail count={stepCount} current={currentStep - 1} />

      <section aria-live="polite" style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
        <div className="instruction-icon"><Icon name={instructionIcon} size={56} /></div>
        <p className="step-text" style={{ margin: 0, width: '100%' }}>
          {step.displayText}
        </p>
      </section>
      {route && <RoutePreview points={route} />}

      <nav aria-label={lang === 'ms' ? 'Pilihan perjalanan' : '行程选项'} style={{ display: 'grid', gap: 'var(--gap)' }}>
        <button type="button" className="btn-primary" onClick={onRepeat}>
          {book.sayAgain}
        </button>
        {onPause && <button type="button" className="btn-secondary" onClick={onPause}>{paused ? 'Resume' : 'Pause'}</button>}
        <button type="button" className="btn-danger" onClick={onImLost}>
          {lostLabel}
        </button>
      </nav>
    </main>
  );
}
