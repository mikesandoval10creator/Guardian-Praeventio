<!-- M23: PR template mirroring CLAUDE.md "Git workflow" pre-PR gate -->
## Descripcion / Description

<!-- What does this PR do? Why? -->

## Cambios / Changes

- 

## Checklist pre-PR

<!-- Mark all that apply. Do NOT merge if any unchecked box is a blocker. -->

### Gate basico / Basic gate
- [ ] `npm run typecheck` — 0 errores TypeScript
- [ ] `npm run test:ci` — tests green (o `test.skip` con issue linkeado)
- [ ] `npm run build` — build exitoso sin warnings nuevos
- [ ] `npm run lint` — sin errores en archivos tocados
- [ ] Copia en castellano (es-CL) revisada — sin placeholders `[TODO]`

### Seguridad / Security
- [ ] Cambios de estado cubiertos con `audit_logs` (si aplica)
- [ ] Sin secrets staged (`git diff --staged` revisado)
- [ ] Reglas Firestore/Storage actualizadas si hay nuevas colecciones

### Ratchets (no bajar ninguno)
- [ ] Ratchet #21 conectividad — `npm run lint:connectivity` verde
- [ ] Ratchet #22 router-tests — `npm run lint:router-tests` verde
- [ ] Ratchet #23 render — (snapshot count no decrece)
- [ ] Ratchet #24 scope — cambios en archivos coherentes con el titulo del PR

### Scope guard (anti-#1039)
- [ ] **El scope del PR coincide con el titulo** — sin bajas colaterales de archivos no relacionados (assets, skills, configs de otros features)

## PR tipo / PR type

- [ ] Feature nueva
- [ ] Bug fix
- [ ] Refactor / deuda tecnica
- [ ] Seguridad / critico
- [ ] Docs / DX
- [ ] Life-safety (requiere review adicional)

## Evidencia / Evidence

<!-- Screenshot, test output, o log relevante -->
