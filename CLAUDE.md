# CLAUDE.md — onboarding ultra-rápido para Claude Code (web/desktop)

> Este archivo se carga automáticamente cuando Claude Code arranca en este
> repo. **Léelo de cabo a rabo en la primera sesión** — después puedes
> hacer foco en `TODO.md` + `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md`.
>
> Cierra §12.1.9 del recovery (`MASTER_PROPOSAL_2026-05.md:395` → "CLAUDE.md raíz generado").

---

## 1. Qué es Guardian Praeventio

SaaS B2B de **prevención de riesgos laborales** para Chile + LatAm + expansión global. Cumplimiento DS 54 / **DS 44/2024** (DS 40 derogado 2025-02-01) / Ley 16.744 + ISO 45001 + 11+ jurisdicciones internacionales.

**Stack:** React 19 + Vite 5 + Tailwind 3 (frontend) · Express + TypeScript strict (backend, runtime `tsx`) · Firestore (default-deny rules) · Capacitor 8 (mobile) · Gemini + Vertex AI Agent Builder (AI runtime productivo) · SLM Gemma 2 2B (browser via `@huggingface/transformers`).

**Filosofía Flow Infinito** (privada — NO mencionar en commits/docs/repo).

---

## 2. Restricciones inviolables (memoria + directivas usuario)

1. **No exponer Zettelkasten en API pública** (B2D API model).
2. **No mencionar "Flow Infinito"** en repo/commits/docs.
3. **Runtime productivo Gemini + Vertex AI Agent Builder** — Claude Code es SOLO desarrollo.
4. **Nunca bloquear maquinaria**, solo recomendar.
5. **Nunca push automático SUSESO/SII/MINSAL/OSHA** — empresa firma+entrega.
6. **Nunca XP negativo** por factores incontrolables.
7. **Datos externos como enriquecedor discreto** (no centrales).
8. **Regla TODO #1:** nada se marca ✅ sin file:line verificable.
9. **Regla TODO #3:** PRODUCIR solución (fallback determinístico), no etiquetar ni sacar.
10. **Patrón multi-agente:** worktree aislado obligatorio (`superpowers:using-git-worktrees`).
11. **Correo único empresa:** `contacto@praeventio.net`. Excepciones técnicas: `noreply@`, `marketplace-demo@`, `dahosandoval@gmail.com`.
12. **OSS-first ante problemas licencia** — forkear OSS antes de quedarse atado.
13. **Sprint K = lista de pendientes, NO archivo** — cada feature vive en su carpeta de dominio.
14. **EXTRACT propuestas antes de archivar docs** — directiva 2026-05-17.
15. **DS 44/2024 vigente** (DS 40 derogado) — toda referencia DS 40 debe tener anotación histórica.

---

## 3. Estado del repo HOY

| Dimensión | Estado |
|---|---|
| `npm test` | 10029+/10030 passing (1 todo legítimo) |
| `npm run lint` | `eslint firestore.rules src server.ts` (5 errors falsos positivos plugin) |
| `npm run typecheck` | 0 errores ✅ |
| `npm run build` | exitoso, 486 PWA precache entries |
| Mutation score | orchestrator 78.21%, promedio 46-50% |
| Bundle | 30 MB build físico, 15.6 MiB PWA |
| Páginas | 155 |
| Componentes | 372 (190 huérfanos = wire pendiente) |
| Hooks | 184 (92 huérfanos) |
| Services | 259 (53 huérfanos) |
| API routes | 167 (~294 archivos post-Sprint K modular) |
| ADRs | 17 + PLAN_MAESTRO_2026-Q3.md |
| Locales i18n | 16 idiomas |

---

## 4. Arquitectura por dominio (high-level)

```
src/
├── pages/                  155 pages — top routes
├── components/             372 components (190 huérfanos)
├── hooks/                  184 hooks (92 huérfanos)
├── services/               259 services (53 huérfanos)
│   ├── ai/                 resilientAiOrchestrator 5-tier ✅
│   ├── auth/               webauthnAssertion ✅, customClaims ✅
│   ├── billing/            mercadoPagoIpn HMAC ✅, khipuAdapter ✅
│   ├── compliance/         adapters/ (CL ✅, UK/CA/AU/JP/KR/IN scaffold)
│   ├── emergency/, sos/    SOS submit + escalation
│   ├── environment/        chileClimatology fallback determinístico
│   ├── pricing/            pricingOcPdfRenderer ✅ (Sprint K §177)
│   ├── slm/                Gemma 2 2B loader
│   ├── suseso/             diatPdfRenderer + folioGenerator atómico ✅
│   ├── zettelkasten/       core + 3 flujos flagship ✅
│   │   └── flows/          horometroMaintenanceFlow ✅
│   │                       eppInventoryPurchaseFlow ✅
│   │                       incidentLessonTrainingFlow ✅
│   ├── sensorBus/          ✅ event bus central
│   ├── battery/            batteryAdvisor ✅
│   ├── sync/conflictQueue  ✅ Firestore-backed
│   └── rag/safeNormativeQuery ✅
├── server/
│   ├── routes/             294 archivos (post-Sprint K refactor)
│   ├── middleware/         verifyAuth (session 8h MAX_SESSION_HOURS) ✅
│   └── auth/               webauthnAssertion
└── contexts/               17 contexts (AppProviders wrap)

infra/                      4 workers production-ready
infrastructure/terraform/   11 .tf (KMS 90d rotation, IAM least-privilege)
scripts/                    40 utilities (5 críticos production-ready)
docs/architecture-decisions/ 17 ADRs + PLAN_MAESTRO_2026-Q3.md (192 nodos)
docs/api/openapi.yaml       ✅ OpenAPI v1 + PGP_GENERATION.md
docs/audits/                AUDIT_EXHAUSTIVA + BRANCHES_INVENTORY + PLAN_CONTINUACION
```

---

## 5. Qué hacer al arrancar nueva sesión

1. **`cat docs/audits/PLAN_CONTINUACION_LOCAL_2026-05-19.md | less`** — plan vigente v4, prioridades por bloque
2. **`cat TODO.md | less`** — fuente única de verdad, 1357 LOC, 17 secciones
3. **`cat docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md | less`** — 3477 LOC, 32 secciones
4. **`cat docs/architecture-decisions/PLAN_MAESTRO_2026-Q3.md`** — 192 nodos 321-512 con prioridades

**Branch activa:** `claude/review-pending-tasks-aUDD2` (PR #450). HEAD post-sesión móvil intensiva (63+ commits desde `c2f391f7`). Backup: `backup/before-recovery-merge-2026-05-20`.

---

## 6. Skills recomendados por bloque

| Bloque | Skill principal |
|---|---|
| 5.1 C11 sweep `any` (204 restantes) | `everything-claude-code:typescript-reviewer` paralelo |
| 5.2 C12 sweep `as X` (538 assertions) | `typescript-reviewer` + `superpowers:tdd` |
| 3.19 C16 KnowledgeGraph useReducer | `everything-claude-code:code-architect` |
| 3.20 C17 BaseModal | `ui-ux-pro-max` + `everything-claude-code:design-system` |
| Bloque 7 generators 6 países | `superpowers:dispatching-parallel-agents` |
| §12.5.1 geminiBackend split | `code-architect` |
| Multi-país wires UI | `ui-ux-pro-max` |

---

## 7. Convenciones git

- **NO ejecutar destructive ops sin confirmar** (rm -rf, drop table, force-push main, etc.)
- **Commit messages en español** cuando contexto chileno; inglés cuando código global
- **Footer commits:** `https://claude.ai/code/session_01TGJvADjqdYAwtKfLKh2S2D`
- **Branches:** `claude/X-Y` (Claude Code) o `dev/sprint-K-feature` (sprints)
- **Tag commits Sprint K:** referenciar `§NNN` cuando aplique

---

## 8. Tests obligatorios antes de commit

```bash
npm run typecheck   # 0 errors
npm test            # passing (suite vitest)
npm run lint        # warnings OK, errors hay que justificar
npm run build       # exitoso PWA
```

Tests E2E:
```bash
npm run test:e2e          # Chromium + mobile-android
npm run test:e2e:full     # + Firestore emulator + Express E2E_FULL_STACK=1
npm run test:rules        # Firestore rules con emulator
```

Mutation:
```bash
npm run mutation          # Stryker - block en orchestrator
```

---

## 9. Day-1 mundial — métricas objetivo

- Uptime 99.9%, Response p95 <200ms, Error rate <0.1%
- Test coverage >80%, Mutation score >75%
- Lighthouse >90 (accessibility/best-practices/performance)
- E2E ponderado real >95%
- KPIs comerciales: $500K → $5M ARR 2025→2026, 500 → 2500 clientes,
  50K → 250K trabajadores protegidos

---

## 10. Si tienes dudas

- Verifica primero el `TODO.md` (puede estar respondida ahí)
- Revisa los ADRs en `docs/architecture-decisions/`
- Si decisión arquitectónica nueva → crear ADR antes de implementar
- Si decisión bloqueada por usuario → marcar `🔵 BLOQUEADO` y mover a §5 TODO

---

**Última actualización:** 2026-05-21 — Creado per directiva §12.1.9 (skill `init`-equivalente manual). Cuando se actualice arquitectura/dominios, refrescar §4 + §3 stats.
