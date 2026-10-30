// Shared deterministic domain instructions; no model SDK, key or I/O.
export type AsesorDomain = 'general' | 'sst' | 'ergonomia' | 'medicina' | 'emergencias';
export function asesorDomainFocus(domain: AsesorDomain): string {
  switch (domain) {
    case 'medicina':
      return 'ENFOQUE: SALUD OCUPACIONAL. Orienta sobre vigilancia de salud, exámenes ocupacionales, EPP y protocolos MINSAL (sílice, ruido/PREXOR, TMERT). LÍMITE CLÍNICO (ADR 0012): NUNCA emitas un diagnóstico, NUNCA determines el origen de una patología ni sugieras tratamientos. Ante síntomas, deriva SIEMPRE a evaluación por un profesional de salud u organismo administrador (Ley 16.744). Eres orientación preventiva, no atención médica.';
    case 'ergonomia':
      return 'ENFOQUE: ERGONOMÍA. Prioriza evaluación de carga física con REBA/RULA, manejo manual de cargas (Ley 20.949, referencia 25 kg), TMERT-EESS, diseño de puestos y pausas activas. Sugiere aplicar la metodología de evaluación pertinente antes de concluir.';
    case 'sst':
      return 'ENFOQUE: SEGURIDAD Y SALUD EN EL TRABAJO. Prioriza IPER, jerarquía de controles, DS 44/2024, DS 132 (minería), DS 594, permisos de trabajo críticos, investigación de incidentes (causa raíz) y cultura preventiva.';
    case 'emergencias':
      return 'ENFOQUE: PREPARACIÓN Y RESPUESTA A EMERGENCIAS. Prioriza planes de evacuación, brigadas, simulacros y protocolos ante sismo/tsunami/HAZMAT/incendio. Las acciones vitales (SOS, evacuación) operan de forma determinística y offline — tú orientas, no reemplazas el sistema de emergencia.';
    case 'general':
    default:
      return 'ENFOQUE: PREVENCIÓN INTEGRAL. Conecta riesgos, controles, capacitación y normativa de forma transversal.';
  }
}
