// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// THE SAFETY GATE. A hallucinated landmark leaves a senior standing at a
// junction looking for a building that does not exist — worse than no app.
//
// Defence in depth:
//   1. The LLM's `landmark_id` field is a per-request ENUM of this route's real
//      ids, so the schema itself cannot express an invented landmark.
//   2. validateSteps() re-checks every id against the supplied set anyway.
//   3. A proper-noun scan catches invented names AND free translation of real
//      ones (the subtler failure — "NTUC" becoming an invented Chinese name).
//   4. On second failure, templateSteps() produces steps that are safe by
//      construction.
//
// NOTHING IS EVER SPOKEN THAT HAS NOT PASSED validateSteps().

import type { Action, Lang, Landmark, Manoeuvre, Step, ValidationResult, Violation } from './types';
import { haversineM } from './geo';
import { localisedName } from './landmarks';
import { fill, ms, zh, type PhraseBook } from '../phrases';

/**
 * Generic words that may appear in spoken text without being traceable to a
 * landmark — "block", "lift", "MRT", etc. Anything Latin-script and NOT in the
 * lexicon or this allowlist is treated as an invented proper noun.
 */
export const GENERIC_ALLOWLIST: readonly string[] = [
  'block',
  'blk',
  'mrt',
  'lrt',
  'hdb',
  'ntuc',
  'lift',
  'bus',
  'stop',
];

/** Latin-script word tokens (must start with a letter — bare numbers like a distance are not proper nouns). */
function tokenizeLatin(text: string): { token: string; start: number }[] {
  const out: { token: string; start: number }[] = [];
  const re = /[A-Za-z][A-Za-z0-9]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ token: m[0], start: m.index });
  }
  return out;
}

/** Every token the model is permitted to emit, drawn from the real landmarks. */
export function buildLexicon(landmarks: readonly Landmark[]): Set<string> {
  const lexicon = new Set<string>();
  for (const l of landmarks) {
    for (const name of [l.name, l.nameZh, l.nameMs]) {
      if (!name) continue;
      for (const { token } of tokenizeLatin(name)) lexicon.add(token.toLowerCase());
    }
  }
  return lexicon;
}

function isSentenceInitial(text: string, start: number): boolean {
  const before = text.slice(0, start).trimEnd();
  return before === '' || /[.!?。！？]$/.test(before);
}

/**
 * Latin-script tokens in `text` that aren't covered by `allowedLower`
 * (lexicon ∪ GENERIC_ALLOWLIST, already lowercased).
 *
 * ⚠️ LANGUAGE-DEPENDENT, deliberately. For `zh`: ANY Latin-script token is
 * suspect — ordinary Mandarin text has none at all, so one appearing is
 * either a real proper noun (caught by the lexicon) or invented. For `ms`:
 * Malay is ITSELF written in Latin script, so "any Latin token" would flag
 * nearly every ordinary word in the sentence — verified against the real
 * fixture, "Berjalan ke Pasar Blok 226H." is almost entirely Latin tokens
 * that are just normal Malay, not proper nouns. Only a token that LOOKS like
 * a proper noun — capitalized, and not simply the sentence-initial word
 * (ordinary grammatical capitalization, not a name) — is treated as suspect
 * for `ms`.
 */
function findInventedTokens(text: string, lang: Lang, allowedLower: ReadonlySet<string>): string[] {
  const invented: string[] = [];
  for (const { token, start } of tokenizeLatin(text)) {
    if (allowedLower.has(token.toLowerCase())) continue;
    if (lang === 'ms' && !(/[A-Z]/.test(token) && !isSentenceInitial(text, start))) continue;
    invented.push(token);
  }
  return invented;
}

/**
 * Returns ok:false with every violation found — do not early-return on the
 * first one, the retry prompt is much more effective when it sees them all.
 *
 * ⚠️ `lang` isn't in the original stub signature — added because the
 * proper-noun scan is language-dependent (see findInventedTokens): without
 * it there is no way to tell "AMK Hub kept verbatim in Chinese" (fine) apart
 * from "Malay written in Latin script" (also fine, but every naive
 * Latin-token check would flag), and validateSteps() has no other source for
 * which language `steps` is in — Step itself carries no lang field.
 */
export function validateSteps(
  steps: readonly Step[],
  landmarks: readonly Landmark[],
  expectedStepCount: number,
  lang: Lang,
): ValidationResult {
  const violations: Violation[] = [];

  if (steps.length !== expectedStepCount) {
    violations.push({
      kind: 'step_count_mismatch',
      detail: `expected ${expectedStepCount} steps, got ${steps.length}`,
    });
  }

  const landmarkIds = new Set(landmarks.map((l) => l.id));
  const allowedLower = new Set([...buildLexicon(landmarks), ...GENERIC_ALLOWLIST.map((w) => w.toLowerCase())]);

  for (const step of steps) {
    if (!landmarkIds.has(step.landmarkId)) {
      violations.push({
        kind: 'unknown_landmark',
        detail: `landmark_id "${step.landmarkId}" is not in the supplied set`,
        stepIndex: step.index,
      });
    }

    if (step.spokenText.trim() === '') {
      violations.push({ kind: 'empty_spoken_text', detail: 'spokenText is empty', stepIndex: step.index });
    }

    for (const field of ['spokenText', 'displayText'] as const) {
      for (const token of findInventedTokens(step[field], lang, allowedLower)) {
        violations.push({
          kind: 'invented_proper_noun',
          detail: `"${token}" in ${field} is not a known landmark token or generic word`,
          stepIndex: step.index,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function phraseBookFor(lang: Lang): PhraseBook {
  return lang === 'ms' ? ms : zh;
}

/** zh uses a full-width comma; ms (and anything else) reads better with a plain one. */
function clauseSeparator(lang: Lang): string {
  return lang === 'zh' ? '，' : ', ';
}

/**
 * No-op on CJK text (no case concept); on Latin text, undoes sentence-initial
 * capitalization for mid-sentence reuse. Exported — server/index.ts's
 * `/api/reanchor` composes `recalculating` (also written capitalized, for
 * the same "also spoken standalone" reason as `arrived` below) as a second
 * clause and needs the identical fix.
 */
export function lowercaseFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

/**
 * ⚠️ `book.arrived` ("Anda sudah sampai" in ms) is written capitalized
 * because it's ALSO spoken standalone elsewhere (ui/App.tsx's arrival
 * effect) — reused here as the second half of a joined sentence, it needs
 * lowercasing or it reads as (and, caught live: gets flagged by
 * validateSteps as) a mid-sentence proper noun. `thenStraight`/
 * `thenTurnLeft`/`thenTurnRight` don't need this — they're already written
 * lowercase in the phrase book, since they were never meant to stand alone.
 */
function composeTemplateText(action: Action, landmarkName: string, lang: Lang): string {
  const book = phraseBookFor(lang);
  const sep = clauseSeparator(lang);
  const walkTo = fill(book.walkTo, { landmark: landmarkName });

  switch (action) {
    case 'start':
      return walkTo;
    case 'straight':
      return `${walkTo}${sep}${book.thenStraight}`;
    case 'left':
      return `${walkTo}${sep}${book.thenTurnLeft}`;
    case 'right':
      return `${walkTo}${sep}${book.thenTurnRight}`;
    case 'cross':
      return fill(book.crossAt, { landmark: landmarkName });
    case 'arrive':
      return `${walkTo}${sep}${lowercaseFirst(book.arrived)}`;
  }
}

/**
 * The landmark templateSteps anchors this manoeuvre to. `landmarks` is
 * `Journey.landmarks` — a flat array where core/landmarks.ts's
 * collectLandmarks scopes each id to its manoeuvre (`m{index}:...`) and
 * places that manoeuvre's best-ranked landmark first among its group, so the
 * first id-match here is already the right one to use.
 *
 * The distance-based fallback below is defensive, not expected to run
 * against a real journey — collectLandmarks' FALLBACK_RADIUS_M guarantees at
 * least one landmark per manoeuvre (verified live — see DEVPLAN.md). Kept
 * anyway because this function's whole job is to never fail unsafely.
 */
function landmarkForManoeuvre(manoeuvre: Manoeuvre, landmarks: readonly Landmark[]): Landmark | null {
  const scoped = landmarks.find((l) => l.id.startsWith(`m${manoeuvre.index}:`));
  if (scoped) return scoped;
  if (landmarks.length === 0) return null;
  return [...landmarks].sort((a, b) => haversineM(manoeuvre.at, a.at) - haversineM(manoeuvre.at, b.at))[0] ?? null;
}

/**
 * Last-resort steps assembled from templates, e.g. 走到 {landmark}，然后向左转.
 * Safe by construction: the only variable part is a landmark name we already
 * hold. Used when the LLM fails validation twice. Never let a journey die.
 */
export function templateSteps(manoeuvres: readonly Manoeuvre[], landmarks: readonly Landmark[], lang: Lang): Step[] {
  return manoeuvres.map((m) => {
    const landmark = landmarkForManoeuvre(m, landmarks);
    if (!landmark) {
      throw new Error(`templateSteps: no landmark available for manoeuvre ${m.index} — cannot produce a safe step`);
    }
    const name = localisedName(landmark, lang);
    return {
      index: m.index,
      landmarkId: landmark.id,
      action: m.action,
      spokenText: composeTemplateText(m.action, name, lang),
      displayText: m.action === 'arrive' ? phraseBookFor(lang).arrived : name,
    };
  });
}
