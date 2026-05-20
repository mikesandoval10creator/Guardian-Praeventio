# Plan continuación Guardian-Praeventio — v2 post-merge recovery

> **Versión 2 — 2026-05-20.** Estado actualizado tras cherry-pick exitoso de 11 commits de `recovery/local-main-2026-05-18`. Verificación contra código HOY + tests passing. Reemplaza v1 (2026-05-19).

---

## 1. ESTADO ACTUAL VERIFICADO 2026-05-20 (post-merge)

### Tests verdes ✅
- `npm test` exit 0 — **0 failures**
- Sin regresiones por el merge

### PR #450
- Branch: `claude/review-pending-tasks-aUDD2` (HEAD `ef6bb036`)
- Commits: 66+ totales (34 míos + 11 recovery + 21 previos)
- Backup safety: `backup/before-recovery-merge-2026-05-20`
- TypeScript: limpio (único error preexistente `onboarding.test.ts:327`)
- Build: `npm run build` ✅ 486 PWA entries

### Métricas verificadas HOY

| Métrica | Valor |
|---|---|
| `any` en signatures | 353 |
| Type assertions `as X` | 538 |
| Branches origin | 216 (cleanup pendiente) |
| Sprint K routes modularizadas | 294 |
| ADRs en `architecture-decisions/` | 17 (incl. 0005 v4, 0019, 0020) |
| Docs archivados `archive/2026-05/` | 13 ✅ recovery |
| `src/services/compliance/adapters/` | solo `cl/` (frontend multi-país pendiente) |

---

## 2. RE-MAPEO bloques plan vs estado real

### ✅ BLOQUE 1 — P0 seguridad/CI: **11/11 COMPLETO**

| Item | Estado | Commit |
|---|---|---|
| 1.1 C20 fix CI Playwright ErrorBoundary | ✅ | `29baf4c1` |
| 1.2 C6 OAuth AbortController + fetchWithTimeout util | ✅ | `c3c3aa23` |
| 1.3 C7 sweep fetch Gemini/OpenWeather (11 sitios) | ✅ | `c3c3aa23` |
| 1.4 C8 OAuth Idempotency-Key per-identity lock | ✅ | `dd0b8724` |
| 1.5 D9 WebAuthn credentialId pin base64url | ✅ | `84324d87` |
| 1.6 B2 photogrammetry worker auth bypass | ✅ | `df5cb9e7` |
| 1.7 B1 catch-all SPA Webpay (mount billing antes) | ✅ | `bf478812` |
| 1.8 B4 FCM SW keys build-time inject | ✅ | `7882ee00` |
| 1.9 B8 AASA TEAMID | 🔵 bloqueado Apple Dev | — |
| 1.10 C9 mutation orchestrator 7.69%→**78.21%** | ✅ | `6ce5afe0` |
| 1.11 C10 10 tests rutas críticas (todos verificados) | ✅ | varios |

### ✅ BLOQUE 2 — Governance: **6/7**

| Item | Estado |
|---|---|
| 2.1 ADR 0005 v4 on-device WASM | ✅ |
| 2.2 Bulk delete 213 branches huérfanas | ❌ (216 branches aún) |
| 2.3 EXTRACT 50 propuestas archive→TODO §16 | ✅ recovery `15d80eff` |
| 2.4 Archivar 13 docs históricos | ✅ recovery `e9c3acd9` |
| 2.5 Sweep H5 correos `contacto@praeventio.net` | ✅ |
| 2.6 Tests contratos anti-drift (5 dominios) | ✅ |
| 2.7 COMPETITORS.md draft | ✅ |
| **BONUS** ADR 0019 Google ecosystem | ✅ |
| **BONUS** ADR 0020 P2P heavy compute | ✅ |
| **BONUS** COST_MODEL.md | ✅ |

### ✅ BLOQUE 3 — Wire huérfanos: **~85%**

| Subbloque | Estado |
|---|---|
| Wave 1 (Sprint G — loneWorker, restrictedZones, hazmat, audit-portal) | ✅ |
| Wave 2 (Sprint H/I — evacuation, stoppage, riskRanking, equipmentQR) | ✅ |
| Wave 3 (Sprint I — 6 servicios más) | ✅ |
| Sprint J wires (9/10 hooks) | 🟡 falta `useLegalObligations.ts` (route+test SÍ existen) |
| **Recovery: 12 zero-consumer engines** (47 endpoints + 12 hooks + 12 contract tests) | ✅ `73e2bf34` |
| 3.19 C16 KnowledgeGraph 16 useState→useReducer | ❌ |
| 3.20 C17 50 Modal→BaseModal | ❌ |
| 3.21 C18 4 imgs sin alt | ❌ |
| 3.22 C19 3 `key={index}` | ❌ |

### ✅ BLOQUE 4 — Flujos ZK flagship: **3/3 COMPLETO**

| Flujo | LOC + tests | Commit |
|---|---|---|
| 4.1 Horómetro→Mantenimiento | 705 + 501 tests | `7ba58a15` |
| 4.2 Inspección EPP→Inventario→OC | 871 + 493 | `c750a568` |
| 4.3 Accidente→Lección→Capacitación | 904 + 578 | `2e143e06` |

### 🟡 BLOQUE 5 — Type safety: **6/10**

| Item | Estado |
|---|---|
| 5.1 C11 sweep 353 `any` → `unknown` | ❌ |
| 5.2 C12 sweep 538 type assertions → zod | ❌ |
| 5.3 C13 Sentry spans 11 hot paths | ✅ |
| 5.4 C14 distributedLock Firestore per-tenant | ✅ |
| 5.5 C15 geminiService boundary doc | ✅ |
| 5.6 D2 lint real TS/TSX | ❌ (`eslint firestore.rules` solo) |
| 5.7 D7 oauthTokenStore comentario | ✅ |
| 5.8 D8 README claim mutation/lint | ❌ |
| 5.9 D10 vitest exclude rules-tests | ✅ |
| 5.10 D11 alert()→useToast() | ✅ |

### 🟡 BLOQUE 6 — Performance: **1/3**

- 6.1 D12 Vite manualChunks → 🟡 existe parcial, verificar MediaPipe+Three cobertura
- 6.2 D3 backend tsc → dist/server → ❌
- 6.3 D4 .npmrc legacy-peer-deps audit → ❌

### 🟡 BLOQUE 7 — Compliance multi-país: **backend ✅, frontend ❌**

- 7 backend jurisdicciones (UK/CA/AU/JP/KR/IN) → ✅ recovery `aa1bdd59`
- 7 Coach IA 5 dominios + medical catalogs → ✅ recovery
- 7 frontend citation snippets dinámicos → ❌
- 7 adapters `compliance/adapters/{uk,ca,au,jp,kr,in}/` → ❌ (solo `cl/`)
- 7 tests E2E por país → ❌

### 🟡 BLOQUE 8 — Día-1 prep: **4/8**

| Item | Estado |
|---|---|
| 8.1 C3 photogrammetry dedup | ✅ ADR 0005 v4 resuelve (on-device WASM) |
| 8.2 C4 marketplace pricing enum | ❌ |
| 8.3 C5 landing.spec un-skip | 🟡 sub-tests algunos; `test.skip` línea 24 aún |
| 8.4 D5 Pricing OC PDF formal | ❌ (`pdf_emission_pending_sprint_k_177`) |
| 8.5 D-IND catálogo 500+ industrias SII | ❌ |
| 8.6 D-KPI integrar KPIs Day-1 | ✅ |
| 8.7 C2 iOS native | 🔵 bloqueado Apple Dev |
| 8.8 D14 Mobile CI/CD | 🔵 bloqueado |

### 🆕 NUEVAS de recovery (no en plan original)

| Item | Commit | Valor |
|---|---|---|
| F.25 PIN Sign + 5 contract tests | `a8c51ee2` | Componente + service |
| 3 puentes arquitectónicos críticos §12.2 | `af078b1d` | rag/safeNormativeQuery + sensorBus + sync/conflictQueue (1492 LOC) |
| Session 8h expiration + WebAuthn flaky fix | `e030991a` | TODO §12.2.9 cerrado |
| OpenAPI v1 spec + PGP procedure | `fdf48fe6` | `docs/api/openapi.yaml` + contract test |
| SSE Gemini streaming + medicalAnalysis split | `9caf2cea` | `useStreamedGuardian`, `services/gemini/_shared`, `medicalAnalysisBackend` |
| batteryAdvisor + assignedSiteIds custom claim | `ef6bb036` | `services/auth/customClaims`, `services/battery/batteryAdvisor` |

---

## 3. PLAN DE CONTINUIDAD — qué FALTA, orden estricto

### 🔴 P0 inmediato (cierres rápidos, ~1-2 días)

| Orden | ID | Item | Esfuerzo | Skill |
|---|---|---|---|---|
| 1 | **3.5 hook** | Crear `src/hooks/useLegalObligations.ts` | 2h | — |
| 2 | **2.2** | Bulk delete 213 branches huérfanas | 1-2h | — |
| 3 | **5.6 D2** | Lint real cubrir TS/TSX (deps ya devDep) | 1 día | `everything-claude-code:build-fix` |
| 4 | **5.8 D8** | README update claim mutation/lint | 10min | `everything-claude-code:update-docs` |
| 5 | **8.3 C5** | Auditar landing.spec test.skip línea 24 | 1h | — |
| 6 | **Fix `onboarding.test.ts:327`** | Tuple index error (mi commit `5fb9c91f`) | 15min | — |

### 🟡 GRANDES sweeps (skill-required)

| Orden | ID | Item | Esfuerzo | Skill clave |
|---|---|---|---|---|
| 7 | **5.1 C11** | 353 `any` → `unknown` | 1 sprint | `typescript-reviewer` paralelizar por dominio |
| 8 | **5.2 C12** | 538 type assertions → zod | 1 sprint | `typescript-reviewer` + `superpowers:tdd` |
| 9 | **3.19 C16** | KnowledgeGraph useReducer | 1 día | `code-architect` |
| 10 | **3.20 C17** | 50 Modal → BaseModal | 1 sprint | `ui-ux-pro-max` + `design-system` |
| 11 | **3.21 C18** | 4 imgs sin alt | 1h | `a11y-architect` |
| 12 | **3.22 C19** | 3 `key={index}` | 30min | — |

### 🟡 BLOQUE 7 frontend completar

| Orden | Item | Esfuerzo |
|---|---|---|
| 13 | Wire UI 6 países (UK/CA/AU/JP/KR/IN) citation snippets | 1-2 sem (6 worktrees) |
| 14 | Crear adapters `compliance/adapters/{uk,ca,au,jp,kr,in}/` | 1 sprint |
| 15 | Tests E2E por país con mock localidad | 1 sem |

### 🟢 Bloques 6 + 8 finishes

| Orden | ID | Esfuerzo |
|---|---|---|
| 16 | 6.1 D12 verificar manualChunks MediaPipe+Three cobertura | 2h |
| 17 | 6.2 D3 backend tsc → dist/server/ | 1 día |
| 18 | 6.3 D4 .npmrc audit + OSS replacements | 2-3 días |
| 19 | 8.2 C4 marketplace pricing enum | 30min |
| 20 | 8.4 D5 Pricing OC PDF (reusar `diatPdfRenderer.ts`) | 1 día |
| 21 | 8.5 D-IND auditar 500+ industrias SII | 4h |

### 🔵 Bloqueados externamente

- 8.7 C2 iOS native (Apple Dev Account)
- 8.8 D14 Mobile CI/CD (post keystore)
- 1.9 B8 AASA TEAMID (Apple Dev)

### ⏸ Bloque 9 long-tail Day-1+

- D6 `tsconfig.allowJs` eliminar
- D13 EU AI Act compliance audit
- Sprint K remaining ~85 items
- Sprint L 9 sub-épicas
- API Gateway Enterprise (B2B)
- Marketplace Add-ons
- Blockchain certificaciones (viem/ethers OSS)
- Computer Vision EPP edge TFLite
- Voice AI manos libres extender
- Digital Twin completo
- AR/VR mantenimiento
- Risk Forecaster ML predictivo
- 50 propuestas TODO §16 priorizar

---

## 4. RESUMEN EJECUTIVO

### Progreso global
- Bloque 1: 11/11 ✅
- Bloque 2: 6/7 ✅
- Bloque 3: ~85% ✅
- Bloque 4: 3/3 ✅
- Bloque 5: 6/10 ✅
- Bloque 6: 1/3 🟡
- Bloque 7: backend ✅, frontend ❌
- Bloque 8: 4/8 (2 bloqueados)

**Completitud total estimada: ~75%** + bonus recovery (PIN Sign + 3 puentes + OpenAPI + SSE + batteryAdvisor + Coach IA + jurisdicciones backend + 12 zero-consumer engines).

### Esfuerzo restante Day-1
**~6-8 semanas-dev** (era 13 sem en v1 del plan). Reducción por:
- Bloque 3 wave 4 → ya hecho via recovery
- Bloque 4 flujos ZK → completos
- Bloque 5 4 items → completos
- Bloque 7 backend → hecho via recovery

### Próximos pasos orden estricto

**HOY desde móvil:**
1. `useLegalObligations.ts` hook (2h)
2. Bulk delete branches (1-2h)
3. Verificar landing.spec.ts:24 (1h)

**Escritorio con skills:**
4. D2 lint real (`build-fix`, 1 día)
5. C11+C12 sweeps masivos (`typescript-reviewer`, 2 sprints)
6. C16+C17+C18 refactors UI (`ui-ux-pro-max`+`code-architect`, 1 sprint)
7. Bloque 7 frontend 6 países (`dispatching-parallel-agents`, 2 sem)
8. Bloques 6+8 finishes (1 sem)

**Day-1+:**
9. Bloque 9 long-tail

---

## 5. RESTRICCIONES INVIOLABLES

1. No exponer Zettelkasten en API pública (B2D model)
2. No mencionar "Flow Infinito" en repo/commits/docs
3. Runtime productivo Gemini + Vertex AI Agent Builder
4. Nunca bloquear maquinaria, solo recomendar
5. Nunca push automático SUSESO/SII/MINSAL/OSHA
6. Nunca XP negativo por factores incontrolables
7. Datos externos como enriquecedor discreto
8. Regla TODO #1: nada se marca ✅ sin file:line
9. Regla TODO #3: PRODUCIR solución (fallback determinístico)
10. Patrón multi-agente: worktree aislado obligatorio
11. **Correo único `contacto@praeventio.net`**
12. **OSS-first ante problemas licencia**
13. **Sprint K = lista de pendientes, NO archivo** (294 routes modulares ✅)
14. **EXTRACT propuestas antes de archivar docs** (✅ §16 TODO)
15. **DS 44/2024 vigente** (DS 40 derogado, con anotación histórica)

---

## 6. SKILLS LOCALES — mapeo por bloque

(Mismo mapeo que v1 — 45+ skills mapeadas por bloque. Ver versión anterior para detalle completo.)

**Skills clave por bloque restante:**

| Bloque | Skill principal |
|---|---|
| P0 inmediato (3.5, 5.8, 8.3) | — (sin skill) |
| 5.6 D2 lint | `everything-claude-code:build-fix` |
| 5.1 C11 + 5.2 C12 | `everything-claude-code:typescript-reviewer` |
| 3.19 C16 | `everything-claude-code:code-architect` |
| 3.20 C17 | `ui-ux-pro-max` + `design-system` |
| 3.21 C18 | `everything-claude-code:a11y-architect` |
| Bloque 7 frontend | `superpowers:dispatching-parallel-agents` (6 worktrees) |
| 6.1 D12 | `everything-claude-code:performance-optimizer` |
| 8.4 D5 PDF | `everything-claude-code:doc-updater` |

---

## 7. ARCHIVOS DE REFERENCIA POST-MERGE

| Archivo | Contenido |
|---|---|
| `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` | 3433 LOC, 31 secciones |
| `docs/audits/BRANCHES_INVENTORY_2026-05-19.md` | 214 branches tabla |
| `docs/audits/PLAN_CONTINUACION_LOCAL_2026-05-19.md` | **Este doc v2 actualizado** |
| `TODO.md` | ~1300 LOC, §16 50 propuestas recovery |
| `docs/architecture-decisions/0005-photogrammetry-pipeline.md` | v4 on-device WASM |
| `docs/architecture-decisions/0019-google-ecosystem-foundation-oss-critical-complement.md` | nuevo |
| `docs/architecture-decisions/0020-peer-to-peer-heavy-compute-via-google-drive.md` | nuevo |
| `docs/api/openapi.yaml` | recovery — OpenAPI v1 spec |
| `docs/security/PGP_GENERATION.md` | recovery — proc completo |
| `docs/COMPETITORS.md` | 6 competidores + diferenciadores |
| `docs/COST_MODEL.md` | modelo de costos on-device WASM |

**Comando inicial recomendado nueva sesión local:**
```bash
git fetch origin
git checkout claude/review-pending-tasks-aUDD2
git pull
cat docs/audits/PLAN_CONTINUACION_LOCAL_2026-05-19.md | less
# Empezar con item 1 de la sección §3 (useLegalObligations hook)
```

---

## 8. VERIFICACIÓN END-TO-END Day-1

- `npm test` ✅ exit 0, 0 failures (verificado 2026-05-20)
- `npm run test:e2e:full` Playwright passing
- `npm run test:rules` Firestore rules
- `npm run mutation` ≥75% (orchestrator 78.21% ya ✅)
- `npm run lint` 0 errors (tras D2)
- `npm run typecheck` 0 errors (tras fix `onboarding.test.ts:327`)
- `npm run build` ✅ 486 PWA entries
- Lighthouse ≥90/90/80
- CI 8/8 workflows verdes 7 días

---

**Última actualización:** 2026-05-20 — post-merge `recovery/local-main-2026-05-18` (11 cherry-picks exitosos). Estado real consolidado. Esfuerzo restante: ~6-8 sem (era 13). Backup: `backup/before-recovery-merge-2026-05-20`.
