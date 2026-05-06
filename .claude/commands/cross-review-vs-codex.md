---
description: Cross-review combining local skeptical agent + OpenAI Codex CLI (if installed). Produces overlap analysis. Falls back to /cross-review if codex CLI absent.
argument-hint: "<pr-number | branch-ref> [--base <ref>] [--strict]"
allowed-tools: Bash, Read, Grep, Glob
---

# /cross-review-vs-codex — Hybrid cross-model review

Versión más cara de `/cross-review`. Si el user instala OpenAI Codex
CLI (`codex` en PATH), corre el review nativo de Codex y compara con
el adversarial agent local. Si Codex CLI no está instalado, cae a
`/cross-review` puro (Pattern A) y lo reporta como tal.

> Sprint 40 default: NO tenemos OpenAI API key ni dep. Este comando
> existe para que cuando el user habilite gstack opt-in en Sprint
> 41+ (decisión `feedback_skill_first_heuristic`), el flujo ya esté
> tendido.

## Procedimiento

### 1. Detectar Codex CLI

```bash
if command -v codex >/dev/null 2>&1; then
  CODEX_AVAILABLE=1
  codex --version
else
  CODEX_AVAILABLE=0
  echo "[cross-review-vs-codex] codex CLI NOT installed — falling back to Pattern A"
fi
```

Si `CODEX_AVAILABLE=0`:
- Ejecutá el procedimiento entero de `/cross-review`.
- En el reporte final marcá `mode: pattern-a-fallback` y stop.

### 2. (Solo si Codex disponible) Run Codex review

Resolver target igual que `/cross-review` (PR # o branch).

```bash
# Adaptar al CLI real que el user instale.
# Plantilla; verificá `codex --help` antes de correr en prod.
codex review \
  --diff "$BASE...$HEAD" \
  --output json \
  ${STRICT:+--strict-mode} \
  > /tmp/codex-review.json
```

Captura el JSON. Si Codex falla (rate-limit, 5xx), loggealo y
continuá con Pattern A solo.

### 3. Run Pattern A en paralelo

Ejecutá las 3 pasadas adversariales del `/cross-review` (Logic /
Security / Performance) y guardá hallazgos en estructura paralela.

### 4. Overlap analysis

Construí 4 buckets:

| Bucket | Descripción |
|---|---|
| **AGREE-CRITICAL** | Codex y agent coinciden en hallazgo Critical/High |
| **AGREE-MINOR** | Coinciden pero severity baja |
| **CODEX-ONLY** | Solo Codex lo flagged — revisá si es false positive del modelo distinto |
| **AGENT-ONLY** | Solo agent lo flagged — Codex podría no ver dominio Praeventio |

`AGREE-CRITICAL` → confianza alta, FAIL gate.
`CODEX-ONLY` y `AGENT-ONLY` → manual triage humano.

### 5. Output

```markdown
# Cross-review hybrid — <target> — <date>

## Mode
- pattern-a-fallback / hybrid (codex + agent)

## Codex output
- model: <codex model id>
- findings: N (Critical: N, High: N, ...)

## Agent (Pattern A) output
- findings: N (...)

## Overlap matrix
| Categoría | AGREE-CRITICAL | AGREE-MINOR | CODEX-ONLY | AGENT-ONLY |
|---|---|---|---|---|
| Logic     | | | | |
| Security  | | | | |
| ...       | | | | |

## Hallazgos críticos consolidados
(union de AGREE-CRITICAL)

## Veredicto
<PASS|FAIL> — gate basado en AGREE-CRITICAL >= 1.
```

Save a `reports/codereview/cross-review-hybrid-<target>-<date>.md`.

## Reglas

- NO instales `codex` automáticamente. El user decide cuándo opt-in.
- NO mandes diff a Codex si la branch contiene paths sensibles
  (`zettelkasten/`, `.env*`, `secrets/`). En ese caso degradá a
  Pattern A puro y avisá en el reporte.
- NO commitees el reporte. El user decide.
