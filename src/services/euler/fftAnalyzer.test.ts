// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  fft,
  ifft,
  magnitudeSpectrum,
  detectPeakFrequencies,
  type ComplexNumber,
} from './fftAnalyzer';

const realSeq = (xs: number[]): ComplexNumber[] => xs.map((re) => ({ re, im: 0 }));

describe('fft / ifft round-trip', () => {
  it('round-trips a length-4 signal within floating-point tolerance', () => {
    const input = realSeq([1, 2, 3, 4]);
    const round = ifft(fft(input));
    for (let i = 0; i < input.length; i++) {
      expect(round[i].re).toBeCloseTo(input[i].re, 10);
      expect(round[i].im).toBeCloseTo(input[i].im, 10);
    }
  });

  it('round-trips a length-1024 random signal', () => {
    const N = 1024;
    const input: ComplexNumber[] = [];
    for (let i = 0; i < N; i++) input.push({ re: Math.sin(i * 0.1) * 5, im: 0 });
    const round = ifft(fft(input));
    for (let i = 0; i < N; i++) {
      expect(round[i].re).toBeCloseTo(input[i].re, 8);
    }
  });

  it('throws on non-power-of-2 length', () => {
    const input = realSeq([1, 2, 3]); // length 3 — not pow2
    expect(() => fft(input)).toThrow(/power of 2/);
  });
});

describe('fft known signals', () => {
  it('all-zeros input → all-zeros output', () => {
    const out = fft(realSeq([0, 0, 0, 0, 0, 0, 0, 0]));
    for (const c of out) {
      expect(c.re).toBeCloseTo(0, 12);
      expect(c.im).toBeCloseTo(0, 12);
    }
  });

  it('impulse [1, 0, 0, 0, 0, 0, 0, 0] → flat spectrum (all magnitudes equal 1)', () => {
    const out = fft(realSeq([1, 0, 0, 0, 0, 0, 0, 0]));
    for (const c of out) {
      const mag = Math.sqrt(c.re * c.re + c.im * c.im);
      expect(mag).toBeCloseTo(1, 12);
    }
  });

  it('DC signal [c, c, c, c] → only bin 0 has magnitude N·c', () => {
    const c = 3;
    const N = 8;
    const out = fft(realSeq(Array(N).fill(c)));
    expect(out[0].re).toBeCloseTo(N * c, 10);
    expect(out[0].im).toBeCloseTo(0, 10);
    for (let k = 1; k < N; k++) {
      const mag = Math.sqrt(out[k].re ** 2 + out[k].im ** 2);
      expect(mag).toBeCloseTo(0, 10);
    }
  });
});

describe('magnitudeSpectrum', () => {
  it('detects a 50 Hz sine in a 1024-sample signal at 1024 Hz sampleRate', () => {
    // Choose sampleRate=N so freq×N/sampleRate is integer → bin lands
    // exactly on freq Hz (no spectral leakage).
    const N = 1024;
    const sampleRate = 1024;
    const freq = 50;
    const signal: number[] = [];
    for (let n = 0; n < N; n++) {
      signal.push(Math.sin((2 * Math.PI * freq * n) / sampleRate));
    }
    const spec = magnitudeSpectrum(signal, sampleRate);
    expect(spec.N).toBe(1024);
    expect(spec.frequencies.length).toBe(N / 2 + 1);
    expect(spec.magnitudes.length).toBe(N / 2 + 1);
    // Peak should be exactly at bin 50 since freq×N/sampleRate = 50.
    let peakBin = 0;
    let peakMag = 0;
    for (let i = 0; i < spec.magnitudes.length; i++) {
      if (spec.magnitudes[i] > peakMag) {
        peakMag = spec.magnitudes[i];
        peakBin = i;
      }
    }
    expect(peakBin).toBe(50);
    // Real-signal sine of unit amplitude with bin-aligned frequency:
    // FFT magnitude = N/2 (energy split half/half between positive and
    // negative frequencies, no leakage).
    expect(peakMag).toBeCloseTo(N / 2, 4);
  });

  it('shows spectral leakage when frequency is not bin-aligned', () => {
    // 50 Hz at sampleRate=1000, N=1024 → bin = 51.2 (between 51 and 52).
    // Energy spreads — single-bin peak is below N/2.
    const N = 1024;
    const sampleRate = 1000;
    const freq = 50;
    const signal: number[] = [];
    for (let n = 0; n < N; n++) {
      signal.push(Math.sin((2 * Math.PI * freq * n) / sampleRate));
    }
    const spec = magnitudeSpectrum(signal, sampleRate);
    let peakMag = 0;
    let peakBin = 0;
    for (let i = 0; i < spec.magnitudes.length; i++) {
      if (spec.magnitudes[i] > peakMag) {
        peakMag = spec.magnitudes[i];
        peakBin = i;
      }
    }
    // Peak bin near 51 (bin = 51.2 ≈ 51).
    expect(peakBin).toBeGreaterThanOrEqual(50);
    expect(peakBin).toBeLessThanOrEqual(52);
    // Peak magnitude reduced from N/2 = 512 due to leakage — but still
    // significantly above noise floor. Empirically lands around 478.
    expect(peakMag).toBeGreaterThan(N / 4);
    expect(peakMag).toBeLessThan(N / 2);
  });

  it('pads non-power-of-2 length to next power of 2', () => {
    const signal = new Array(100).fill(0).map((_, n) => Math.sin(n * 0.5));
    const spec = magnitudeSpectrum(signal, 1000);
    expect(spec.N).toBe(128); // next pow2 after 100
    expect(spec.magnitudes.length).toBe(65); // N/2 + 1
  });

  it('returns empty for empty input', () => {
    const spec = magnitudeSpectrum([], 1000);
    expect(spec.N).toBe(0);
    expect(spec.frequencies).toEqual([]);
    expect(spec.magnitudes).toEqual([]);
  });

  it('frequency axis is in Hz with correct scaling', () => {
    const spec = magnitudeSpectrum(new Array(8).fill(1), 800);
    // For N=8, sampleRate=800: bins are 0, 100, 200, 300, 400 Hz.
    expect(spec.frequencies).toEqual([0, 100, 200, 300, 400]);
  });
});

describe('detectPeakFrequencies', () => {
  it('returns the single peak when only one frequency is present', () => {
    const N = 256;
    const sampleRate = 1024;
    const freq = 100;
    const signal: number[] = [];
    for (let n = 0; n < N; n++) {
      signal.push(Math.sin((2 * Math.PI * freq * n) / sampleRate));
    }
    const spec = magnitudeSpectrum(signal, sampleRate);
    const peaks = detectPeakFrequencies(spec, { topN: 1 });
    expect(peaks.length).toBe(1);
    expect(peaks[0].freq).toBeCloseTo(freq, -1);
  });

  it('respects noiseFloorRatio — filters bins below threshold', () => {
    const spec = {
      frequencies: [0, 10, 20, 30, 40],
      magnitudes: [100, 5, 80, 3, 60],
    };
    const peaks = detectPeakFrequencies(spec, { topN: 5, noiseFloorRatio: 0.5 });
    // Floor = 50. Should only return bins with mag >= 50: 100, 80, 60.
    expect(peaks.map((p) => p.magnitude)).toEqual([100, 80, 60]);
  });

  it('respects topN cap', () => {
    const spec = {
      frequencies: [0, 1, 2, 3, 4],
      magnitudes: [10, 9, 8, 7, 6],
    };
    const peaks = detectPeakFrequencies(spec, { topN: 2, noiseFloorRatio: 0 });
    expect(peaks.length).toBe(2);
    expect(peaks[0].magnitude).toBe(10);
    expect(peaks[1].magnitude).toBe(9);
  });

  it('returns empty array when input is empty', () => {
    expect(detectPeakFrequencies({ frequencies: [], magnitudes: [] })).toEqual([]);
  });

  it('returns empty array when all magnitudes are zero', () => {
    expect(
      detectPeakFrequencies({ frequencies: [0, 1, 2], magnitudes: [0, 0, 0] }),
    ).toEqual([]);
  });
});

describe('performance', () => {
  it('FFT on N=4096 completes within 100ms', () => {
    const N = 4096;
    const input: ComplexNumber[] = new Array(N);
    for (let i = 0; i < N; i++) input[i] = { re: Math.random(), im: 0 };
    const t0 = Date.now();
    fft(input);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });
});
