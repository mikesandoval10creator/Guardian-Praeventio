# Safety Patterns — `/careful`, `/freeze`, `/guard`

Patrones de seguridad operativa para Claude Code en este repo.
Inspirados en el toolkit gstack de Garry Tan, asimilados en forma
"pirata" (sin instalar gstack global) como artefactos locales.
Adaptados a Praeventio: HSE app con vida humana en el SOS path.

## TL;DR

| Comando | Cuándo |
|---|---|
| `/careful` | Antes de cualquier op destructiva (rm -rf, DROP, force-push, deletes en Firestore). |
| `/freeze --dir <path>` | Durante debugging para evitar que ediciones colaterales rompan estado. |
| `/unfreeze` | Liberar el repo cuando terminó el debug. |
| `/guard --dir <path>` | Modo blindaje: combina careful + freeze. Para SOS path, KMS, verifyAuth, migraciones prod. |

## `/careful`

Activa un gate de confirmación explícita antes de:

- `rm -rf <path>`
- `DROP TABLE`, `TRUNCATE`, `DELETE FROM ... WHERE`
- `git reset --hard`, `git clean -fdx`, `git branch -D`
- `git push --force` / `--force-with-lease`
- Firestore `.delete()`, `bulkWriter.delete()`
- KMS / Secret Manager rotación o destrucción
- Sobrescritura de archivos sin diff previo

**Patrón obligatorio**: listar blast radius (count exacto de archivos
o docs afectados) → pedir ack del usuario en chat → ejecutar →
documentar el comando exacto en el commit message.

## `/freeze` + `/unfreeze`

Escribe `.claude/freeze.json` con la lista de paths editables.
Mientras existe ese archivo, el hook `PreToolUse` (configurado en
`.claude/settings.json`) corre `scripts/check-frozen.cjs` antes de
cualquier `Edit`/`Write`/`MultiEdit`/`NotebookEdit` y rechaza la op
si el path destino NO está dentro del scope congelado.

Ejemplo:

```
/freeze --dir src/server/routes/sos.ts --reason "debugging SOS retry"
# Mientras esté frozen, sólo se puede editar dentro de sos.ts.
# Cualquier intento de tocar otro archivo retorna exit 2 con mensaje.

/unfreeze   # libera
```

`freeze.json` shape:

```json
{
  "frozen": ["src/server/routes/sos.ts"],
  "reason": "debugging SOS retry",
  "mode": "freeze",
  "frozenAt": "2026-05-06T12:00:00Z",
  "frozenBy": "<user>"
}
```

## `/guard`

Combina `/careful` + `/freeze`. Banner sticky en cada respuesta
mientras esté activo. Úsalo para:

- SOS path en producción
- Refactor de `kmsEnvelope`, `verifyAuth`, Firestore rules
- Migraciones de datos en prod (`migrate-*.cjs`)
- Cualquier op marcada como "critical" en el sprint actual

## User authorization patterns

**Force-push** (`git push --force-with-lease`):
- Sólo en branches `dev/*` propias del usuario.
- NUNCA en `main`, `staging`, `prod`, `release/*`.
- Requiere ack explícito en chat. `/careful` cubre esto.

**Destructive Firestore ops**:
- Backup previo obligatorio: `node scripts/backup-firestore.cjs`.
- Si toca colección con > 1000 docs, exigir dry-run primero.
- `/guard` recomendado.

**Secret rotation**:
- Sólo via `scripts/rotate-secrets.sh`.
- `/guard --dir scripts/rotate-secrets.sh` durante el cambio.

## Cross-reference: Sprint 32 P0 — `notify-brigada`

El caso histórico que motivó este workflow: en Sprint 32 (audit P0)
una operación de overwrite ciego sobre el módulo `notify-brigada`
casi destruye lógica de fallback de notificaciones. Fue evitado por
un gut-check manual del usuario antes de aceptar el cambio.

Lección: **toda mutación a archivos en el path SOS (notify-brigada,
sosFlow, panicHandler, brigadaRouter)** debe pasar por `/guard` o
como mínimo `/careful` + diff review explícito. El gate de careful
es exactamente este gut-check formalizado en protocolo.

## Convenciones

- Los slash-commands viven en `.claude/commands/*.md` y son
  específicos del repo (no requieren instalar nada global).
- El hook viven en `scripts/check-frozen.cjs` y se activa via
  `.claude/settings.json` → `hooks.PreToolUse`.
- Cero deps nuevas: todo Node runtime puro.
- Si necesitás bypass temporal del freeze para una emergencia,
  `/unfreeze` es la única vía oficial. NO editar `freeze.json` a mano.
