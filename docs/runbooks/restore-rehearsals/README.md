# DR Restore Rehearsals

Evidencia fechada de los simulacros mensuales de restauración (DR_RUNBOOK.md §3.4).

Pipeline: `npm run test:dr-restore` ejecuta `scripts/run-dr-rehearsal.ts`, que corre
`restore-firestore.cjs --dry-run` contra el último export y vuelca un reporte
`YYYY-MM.md` con RPO/RTO fechados.

Si falla: abrir issue P1 etiquetado `dr-rehearsal-failure` y notificar a
`contacto@praeventio.net`.
