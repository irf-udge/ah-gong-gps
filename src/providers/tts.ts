// OWNER: B (Voice I/O) — do not edit unless you are the owner.
//
// Speech out, via the browser's built-in speechSynthesis.
//
// MERaLiON has NO text-to-speech endpoint — don't go looking for one.
//
// Because synthesis is LOCAL there is no network round trip, which is why we
// do NOT pre-generate audio at journey start (the brief asked for that to hide
// latency we no longer have). Keep this behind the interface anyway so a
// hosted voice can drop in later.
//
// ⚠️ PHASE 0 BLOCKER: run availableLangs() on the ACTUAL demo phone before
// writing anything else. If the device has no ms-MY voice, half the demo is
// dead and you need to know on hour one. See DEVPLAN.md § Phase 0.

import type { Lang } from '../core/types';
import type { TtsProvider } from './types';

/** BCP-47 tags to match against `speechSynthesis.getVoices()`. */
export const VOICE_TAGS: Record<Lang, readonly string[]> = {
  zh: ['zh-CN', 'zh-SG', 'zh-Hans-CN', 'zh'],
  ms: ['ms-MY', 'ms'],
  en: ['en-SG', 'en-GB', 'en-US', 'en'],
  ta: ['ta-IN', 'ta-SG', 'ta'],
};

export class BrowserTts implements TtsProvider {
  readonly name = 'browser';

  /**
   * iOS/Safari refuses to speak unless speechSynthesis was first invoked inside
   * a user gesture. Call this from the big button's first tap — speak an empty
   * utterance to unlock the queue.
   */
  primeForUserGesture(): void {
    throw new Error('NOT_IMPLEMENTED: BrowserTts.primeForUserGesture');
  }

  /**
   * Note getVoices() is async-populated in Chrome — it returns [] on first call
   * until the `voiceschanged` event fires. Await that before trusting it.
   */
  availableLangs(): Lang[] {
    throw new Error('NOT_IMPLEMENTED: BrowserTts.availableLangs');
  }

  async speak(_text: string, _lang: Lang): Promise<void> {
    throw new Error('NOT_IMPLEMENTED: BrowserTts.speak');
  }

  cancel(): void {
    throw new Error('NOT_IMPLEMENTED: BrowserTts.cancel');
  }
}

/** Silent no-op for tests and for running the pipeline headless. */
export class FixtureTts implements TtsProvider {
  readonly name = 'fixture';

  primeForUserGesture(): void {}
  availableLangs(): Lang[] {
    return ['zh', 'ms'];
  }
  async speak(_text: string, _lang: Lang): Promise<void> {}
  cancel(): void {}
}
