// SPDX-License-Identifier: MIT
//
// Fast Fourier Transform — Fase 5 del plan Euler-Matrix.
//
// Identidad de Euler:  e^iπ + 1 = 0
//
// El FFT descompone una señal temporal x[n] en sus componentes
// espectrales X[k]:
//
//   X[k] = Σ_{n=0}^{N-1} x[n] · e^{-2πi·k·n/N}
//
// El kernel e^{-2πi·k·n/N} es la "raíz N-ésima de la unidad" — un
// número complejo unitario rotado por la identidad de Euler. Sin la
// fórmula e^{ix} = cos(x) + i·sin(x), el FFT no existiría como lo
// conocemos.
//
// Aplicación a prevención: vibraciones de maquinaria pesada (camión
// de gran tonelaje, perforadora minera, compresor neumático) emiten
// armónicos característicos. Cuando aparece un armónico nuevo o uno
// existente cambia de amplitud, suele preceder fatiga del material
// (rodamientos, ejes, soldaduras) — alerta predictiva de horas/días
// antes del fallo catastrófico.
//
// Algoritmo: Cooley-Tukey radix-2 in-place. O(N log N). Requiere
// N = 2^k. Para tamaños arbitrarios la API pública padding a la
// siguiente potencia.
//
// Origen: Euler 1748 ("Introductio in analysin infinitorum") — formula
// e^{ix} = cos x + i sin x. FFT como tal es Cooley & Tukey 1965, pero
// el kernel matemático es íntegramente Euler.

export interface ComplexNumber {
  re: number;
  im: number;
}

/** Round up to next power of 2. Returns 1 for n ≤ 1. */
function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Bit-reverse permutation in-place. log2N must be the exact log2 of input.length. */
function bitReverseInPlace(input: ComplexNumber[]): void {
  const N = input.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tmp = input[i];
      input[i] = input[j];
      input[j] = tmp;
    }
  }
}

/**
 * Cooley-Tukey radix-2 FFT in-place.
 * Input: array of complex numbers, length N must be a power of 2.
 * Output: same array reference, transformed.
 *
 * For inverse transform set `inverse=true` — flips the sign of the
 * exponent and divides by N at the end.
 */
function fftInPlace(input: ComplexNumber[], inverse: boolean): ComplexNumber[] {
  const N = input.length;
  if (N <= 1) return input;
  if ((N & (N - 1)) !== 0) {
    throw new Error(`fft: input length ${N} is not a power of 2`);
  }

  bitReverseInPlace(input);

  // Butterflies — len doubles each level: 2, 4, 8, ..., N.
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = (sign * 2 * Math.PI) / len;
    const wStepRe = Math.cos(angleStep);
    const wStepIm = Math.sin(angleStep);

    for (let i = 0; i < N; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < halfLen; k++) {
        const a = input[i + k];
        const b = input[i + k + halfLen];
        // u = b * w (complex multiplication)
        const uRe = b.re * wRe - b.im * wIm;
        const uIm = b.re * wIm + b.im * wRe;
        // butterfly
        input[i + k] = { re: a.re + uRe, im: a.im + uIm };
        input[i + k + halfLen] = { re: a.re - uRe, im: a.im - uIm };
        // advance twiddle factor: w *= wStep
        const newWRe = wRe * wStepRe - wIm * wStepIm;
        const newWIm = wRe * wStepIm + wIm * wStepRe;
        wRe = newWRe;
        wIm = newWIm;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < N; i++) {
      input[i] = { re: input[i].re / N, im: input[i].im / N };
    }
  }

  return input;
}

/**
 * Forward FFT. Returns a NEW array (does not mutate input).
 * @throws if `input.length` is not a power of 2.
 */
export function fft(input: ComplexNumber[]): ComplexNumber[] {
  const copy = input.map((c) => ({ re: c.re, im: c.im }));
  return fftInPlace(copy, false);
}

/**
 * Inverse FFT. Returns a new array (does not mutate input).
 * @throws if `input.length` is not a power of 2.
 */
export function ifft(input: ComplexNumber[]): ComplexNumber[] {
  const copy = input.map((c) => ({ re: c.re, im: c.im }));
  return fftInPlace(copy, true);
}

export interface MagnitudeSpectrum {
  /** Frequency bins (Hz), length = N/2 + 1 (DC + positive frequencies + Nyquist). */
  frequencies: number[];
  /** Magnitudes |X[k]| (linear, not dB), same length as frequencies. */
  magnitudes: number[];
  /** N actually used after padding (always a power of 2). */
  N: number;
}

/**
 * Magnitude spectrum of a real-valued signal. Pads to next power of 2
 * with zeros if needed. Returns only positive frequencies + DC + Nyquist
 * (length N/2 + 1) — for real signals the negative frequency half is
 * the complex conjugate mirror.
 */
export function magnitudeSpectrum(realSignal: number[], sampleRateHz: number): MagnitudeSpectrum {
  if (realSignal.length === 0) {
    return { frequencies: [], magnitudes: [], N: 0 };
  }

  const N = nextPow2(realSignal.length);
  const padded: ComplexNumber[] = new Array(N);
  for (let i = 0; i < N; i++) {
    padded[i] = { re: i < realSignal.length ? realSignal[i] : 0, im: 0 };
  }

  const spectrum = fftInPlace(padded, false);

  // Positive-frequency half + DC + Nyquist = N/2 + 1 bins.
  const half = (N >> 1) + 1;
  const frequencies = new Array<number>(half);
  const magnitudes = new Array<number>(half);
  for (let k = 0; k < half; k++) {
    frequencies[k] = (k * sampleRateHz) / N;
    const c = spectrum[k];
    magnitudes[k] = Math.sqrt(c.re * c.re + c.im * c.im);
  }
  return { frequencies, magnitudes, N };
}

export interface FrequencyPeak {
  freq: number;
  magnitude: number;
}

export interface PeakDetectionOptions {
  /** Top-N peaks to return. Default 5. */
  topN?: number;
  /**
   * Minimum magnitude as a fraction of the maximum magnitude in the
   * spectrum. Bins below this are excluded. Default 0.1 (10%).
   */
  noiseFloorRatio?: number;
}

/**
 * Detect the strongest frequency peaks above the noise floor.
 * Returns up to topN peaks sorted by magnitude descending.
 */
export function detectPeakFrequencies(
  spectrum: { frequencies: number[]; magnitudes: number[] },
  opts: PeakDetectionOptions = {},
): FrequencyPeak[] {
  const topN = opts.topN ?? 5;
  const ratio = opts.noiseFloorRatio ?? 0.1;
  if (spectrum.magnitudes.length === 0) return [];

  let max = 0;
  for (const m of spectrum.magnitudes) {
    if (m > max) max = m;
  }
  if (max === 0) return [];

  const floor = max * ratio;
  const peaks: FrequencyPeak[] = [];
  for (let i = 0; i < spectrum.magnitudes.length; i++) {
    if (spectrum.magnitudes[i] >= floor) {
      peaks.push({ freq: spectrum.frequencies[i], magnitude: spectrum.magnitudes[i] });
    }
  }
  peaks.sort((a, b) => b.magnitude - a.magnitude);
  return peaks.slice(0, topN);
}
