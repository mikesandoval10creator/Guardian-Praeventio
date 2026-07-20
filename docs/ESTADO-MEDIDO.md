# Estado medido — generado, no escrito a mano

> **No editar a mano.** Lo genera `scripts/gen-measured-state.cjs` desde los
> baselines de los ratchets. Para actualizarlo: `npm run gen:measured-state`
> y commitear el resultado.
>
> Existe porque el 2026-07-20 se midió que `docs/PENDIENTE.md` afirmaba 39
> huérfanos y 10 routers sin cobertura cuando el código tenía 4 y 0. Un
> contador escrito a mano envejece en silencio y manda a trabajar en problemas
> ya resueltos.

## Contadores

| Dimensión | Valor | Lo mide |
| --- | --- | --- |
| Huérfanos (construido, sin montar) | 4 | `connectivity-ratchet` |
| Componentes fantasma (importados, no renderizados) | 16 | `render-ratchet` |
| Routers de backend | 205 | `router-test-ratchet` |
| Routers con test conductual real | 205 | `router-test-ratchet` |
| Routers sin cobertura conductual | 0 | `router-test-ratchet` |
| Usos de `as any` | 155 | `any-ratchet` |

## Qué NO mide este archivo

Estos contadores describen la **estructura** del código: si algo está montado,
renderizado y cubierto por un test que ejercita el código real. No dicen que la
función haga lo que promete en un teléfono, ni que esté desplegada.

- La **deuda funcional pendiente** vive en Notion (tablero Alpha 41 — Tasks).
- Lo que un test **no puede** verificar (supervivencia en segundo plano,
  sensores, entrega real de notificaciones) sólo se comprueba en terreno.
