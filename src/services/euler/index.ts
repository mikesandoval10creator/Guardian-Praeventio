// SPDX-License-Identifier: MIT
// Barrel for Euler-driven primitives — pareja matemática de Bernoulli
// (`src/services/zettelkasten/bernoulli/*`). Bernoulli cuantifica las
// magnitudes de cada peligro; Euler modela la estructura del tejido
// que los relaciona.
//
// Roadmap (ver docs/sprints/EULER_INTEGRATION_SPEC.md):
//   Euler-1 (esta wave): Fases 1, 3, 6, 10
//   Euler-2 (siguiente): Fases 2, 5, 8
//   Euler-3 (final): Fases 4, 7, 9 + documentación maestra

// Euler-1 modules
export * from './graphConnectivity';         // Fase 1 — teoría de grafos (Königsberg)
export * from './criticalLoad';               // Fase 3 — pandeo P_cr
export * from './odeIntegrator';              // Fase 6 — método de Euler para ODEs
export * from './polyhedronAchievements';     // Fase 10 — V - E + F = 2 gamificación

// Euler-2 modules
export * from './eulerianPath';               // Fase 2 — Hierholzer (caminos eulerianos)
export * from './fftAnalyzer';                // Fase 5 — Cooley-Tukey FFT (identidad e^iπ+1=0)
export * from './eulerLagrange';              // Fase 8 — variational calculus (camino de mínima acción)

// Euler-3 modules
export * from './inviscidFlow';               // Fase 4 — Ecuaciones de Euler de fluidos (1755)
// Fase 7 (topología Zettelkasten) reusa graphConnectivity (ya exportado)
// Fase 9 (φ Euler en RSA) es ADR-only — ver docs/architecture-decisions/0007-euler-phi-rsa-in-kms-envelope.md
