---
description: Activate extra-cautious mode before destructive ops (rm -rf, DROP TABLE, git reset --hard, force-push, Firestore deletes)
argument-hint: "[descripción de la op destructiva]"
---

# /careful — extra-cautious gate

Inspirado en `/careful` del gstack toolkit (Garry Tan / gstack),
asimilado en forma "pirata" como artefacto local del repo.

Antes de ejecutar **cualquier** operación destructiva, seguí este
protocolo:

## Operaciones cubiertas

- `rm -rf <path>`
- `DROP TABLE`, `TRUNCATE`, `DELETE FROM ... WHERE`
- `git reset --hard`, `git clean -fdx`, `git branch -D`
- `git push --force` / `--force-with-lease`
- Firestore: `.delete()`, `bulkWriter.delete()`, batch deletes
- KMS / Secret Manager: rotación o destrucción de versiones
- File-system writes que sobrescriben archivos sin diff previo
  (ej: el caso histórico de `notify-brigada` en Sprint 32 P0 donde
  un overwrite ciego fue evitado por un gut-check similar)

## Protocolo

1. **Listar el blast radius**. Antes del comando, mostrá:
   - Archivos / tablas / docs afectados (count exacto).
   - Si es git: `git status` + `git log --oneline -5`.
   - Si es Firestore: query de `count()` sobre el rango a borrar.
2. **Pedir confirmación explícita** del user en el chat. NO asumir
   que la frase "dale" inicial cubre el destructivo.
3. **Verificar backup**. Si toca producción, exigir snapshot reciente
   (`scripts/backup-firestore.cjs` o equivalente).
4. **Documentar en commit message** la razón + el comando exacto +
   el revisor humano.
5. **Si el módulo está frozen** (ver `.claude/freeze.json`), abortar
   y avisar al user — `/unfreeze` requerido primero.

## Fallback

Si el user dice "ya, hacelo" sin haber pasado por el protocolo,
respondé:

> "Antes de ejecutar [op] necesito confirmar el blast radius.
>  Voy a listar [N] archivos/docs afectados; ¿confirmás?"

NO ejecutar destructivo sin ese ack.
