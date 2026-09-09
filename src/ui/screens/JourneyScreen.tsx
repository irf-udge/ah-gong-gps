// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// ⚠️ ONE STEP AT A TIME. Never render a list of upcoming turns — that is
// working-memory load, and working memory is exactly what declines with age.
// The brief is explicit about this; it is the easiest rule to break by accident.
//
// Layout: current step in --fs-step, an always-visible "I'm lost" button, and
// nothing else. No map on this screen.

import type { Lang, Step } from '../../core/types';

export interface JourneyScreenProps {
  lang: Lang;
  step: Step;
  /** For a progress dot row only — do NOT render the other steps' text. */
  stepCount: number;
  onImLost: () => void;
  onRepeat: () => void;
}

export function JourneyScreen(_props: JourneyScreenProps) {
  return <div className="screen">TODO: JourneyScreen — ONE step only</div>;
}
