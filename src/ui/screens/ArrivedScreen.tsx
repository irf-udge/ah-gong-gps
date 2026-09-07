// OWNER: C (Journey experience) — do not edit unless you are the owner.

import type { Lang, Place } from '../../core/types';

export interface ArrivedScreenProps {
  lang: Lang;
  destination: Place;
  onHome: () => void;
}

export function ArrivedScreen(_props: ArrivedScreenProps) {
  return <div className="screen">TODO: ArrivedScreen</div>;
}
