// OWNER: C (Journey experience) — do not edit unless you are the owner.
//
// The clarification loop is a FEATURE, not an error path — the brief asks for
// it to be demoed explicitly. Speak the question aloud in the user's language
// and wait; do not just show text.
//
// Question text comes from the phrase bank (src/phrases), NOT from the LLM —
// it has to come back instantly.

import type { Lang, Place } from '../../core/types';

export interface ClarifyScreenProps {
  lang: Lang;
  question: string;
  candidates: Place[];
  onPick: (place: Place) => void;
  onSayAgain: () => void;
}

export function ClarifyScreen(_props: ClarifyScreenProps) {
  return <div className="screen">TODO: ClarifyScreen</div>;
}
