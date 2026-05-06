---
description: Weekly retrospective — runs scripts/retro-weekly.cjs then synthesizes human narrative on top of stats
argument-hint: "[--from YYYY-MM-DD] [--to YYYY-MM-DD] [--author <name>]"
allowed-tools: Bash, Read, Grep, Glob
---

# /retro — Weekly retrospective

Inspirado en `/retro` del gstack toolkit (Garry Tan / gstack).
Asimilado en forma "pirata" Sprint 40: el grunt work (parsing git
log + PRs + test delta) lo hace `scripts/retro-weekly.cjs` local, sin
deps nuevas. Vos (Claude) leés ese reporte y agregás insights
cualitativos que un script no puede inferir.

## Procedimiento

### 1. Correr el generator

```bash
npm run retro:weekly -- $ARGUMENTS
```

Si `$ARGUMENTS` está vacío usa default (últimos 7 días, todos los
autores). Output: `reports/retro/week-of-<YYYY-MM-DD>.md`.

Si el script imprime que `gh CLI not available`, NO falla — solo
omite el bloque de PRs. Avisar al user que para tener PR coverage
puede instalar gh y volver a correr.

### 2. Leer el reporte generado

```bash
cat reports/retro/week-of-<from>.md
```

Tomar:
- per-author commit counts.
- top feats / fixes / refactors.
- risk flags (force pushes, no-test PRs, high churn).
- breaking commits.

### 3. Sintetizar narrativa humana

Encima de los stats, escribir 4-6 párrafos cubriendo:

#### A. Theme de la semana
¿Qué dominio absorbió más energía? (security, e2e, médico, mobile,
UX 4-modes, B2D APIs, Bernoulli/Euler, etc.) Inferir desde scopes
y high-churn files.

#### B. Wins
- Features merged que cierran deuda técnica documentada en
  `MEMORY.md` (ej: brechas A/B/C/D, multi-agent buckets, etc.).
- Test coverage delta positivo.
- Cierre de PRs viejos.

#### C. Riesgos / Drag
- Force pushes → ¿qué branch? ¿conscious rebase o accidente?
- PRs sin tests → flag para review humano antes de Day-1 launch.
- Breaking commits → ¿hay migration path documentado?
- High-churn files → ¿están refactor-pending o son hot path
  estable?

#### D. Sprint cycle health
¿Cuántos PRs abiertos vs merged? ¿hay backlog acumulándose?
Si `dev/multiagent-bernoulli-sweep` u otras feature branches
siguen sin merge, llamarlo.

#### E. Recomendación para la próxima semana
3 acciones concretas, priorizadas. Usar lenguaje directo, no
corporate speak.

### 4. Append narrativa al reporte

Reabrir `reports/retro/week-of-<from>.md` y append una sección:

```markdown
## Narrativa (Claude synthesis)

### Theme
...

### Wins
...

### Riesgos
...

### Sprint cycle
...

### Recomendaciones próxima semana
1. ...
2. ...
3. ...
```

### 5. Output al chat

Imprimir resumen ejecutivo (5 bullets max) + path al reporte completo.

## Reglas

- NO commitees el reporte (queda en `reports/retro/` para review).
- NO inventes stats. Si el script no produjo un dato (ej: gh CLI
  ausente), reportá la ausencia, no rellenes con suposiciones.
- NO menciones nombres de autores fuera del reporte (privacidad).
- Si la narrativa contradice los stats, ganan los stats — chequeá tu
  inferencia.
