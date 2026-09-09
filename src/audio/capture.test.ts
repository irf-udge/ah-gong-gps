// Unit tests for audio/capture.ts's PURE encoding helpers (encodeWav,
// resample). createRecorder() itself needs real browser APIs
// (getUserMedia/AudioContext/AudioWorklet) and is exercised live, not here —
// see this file's own header for why raw PCM + a hand-written WAV header was
// chosen over MediaRecorder in the first place.

import { describe, it, expect } from 'vitest';
import { encodeWav, resample, TARGET_CHANNELS, TARGET_SAMPLE_RATE } from './capture';

/** Read a WAV Blob's header fields back out, for asserting against. */
async function readWavHeader(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const readAscii = (offset: number, length: number) =>
    Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('');
  return {
    riff: readAscii(0, 4),
    fileSize: view.getUint32(4, true),
    wave: readAscii(8, 4),
    fmt: readAscii(12, 4),
    fmtChunkSize: view.getUint32(16, true),
    audioFormat: view.getUint16(20, true),
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataTag: readAscii(36, 4),
    dataSize: view.getUint32(40, true),
    totalBytes: buf.byteLength,
  };
}

describe('TARGET_SAMPLE_RATE / TARGET_CHANNELS', () => {
  it('is 16 kHz mono — MERaLiON accepts nothing else (see this file and CONTRACTS.md § Audio)', () => {
    expect(TARGET_SAMPLE_RATE).toBe(16_000);
    expect(TARGET_CHANNELS).toBe(1);
  });
});

describe('encodeWav', () => {
  it('produces a valid 44-byte RIFF/WAVE header at the default (16 kHz) rate', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWav(samples);
    const header = await readWavHeader(blob);

    expect(header.riff).toBe('RIFF');
    expect(header.wave).toBe('WAVE');
    expect(header.fmt).toBe('fmt ');
    expect(header.dataTag).toBe('data');
    expect(header.audioFormat).toBe(1); // PCM
    expect(header.numChannels).toBe(TARGET_CHANNELS);
    expect(header.sampleRate).toBe(TARGET_SAMPLE_RATE);
    expect(header.bitsPerSample).toBe(16);
    expect(header.blockAlign).toBe(2); // mono 16-bit = 2 bytes/frame
    expect(header.byteRate).toBe(TARGET_SAMPLE_RATE * 2);
  });

  it('sizes the data chunk and the whole file consistently with the sample count', async () => {
    const samples = new Float32Array(1000).fill(0.1);
    const blob = encodeWav(samples);
    const header = await readWavHeader(blob);

    expect(header.dataSize).toBe(1000 * 2); // 16-bit = 2 bytes/sample
    expect(header.totalBytes).toBe(44 + 1000 * 2);
    expect(header.fileSize).toBe(header.totalBytes - 8); // RIFF size excludes the 'RIFF'+size fields themselves
  });

  it('honours a custom sample rate when told to', async () => {
    const blob = encodeWav(new Float32Array([0, 0]), 48_000);
    const header = await readWavHeader(blob);
    expect(header.sampleRate).toBe(48_000);
    expect(header.byteRate).toBe(48_000 * 2);
  });

  it('encodes 16-bit PCM samples correctly, including clamping out-of-range input', async () => {
    // 0 -> 0, 1 -> 32767 (0x7fff), -1 -> -32768 (0x8000), and anything
    // further out-of-range must clamp rather than wrap/overflow.
    const samples = new Float32Array([0, 1, -1, 2, -2]);
    const blob = encodeWav(samples);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const readSampleAt = (i: number) => view.getInt16(44 + i * 2, true);

    expect(readSampleAt(0)).toBe(0);
    expect(readSampleAt(1)).toBe(32767);
    expect(readSampleAt(2)).toBe(-32768);
    expect(readSampleAt(3)).toBe(32767); // clamped, not overflowed
    expect(readSampleAt(4)).toBe(-32768); // clamped, not overflowed
  });

  it('produces a valid (44-byte, zero-data) header for an empty sample array', async () => {
    const blob = encodeWav(new Float32Array(0));
    const header = await readWavHeader(blob);
    expect(header.dataSize).toBe(0);
    expect(header.totalBytes).toBe(44);
  });
});

describe('resample', () => {
  it('is a no-op when fromRate === toRate', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resample(input, TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE)).toBe(input);
  });

  it('is a no-op on empty input', () => {
    const input = new Float32Array(0);
    expect(resample(input, 48_000, TARGET_SAMPLE_RATE)).toBe(input);
  });

  it('downsamples 48 kHz to 16 kHz at a 3:1 ratio', () => {
    const input = new Float32Array(48_000); // 1 second at 48kHz
    const output = resample(input, 48_000, TARGET_SAMPLE_RATE);
    expect(output.length).toBe(16_000); // 1 second at 16kHz
  });

  it('preserves a constant signal exactly', () => {
    const input = new Float32Array(4800).fill(0.42);
    const output = resample(input, 48_000, TARGET_SAMPLE_RATE);
    expect(output.every((v) => Math.abs(v - 0.42) < 1e-6)).toBe(true);
  });

  it('linearly interpolates between two known points', () => {
    // 2 input samples spanning the whole signal; downsampling by 2x should
    // land roughly midway between them at the output's midpoint.
    const input = new Float32Array([0, 1]);
    const output = resample(input, 2, 1);
    expect(output.length).toBe(1);
    expect(output[0]).toBeGreaterThanOrEqual(0);
    expect(output[0]).toBeLessThanOrEqual(1);
  });
});
