// Unit tests for core/validate.ts — THE SAFETY GATE. "Nothing is ever spoken
// that has not passed validateSteps()" (this file's own header), so the most
// important thing to prove here is that it actually REJECTS bad LLM output,
// not just accepts good output.

import { describe, it, expect } from 'vitest';
import { buildLexicon, lowercaseFirst, templateSteps, validateSteps } from './validate';
import type { Landmark, Manoeuvre, Step } from './types';

const LANDMARKS: Landmark[] = [
  { id: 'm0:l1', name: 'AMK Hub', nameZh: undefined, kind: 'building', at: { lat: 1.3696, lng: 103.8497 }, distanceM: 10, bearingDeg: 0 },
  { id: 'm1:l1', name: 'NTUC FairPrice', nameZh: '职总平价', kind: 'building', at: { lat: 1.37, lng: 103.85 }, distanceM: 5, bearingDeg: 90 },
];

function makeStep(overrides: Partial<Step>): Step {
  return {
    index: 0,
    landmarkId: 'm0:l1',
    action: 'straight',
    spokenText: '走到 AMK Hub，然后一直走',
    displayText: 'AMK Hub',
    ...overrides,
  };
}

describe('validateSteps', () => {
  it('accepts well-formed steps that only reference supplied landmarks', () => {
    const steps = [makeStep({ index: 0 })];
    const result = validateSteps(steps, LANDMARKS, 1, 'zh');
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a step referencing a landmark id that was never supplied (hallucinated landmark)', () => {
    const steps = [makeStep({ landmarkId: 'm0:invented' })];
    const result = validateSteps(steps, LANDMARKS, 1, 'zh');
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'unknown_landmark', stepIndex: 0 }),
    );
  });

  it('rejects an invented English proper noun in zh spoken text', () => {
    // "Starbucks" is not in the supplied landmark set or the generic allowlist.
    const steps = [makeStep({ spokenText: '走到 Starbucks，然后一直走' })];
    const result = validateSteps(steps, LANDMARKS, 1, 'zh');
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'invented_proper_noun' }),
    );
  });

  it('accepts a REAL landmark name kept verbatim in zh text, even though it is Latin script', () => {
    const steps = [makeStep({ spokenText: '走到 AMK Hub，然后一直走' })];
    const result = validateSteps(steps, LANDMARKS, 1, 'zh');
    expect(result.ok).toBe(true);
  });

  it('accepts generic allowlisted words (MRT, NTUC, block, ...) without flagging them', () => {
    const steps = [makeStep({ spokenText: '走到 NTUC，经过 MRT 站，然后一直走' })];
    const result = validateSteps(steps, LANDMARKS, 1, 'zh');
    expect(result.ok).toBe(true);
  });

  it('rejects a step_count_mismatch when the model drops or adds steps', () => {
    const steps = [makeStep({ index: 0 })];
    const result = validateSteps(steps, LANDMARKS, 2, 'zh');
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'step_count_mismatch' }),
    );
  });

  it('rejects an empty spokenText', () => {
    const steps = [makeStep({ spokenText: '   ' })];
    const result = validateSteps(steps, LANDMARKS, 1, 'zh');
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'empty_spoken_text', stepIndex: 0 }),
    );
  });

  it('reports every violation found, not just the first (so a retry prompt sees them all)', () => {
    const steps = [makeStep({ landmarkId: 'nope', spokenText: 'Fabricated' })];
    const result = validateSteps(steps, LANDMARKS, 1, 'zh');
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    const kinds = result.violations.map((v) => v.kind);
    expect(kinds).toContain('unknown_landmark');
    expect(kinds).toContain('invented_proper_noun');
  });

  describe('language-dependent proper-noun scanning (ms)', () => {
    it('does NOT flag ordinary lowercase Malay function/verb words, even mid-sentence', () => {
      // No capitalized tokens at all here — this is the case the ms branch
      // must never misfire on regardless of the lexicon: "kemudian belok
      // kanan" ("then turn right") is ordinary grammar, not a name.
      const steps = [makeStep({ spokenText: 'Berjalan ke destinasi, kemudian belok kanan.' })];
      const result = validateSteps(steps, LANDMARKS, 1, 'ms');
      expect(result.ok).toBe(true);
    });

    it('does NOT flag a real landmark name kept verbatim, even capitalized mid-sentence', () => {
      // Mirrors this file's own doc example ("Berjalan ke Pasar Blok 226H.")
      // — it only passes because "Pasar"/"Blok"/"226H" are the REAL
      // landmark's own name, in the lexicon; a lexicon hit short-circuits
      // the ms capitalization heuristic entirely (see findInventedTokens).
      const pasar: Landmark = {
        id: 'm0:l2',
        name: 'Pasar Blok 226H',
        kind: 'building',
        at: { lat: 1.37, lng: 103.85 },
        distanceM: 5,
        bearingDeg: 0,
      };
      const steps = [makeStep({ spokenText: 'Berjalan ke Pasar Blok 226H.', displayText: 'Pasar Blok 226H' })];
      const result = validateSteps(steps, [...LANDMARKS, pasar], 1, 'ms');
      expect(result.ok).toBe(true);
    });

    it('flags a capitalized, non-sentence-initial invented proper noun in ms', () => {
      const steps = [makeStep({ spokenText: 'Berjalan ke Starbucks sekarang.', displayText: 'Starbucks' })];
      const result = validateSteps(steps, LANDMARKS, 1, 'ms');
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.kind === 'invented_proper_noun')).toBe(true);
    });
  });
});

describe('buildLexicon', () => {
  it('collects lowercased Latin tokens from name/nameZh/nameMs across all landmarks', () => {
    const lexicon = buildLexicon(LANDMARKS);
    expect(lexicon.has('amk')).toBe(true);
    expect(lexicon.has('hub')).toBe(true);
    expect(lexicon.has('ntuc')).toBe(true);
    expect(lexicon.has('fairprice')).toBe(true);
    expect(lexicon.has('starbucks')).toBe(false);
  });
});

describe('lowercaseFirst', () => {
  it('lowercases only the first character', () => {
    expect(lowercaseFirst('Anda sudah sampai')).toBe('anda sudah sampai');
  });

  it('is a no-op on CJK text (no case concept) and on an empty string', () => {
    expect(lowercaseFirst('您到了')).toBe('您到了');
    expect(lowercaseFirst('')).toBe('');
  });
});

describe('templateSteps', () => {
  const manoeuvres: Manoeuvre[] = [
    { index: 0, at: { lat: 1.3696, lng: 103.8497 }, action: 'start', rawInstruction: '', distanceM: 0 },
    { index: 1, at: { lat: 1.37, lng: 103.85 }, action: 'arrive', rawInstruction: '', distanceM: 100 },
  ];

  it('produces steps that pass validateSteps() — safe by construction', () => {
    const steps = templateSteps(manoeuvres, LANDMARKS, 'zh');
    const result = validateSteps(steps, LANDMARKS, manoeuvres.length, 'zh');
    expect(result.ok).toBe(true);
  });

  it('anchors each step to the landmark scoped to its own manoeuvre (m{index}:...)', () => {
    const steps = templateSteps(manoeuvres, LANDMARKS, 'zh');
    expect(steps[0]!.landmarkId).toBe('m0:l1');
    expect(steps[1]!.landmarkId).toBe('m1:l1');
  });

  it('uses the localised name for the target language', () => {
    const steps = templateSteps(manoeuvres, LANDMARKS, 'zh');
    // m1:l1 has a curated Chinese name — must use it, not the raw English name.
    expect(steps[1]!.spokenText).toContain('职总平价');
    expect(steps[1]!.spokenText).not.toContain('NTUC FairPrice');
  });

  it('throws rather than silently guessing when no landmark is available at all', () => {
    expect(() => templateSteps(manoeuvres, [], 'zh')).toThrow();
  });
});
