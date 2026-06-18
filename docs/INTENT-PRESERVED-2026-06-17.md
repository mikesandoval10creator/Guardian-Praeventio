# Nada se perdió: dónde vive cada idea tras quitar el dato falso (2026-06-17)

Preocupación del fundador: *"quitar cosas que no eran reales puede haber eliminado el trabajo / la propuesta / lo ideado para una función."*

Respuesta corta: **no se eliminó ninguna propuesta ni idea.** El dato falso era un *stand-in* (maqueta) de una función; NO era el lugar donde vive el diseño. El diseño vive en: los **motores** (engines que ya calculan lo real), los **tipos**, los **docs de plan** (`PLAN-MAESTRO-HACER-REAL`, `docs/audits/WORKLIST-NEXT-REAL`, ADRs) y la memoria — **nada de eso se tocó**. Además **git conserva cada línea**: ningún borrado es irrecuperable.

Por cada dato falso removido esta sesión, aquí está dónde quedó la idea:

## A. Idea RECONSTRUIDA real (más fuerte que el fake)

| Dato falso removido | Función que representaba | Dónde vive ahora |
|---|---|---|
| Pines fijos "Niebla/Nevazón" en ClimateRoutes (#939) | Mostrar peligros climáticos en el mapa de ruta | **REAL #981**: plotea eventos NASA EONET reales (incendios/tormentas/inundaciones) en su coordenada real. El motor `assessRouteClimate` ya los traía. |
| 4 trabajadores + 2 máquinas "fantasma" del Digital Twin (#966) | Mapa de posiciones de personal/maquinaria en vivo | **REAL #969**: `useWorkerPings` lee GPS real de los beacons de supervivencia. |
| "Próximamente" en Currículum Portátil (#967) | Lista de capacitaciones completadas | **REAL #967**: lista real desde `audit_logs`. |
| Medidores "Gas (CO)/Integridad (HP)" de juego en Telemetría (#978) | Monitoreo de atmósfera de zona (gas) | **REAL #978**: `ZoneAtmospherePanel` reusa el motor `gasGate` (umbrales O₂/LEL reales). (El "HP" era mecánica de juego sin fuente real — no era una función intencionada.) |
| Flechas de tendencia +2%/-15%/+5% en Analytics (#980) | Tendencia de KPIs | **Ya REAL**: la tendencia mensual real (incidentes/hallazgos) ya se grafica en el LineChart de la misma página. Los badges eran decoración duplicada. |
| Flecha de incidentes "¿hay alguno?" en ExecDash (#982) | Tendencia de incidentes | **REAL #982**: 30 días vs 30 días previos desde `createdAt` real. |
| "Simular IoT" inyectando evento Gemini al pipeline real (#974/#976) | Demostrar/probar telemetría IoT | **Preservado**: ahora demo local etiquetada SIMULADO. El pipeline IoT REAL (webhook HMAC `/api/telemetry/ingest`) **nunca se tocó** — sigue intacto. |

## B. Idea PRESERVADA, falta construir el pipeline real (trackeada, NO borrada)

Estas son las únicas donde el reemplazo real aún no está cableado de punta a punta. La idea está viva (motor/lectura/tipo existen); lo que falta es la tubería de datos. **Quedan como roadmap explícito, no perdidas:**

| Dato falso removido | Función intencionada | Qué falta para hacerla real |
|---|---|---|
| Curva SLO `Math.sin` (#939) | Error-budget de SLO de 30 días | La lectura real de Firestore `slo_metrics` YA existe en el código; falta el job que la **pueble** desde Sentry (Cloud Function/cron). |
| Flecha de "Cumplimiento Prom." en ExecDash (#982) | Tendencia de cumplimiento en el tiempo | Falta un **snapshot diario** de cumplimiento (colección + cron + reglas) para tener histórico que comparar. |
| Chips de color "EPP detectado" → "estimación" (#968) | Detección real de EPP por cámara | El detector por color **sigue corriendo** (honesto como estimación). Detección real necesita un **modelo entrenado de EPP** on-device (COCO/MediaPipe no tiene clases de EPP) — bloqueado por modelo, no por nosotros. |

## C. No fueron borrado de ideas (bugs / mejoras / features nuevas)

- #970 mural: **agregó** comentarios reales (feature nueva).
- #971 settings 2FA: el toggle falso → CTA real al hub MFA (`/security-shield`, que existe).
- #975 settings: **agregó** persistencia real de preferencias.
- #979 audit: arregló bugs reales (500 falso en pago; 500 en señal "ayuda" de trabajador solo).
- #972/#977/#973: perf (sin cambio de función).

## Conclusión

- **8 ideas quedaron REALES** (más fuertes que el fake).
- **3 ideas quedaron preservadas + trackeadas para construir** (SLO pipeline, snapshot de cumplimiento, modelo EPP).
- **0 propuestas/ideas eliminadas.** El diseño nunca vivió en el dato falso.
- **git conserva todo** — si decides que algo removido debe volver tal cual, se recupera en segundos.
