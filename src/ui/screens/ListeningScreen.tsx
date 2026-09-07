// OWNER: C (Journey experience) — do not edit unless you are the owner.
//
// Shown while capturing and while waiting on MERaLiON. Needs a visible "still
// working" state — a silent screen reads as broken to a 70-year-old, and the
// round trip can take a couple of seconds.
//
// Always offer "say it again". Assume mis-transcription everywhere.

import type { Lang } from '../../core/types';

export interface ListeningScreenProps {
  lang: Lang;
  /** true once we've stopped recording and are waiting on transcription. */
  thinking: boolean;
  onSayAgain: () => void;
}

export function ListeningScreen(_props: ListeningScreenProps) {
  return <div className="screen">TODO: ListeningScreen</div>;
}
