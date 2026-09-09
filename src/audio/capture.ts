// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
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
// See CONTRACTS.md § Audio contract.

export const TARGET_SAMPLE_RATE = 16_000;
export const TARGET_CHANNELS = 1;

export interface Recorder {
  /** Resolves once the mic is live and we are capturing. */
  start(): Promise<void>;
  /** Stops capture and returns a 16 kHz mono WAV blob. */
  stop(): Promise<Blob>;
  /** Abandon the take without producing a blob. Safe to call in any state. */
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
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: TARGET_CHANNELS, echoCancellation: true },
    });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

// ─── The AudioWorklet processor ──────────────────────────────────────────────
// Runs on the separate, high-priority audio rendering thread — inlined as a
// Blob URL rather than a second file, so the whole capture path stays in one
// place. Downmixes to mono INSIDE the worklet (defensive: echoCancellation /
// browser processing can hand back more than 1 channel even when
// channelCount:1 was requested) and batches ~2048 samples per postMessage —
// posting every 128-sample quantum (the AudioWorklet default) would fire
// ~375 times/sec at 48 kHz, real message-passing overhead on a phone.
// Transfers the buffer (zero-copy) rather than letting postMessage clone it.
const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffered = [];
    this._bufferedLength = 0;
    this._flushThreshold = 2048;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') this._flush(true);
    };
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const numChannels = input.length;
      const frameLength = input[0].length;
      const mono = new Float32Array(frameLength);
      for (let i = 0; i < frameLength; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) sum += input[ch][i];
        mono[i] = sum / numChannels;
      }
      this._buffered.push(mono);
      this._bufferedLength += frameLength;
      if (this._bufferedLength >= this._flushThreshold) this._flush(false);
    }
    return true;
  }
  _flush(isFinal) {
    if (this._bufferedLength > 0) {
      const merged = new Float32Array(this._bufferedLength);
      let offset = 0;
      for (const chunk of this._buffered) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this.port.postMessage(merged, [merged.buffer]);
      this._buffered = [];
      this._bufferedLength = 0;
    }
    if (isFinal) this.port.postMessage({ type: 'flushed' });
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

function workletModuleUrl(): string {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

function mergeChunks(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

/**
 * How long `start()` will wait for the FIRST real buffer from the worklet
 * before giving up and resolving anyway. See the ⚠️ note in `start()` for
 * why this exists — it's not a guess, it's a measured, reproduced bug.
 */
const FIRST_BUFFER_TIMEOUT_MS = 500;

export function createRecorder(): Recorder {
  let audioContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let silentGain: GainNode | null = null;
  let workletUrl: string | null = null;
  const chunks: Float32Array[] = [];
  let recording = false;

  const teardown = () => {
    sourceNode?.disconnect();
    workletNode?.disconnect();
    silentGain?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    // Don't await close() here — cancel() must be synchronous-safe. start()'s
    // own AudioContext gets garbage collected once nothing references it.
    void audioContext?.close().catch(() => {});
    audioContext = null;
    stream = null;
    sourceNode = null;
    workletNode = null;
    silentGain = null;
    workletUrl = null;
  };

  return {
    get isRecording() {
      return recording;
    },

    async start(): Promise<void> {
      if (recording) throw new Error('createRecorder: already recording — call stop() or cancel() first');
      chunks.length = 0;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: TARGET_CHANNELS, echoCancellation: true },
      });

      // Ask for 16 kHz up front — most browsers honour it and we skip
      // resampling entirely. `stop()` checks ctx.sampleRate and resamples
      // manually for the browsers (Safari, notably) that ignore this.
      audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

      workletUrl = workletModuleUrl();
      await audioContext.audioWorklet.addModule(workletUrl);

      sourceNode = audioContext.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioContext, 'capture-processor');

      // ⚠️ VERIFIED LIVE, REPRODUCED: the FIRST AudioContext+AudioWorklet+
      // getUserMedia chain on a fresh page has real cold-start latency
      // (audio device negotiation, worklet compilation) before it starts
      // actually processing real samples — a short recording immediately
      // after start() can otherwise capture nothing but that startup
      // silence. Reproduced with a synthetic 440Hz test tone: the same code
      // returned an all-zero WAV on a cold run and a correct one once the
      // pipeline had already been exercised once on the same page. So
      // start() doesn't resolve on "the graph is wired up" — it resolves
      // once the FIRST real buffer has actually arrived from the worklet
      // (bounded by FIRST_BUFFER_TIMEOUT_MS so a genuinely broken mic can't
      // hang the caller forever; recording still proceeds either way, this
      // only delays telling the caller "go ahead and speak now").
      let onFirstBuffer: (() => void) | null = null;
      const firstBufferArrived = new Promise<void>((resolve) => {
        onFirstBuffer = resolve;
      });

      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (e.data instanceof Float32Array) {
          chunks.push(e.data);
          onFirstBuffer?.();
          onFirstBuffer = null;
        }
      };
      sourceNode.connect(workletNode);

      // Without a path to `destination`, the render graph never pulls this
      // branch at all on some browsers — process() either doesn't fire or
      // fires with silence (verified live the same way as the cold-start
      // issue above). Route through a silent (gain=0) node so the graph
      // stays "live" without the user ever hearing themselves.
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      recording = true;

      await Promise.race([
        firstBufferArrived,
        new Promise<void>((resolve) => setTimeout(resolve, FIRST_BUFFER_TIMEOUT_MS)),
      ]);
    },

    async stop(): Promise<Blob> {
      if (!recording) throw new Error('createRecorder: not recording — call start() first');
      recording = false;

      // Flush the worklet's partial buffer (up to ~2048 samples still
      // sitting in it) before reading `chunks`, or the last ~40ms of speech
      // gets silently dropped — the kind of bug that only shows up as
      // "the last word keeps getting cut off" days later.
      if (workletNode) {
        await new Promise<void>((resolve) => {
          const node = workletNode!;
          const onFlushed = (e: MessageEvent) => {
            if (e.data?.type === 'flushed') {
              node.port.removeEventListener('message', onFlushed);
              resolve();
            }
          };
          node.port.addEventListener('message', onFlushed);
          node.port.start();
          node.port.postMessage('flush');
        });
      }

      const actualRate = audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
      const merged = mergeChunks(chunks);
      const pcm = actualRate === TARGET_SAMPLE_RATE ? merged : resample(merged, actualRate, TARGET_SAMPLE_RATE);

      teardown();
      return encodeWav(pcm, TARGET_SAMPLE_RATE);
    },

    cancel(): void {
      recording = false;
      chunks.length = 0;
      teardown();
    },
  };
}

// ─── Pure encoding helpers — no browser APIs, unit-testable in Node ─────────

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Float32 samples → 16-bit PCM WAV blob. Pure; unit-test this directly. */
export function encodeWav(samples: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): Blob {
  const bitsPerSample = 16;
  const blockAlign = TARGET_CHANNELS * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * (bitsPerSample / 8);

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size (PCM)
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, TARGET_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Linear resample. Only needed when the AudioContext refused our requested
 * rate — check `ctx.sampleRate` before calling.
 */
export function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;

  const ratio = fromRate / toRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    const s0 = input[i0] ?? 0;
    const s1 = input[i1] ?? 0;
    output[i] = s0 + (s1 - s0) * frac;
  }

  return output;
}

/** Blob → base64 with NO data-URI prefix (the server adds it). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Chunked to avoid String.fromCharCode(...bytes) blowing the call-stack /
  // argument-count limit on anything past a few tens of KB — a 5s clip here
  // is ~160KB of PCM, well past that limit if done in one call.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
