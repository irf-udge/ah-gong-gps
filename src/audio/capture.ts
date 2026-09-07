// OWNER: B (Voice I/O) — do not edit unless you are the owner.
//
// ⚠️ THE TRAP THIS FILE EXISTS TO SOLVE ⚠️
// MERaLiON accepts wav/mp3/ogg at **16 kHz, mono** and nothing else.
// MediaRecorder gives you WebM/Opus at 48 kHz stereo. They are incompatible.
// So we do NOT use MediaRecorder — we pull raw PCM through Web Audio, downmix
// to mono, resample to 16 kHz, and encode a WAV header by hand.
//
// Recommended shape:
//   1. getUserMedia({ audio: { channelCount: 1, echoCancellation: true } })
//   2. new AudioContext({ sampleRate: 16000 })   ← ask for 16k up front; most
//      browsers honour it and resample for you. VERIFY with ctx.sampleRate and
//      resample manually if it gave you something else (Safari often does).
//   3. AudioWorklet (NOT ScriptProcessor — deprecated and it glitches) to
//      accumulate Float32 frames.
//   4. Float32 → Int16 PCM, then prepend a 44-byte RIFF/WAVE header.
//
// Test target: a 5 s clip is ~160 KB of PCM, ~213 KB base64. Fine over HTTP.
//
// See CONTRACTS.md § Audio contract. There is a unit test waiting to be written
// that asserts the output really is 16 kHz mono — write it, this is the single
// most likely thing to silently break.

export const TARGET_SAMPLE_RATE = 16_000;
export const TARGET_CHANNELS = 1;

export interface Recorder {
  /** Resolves once the mic is live and we are capturing. */
  start(): Promise<void>;
  /** Stops capture and returns a 16 kHz mono WAV blob. */
  stop(): Promise<Blob>;
  /** Abandon the take without producing a blob. */
  cancel(): void;
  readonly isRecording: boolean;
}

/**
 * Ask for mic permission WITHOUT starting a recording.
 *
 * Call this on the very first tap of the big button so the OS prompt appears
 * at a moment the user understands, not halfway through their sentence.
 */
export async function requestMicPermission(): Promise<boolean> {
  throw new Error('NOT_IMPLEMENTED: capture.requestMicPermission');
}

export function createRecorder(): Recorder {
  throw new Error('NOT_IMPLEMENTED: capture.createRecorder');
}

/** Float32 samples → 16-bit PCM WAV blob. Pure; unit-test this directly. */
export function encodeWav(
  _samples: Float32Array,
  _sampleRate: number = TARGET_SAMPLE_RATE,
): Blob {
  throw new Error('NOT_IMPLEMENTED: capture.encodeWav');
}

/**
 * Linear resample. Only needed when the AudioContext refused our requested
 * rate — check `ctx.sampleRate` before calling.
 */
export function resample(
  _input: Float32Array,
  _fromRate: number,
  _toRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  throw new Error('NOT_IMPLEMENTED: capture.resample');
}

/** Blob → base64 with NO data-URI prefix (the server adds it). */
export async function blobToBase64(_blob: Blob): Promise<string> {
  throw new Error('NOT_IMPLEMENTED: capture.blobToBase64');
}
