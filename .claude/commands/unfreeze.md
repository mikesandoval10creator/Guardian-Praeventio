---
description: Remove the freeze lock — deletes .claude/freeze.json so edits are allowed everywhere again
---

# /unfreeze — liberar scope de edición

Inspirado en `/unfreeze` del gstack toolkit (Garry Tan / gstack),
asimilado en forma "pirata" como artefacto local del repo.

Inverso de `/freeze`: borra `.claude/freeze.json` para volver a la
edición libre del repo.

## Bash a ejecutar

```bash
node -e "
const fs=require('fs');
const p='.claude/freeze.json';
if(!fs.existsSync(p)){console.log('No freeze active.');process.exit(0)}
const cur=JSON.parse(fs.readFileSync(p,'utf8'));
fs.unlinkSync(p);
console.log('Unfrozen. Was:',JSON.stringify(cur.frozen));
"
```

Después de ejecutar, confirmá al user que el repo está editable
nuevamente y mencioná qué scope estaba congelado.
