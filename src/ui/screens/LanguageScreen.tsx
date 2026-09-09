// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// Screen zero. Shown once, before HomeScreen, until a language is chosen —
// see ui/App.tsx's header for why: arriving at the plain URL used to
// default silently to zh with no way to switch, a dead end for a Malay
// speaker, not a minor inconvenience. Deliberately NO prompt text of any
// kind — any prompt has to be written in SOME script, which is exactly the
// problem being solved. Two equal-weight buttons, each labelled only in its
// own script, nothing else on screen.

import type { Lang } from '../../core/types';

export interface LanguageScreenProps {
  onChoose: (lang: Lang) => void;
}

export function LanguageScreen({ onChoose }: LanguageScreenProps) {
  return (
    <main className="screen language-screen">
      <div className="screen-actions">
        <button type="button" className="btn-primary" onClick={() => onChoose('zh')}>
          中文
        </button>
        <button type="button" className="btn-primary" onClick={() => onChoose('ms')}>
          Bahasa Melayu
        </button>
      </div>
    </main>
  );
}
