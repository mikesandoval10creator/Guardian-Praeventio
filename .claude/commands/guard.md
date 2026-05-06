---
description: Combined careful + freeze — maximum safety mode for high-stakes ops (SOS path, KMS, verifyAuth, prod migrations)
argument-hint: "--dir <path> [--reason <texto>]"
---

# /guard — modo blindaje total

Inspirado en `/guard` del gstack toolkit (Garry Tan / gstack),
asimilado en forma "pirata" como artefacto local del repo.

Combina `/careful` + `/freeze` en una sola activación. Úsalo cuando:

- Vas a tocar el SOS path en producción
- Refactor de `kmsEnvelope` / `verifyAuth` / Firestore rules
- Migración de datos en producción (`migrate-*.cjs`)
- Cualquier op que el user marcó como "critical" en este sprint
  (Sprint 40: gstack-pirate / cso / canary / codex)

## Procedimiento

1. **Activar freeze** sobre el scope target (ver `/freeze`):
   - Llamar al mismo bash de `/freeze` con los `--dir` recibidos.
2. **Activar careful** (ver `/careful`):
   - Antes de cualquier op destructiva, listar blast radius y pedir
     confirmación explícita.
3. **Anunciar al user** ambos guards activos:

   ```
   /guard activo:
     - Freeze scope: <paths>
     - Careful gate: ON (todas las ops destructivas requieren ack)
   ```

4. **Sticky reminder**: al inicio de cada respuesta mientras esté
   activo, recordá brevemente "(/guard activo, scope: X)".

## Cómo desactivar

```
/unfreeze   # libera el scope
```

El gate de careful se considera implícitamente OFF cuando se libera
el freeze, salvo que el user pida mantenerlo.

## Bash inicial

```bash
node -e "
const fs=require('fs');
const args=process.argv.slice(1).join(' ');
const dirs=[...args.matchAll(/--dir\\s+(\\S+)/g)].map(m=>m[1]);
const reason=(args.match(/--reason\\s+\"?([^\"]+)\"?/)||[])[1]||'/guard activated';
if(!dirs.length){console.error('Need --dir');process.exit(1)}
fs.mkdirSync('.claude',{recursive:true});
fs.writeFileSync('.claude/freeze.json',JSON.stringify({
  frozen:dirs,reason,mode:'guard',
  frozenAt:new Date().toISOString(),
  frozenBy:process.env.USER||process.env.USERNAME||'unknown'
},null,2));
console.log('GUARD MODE active. Frozen scope:',dirs.join(', '));
console.log('Careful gate: ON.');
" -- $ARGUMENTS
```
