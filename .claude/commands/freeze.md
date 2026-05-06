---
description: Freeze a directory or file from edits during debugging — writes .claude/freeze.json
argument-hint: "--dir <path> [--reason <texto>]"
---

# /freeze — congelar scope de edición

Inspirado en `/freeze` del gstack toolkit (Garry Tan / gstack),
asimilado en forma "pirata" como artefacto local del repo.

Cuando estás debuggeando un módulo crítico (SOS path, kmsEnvelope,
verifyAuth) y querés evitar que ediciones colaterales rompan el
estado, congelás el resto del repo.

## Uso

```
/freeze --dir src/server/routes/sos.ts
/freeze --dir src/services/slm/ --reason "debug offline-queue race"
```

Acepta múltiples `--dir` repetidos.

## Comportamiento

1. Leer `$ARGUMENTS` y extraer cada `--dir <path>`.
2. Validar que cada path existe (relativo al repo root).
3. Escribir `.claude/freeze.json`:

```json
{
  "frozen": ["src/server/routes/sos.ts", "src/services/slm/"],
  "reason": "debug offline-queue race",
  "frozenAt": "2026-05-06T12:00:00Z",
  "frozenBy": "<user>"
}
```

4. Confirmar al user el scope congelado.

## Enforcement

El hook `PreToolUse` configurado en `.claude/settings.json` corre
`scripts/check-frozen.cjs` antes de cada Edit/Write. El hook lee
`freeze.json` y rechaza la op si el path destino NO está dentro de
`frozen[]`. Es decir: cuando hay freeze activo, **sólo** se puede
editar dentro del scope congelado.

Para volver a edición libre: `/unfreeze`.

## Bash a ejecutar

```bash
node -e "
const fs=require('fs');
const args=process.argv.slice(1).join(' ');
const dirs=[...args.matchAll(/--dir\\s+(\\S+)/g)].map(m=>m[1]);
const reason=(args.match(/--reason\\s+\"?([^\"]+)\"?/)||[])[1]||'';
if(!dirs.length){console.error('Need --dir');process.exit(1)}
fs.mkdirSync('.claude',{recursive:true});
fs.writeFileSync('.claude/freeze.json',JSON.stringify({
  frozen:dirs,reason,frozenAt:new Date().toISOString(),frozenBy:process.env.USER||process.env.USERNAME||'unknown'
},null,2));
console.log('Frozen:',dirs.join(', '));
" -- $ARGUMENTS
```
