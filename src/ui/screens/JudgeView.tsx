// OWNER: C (Journey experience) — do not edit unless you are the owner.
//
// Reached via ?judge=1. NEVER shown to the senior — this is the machinery,
// and the senior-facing product is defined by hiding exactly this.
//
// It is also the pitch. Show:
//   · the chosen route AND the rejected candidates, side by side
//   · each one's ComfortScore broken out (shelter %, benches, toilets, gap)
//   · live comfort weight sliders — "watch what happens when I tell it this
//     user can't take the sun" is the strongest live moment in the demo
//   · the landmark set handed to the LLM, and any validation violations caught
//
// This is where a map IS allowed.

import type { ScoredRoute, Landmark } from '../../core/types';

export interface JudgeViewProps {
  chosen: ScoredRoute;
  rejected: ScoredRoute[];
  landmarks: Landmark[];
}

export function JudgeView(_props: JudgeViewProps) {
  return <div className="screen debug">TODO: JudgeView — routes, scores, weights</div>;
}
