# ADR-0018: WebXR rebranded as "Capacitación Interactiva"
Date: 2026-05-17
Status: Accepted
## Context
Página WebXR.tsx implicaba AR (PremiumFeatureGuard "AR — Trabajo en Altura") pero la implementación es clicks en círculos pre-posicionados sin ARCore/WebXR APIs.
## Decision
Renombrar a "Capacitación Interactiva". WebXR real (ARCore Android + Quick Look iOS) queda como Fase E.1, long-pole 6-8 semanas.
## Consequences
- No mentimos al usuario premium sobre AR.
- WebXR.tsx queda como checklist 2D educativo.
- Cuando lleguemos a E.1, crear `WebXRReal.tsx` separado.
