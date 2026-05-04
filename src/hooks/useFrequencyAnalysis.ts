import { useEffect, useRef, useState } from 'react';
import {
  magnitudeSpectrum,
  detectPeakFrequencies,
  type FrequencyPeak,
} from '../services/euler/fftAnalyzer';

// SPDX-License-Identifier: MIT
//
// useFrequencyAnalysis — composable hook que aplica FFT (Cooley-Tukey)
// a un stream de muestras escalares (ej. magnitud de aceleración del
// hook `useAccelerometer`) y emite los picos de frecuencia detectados.
//
// Aplicación: detección temprana de fatiga de material en maquinaria
// pesada. Cuando un armónico nuevo aparece en el espectro, suele
// preceder horas/días al fallo del componente.
//
// Patrón de uso:
//
//   const accel = useAccelerometer();
//   const fft = useFrequencyAnalysis(accel.data?.acceleration ?? null, {
//     sampleRateHz: 50,    // device motion is typically 30-60 Hz
//     windowSize: 256,     // power-of-2 buffer
//     topN: 5,
//   });
//   // fft.peaks: FrequencyPeak[] (top-N picos por amplitud)
//
// El buffer se llena progresivamente; el primer análisis se emite
// cuando el buffer está completo y se actualiza cada `windowSize`
// muestras (ventana no solapada por simplicidad — para overlap más
// fino se puede agregar opt `hopSize` en el futuro).

export interface FrequencyAnalysisOptions {
  /** Sample rate of the input signal (Hz). Required for accurate frequency mapping. */
  sampleRateHz: number;
  /** Buffer size — must be a power of 2 (32, 64, 128, 256, 512, 1024, ...). Default 256. */
  windowSize?: number;
  /** Top N peaks to return. Default 5. */
  topN?: number;
  /** Noise floor as fraction of max magnitude. Default 0.1. */
  noiseFloorRatio?: number;
}

export interface FrequencyAnalysisResult {
  /** Top-N frequency peaks detected, sorted by magnitude desc. Empty until buffer first fills. */
  peaks: FrequencyPeak[];
  /** Number of full FFTs computed since hook mounted. Useful as a "freshness" indicator. */
  framesAnalyzed: number;
}

/**
 * Continuously buffers `sample` and computes an FFT every `windowSize`
 * samples. Pass `null` to skip a frame (e.g., when the source isn't
 * producing data).
 */
export function useFrequencyAnalysis(
  sample: number | null,
  opts: FrequencyAnalysisOptions,
): FrequencyAnalysisResult {
  const windowSize = opts.windowSize ?? 256;
  const topN = opts.topN ?? 5;
  const noiseFloorRatio = opts.noiseFloorRatio ?? 0.1;
  const bufferRef = useRef<number[]>([]);
  const [peaks, setPeaks] = useState<FrequencyPeak[]>([]);
  const [framesAnalyzed, setFramesAnalyzed] = useState(0);

  useEffect(() => {
    if (sample === null || sample === undefined || !Number.isFinite(sample)) return;
    bufferRef.current.push(sample);
    if (bufferRef.current.length < windowSize) return;

    const window = bufferRef.current.slice(0, windowSize);
    bufferRef.current = bufferRef.current.slice(windowSize); // drop the analyzed window

    const spectrum = magnitudeSpectrum(window, opts.sampleRateHz);
    const detected = detectPeakFrequencies(spectrum, { topN, noiseFloorRatio });
    setPeaks(detected);
    setFramesAnalyzed((n) => n + 1);
  }, [sample, windowSize, topN, noiseFloorRatio, opts.sampleRateHz]);

  return { peaks, framesAnalyzed };
}
