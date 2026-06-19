# Ponytail — procedencia e instalación local

**Qué es:** skill para agentes de IA que empuja hacia la solución más simple/corta
("lazy senior dev": YAGNI → stdlib → nativo → una línea). Útil para **auditar
deuda técnica de sobre-ingeniería**.

- **Fuente:** https://github.com/DietrichGebert/ponytail (plugin v4.7.0)
- **Licencia:** MIT
- **Instalado:** 2026-06-18 — copia manual de los `SKILL.md`, revisados a mano.

## Qué se instaló (y qué NO)

Instalación **detección on-demand, project-scoped**. Solo se copiaron los 6
skills de prompt (`ponytail`, `ponytail-audit`, `ponytail-review`,
`ponytail-debt`, `ponytail-gain`, `ponytail-help`).

**NO se instalaron** los hooks de auto-activación (`hooks/*.js`), el MCP server,
ni la statusline. Es decir: **no cambia el comportamiento por defecto de cada
sesión** y **no corre código automático**. Los skills se usan invocándolos:

- `/ponytail-audit` — auditoría de sobre-ingeniería de todo el repo (reporte
  rankeado: `delete`/`stdlib`/`native`/`yagni`/`shrink`). No aplica cambios.
- `/ponytail-review` — lo mismo sobre un diff.
- `/ponytail-debt` — recolecta comentarios `ponytail:` en un ledger de deuda.
- `/ponytail` `[lite|full|ultra]` — modo "lazy" para escribir código nuevo.
- `/ponytail-gain`, `/ponytail-help` — scoreboard y ayuda.

## Auditoría de seguridad realizada antes de instalar

- Hooks (388 líneas Node): solo `fs`/`path`/`os`. Sin red, sin `child_process`/
  `exec`, sin lectura+envío de secretos. (No instalados de todos modos.)
- Skills: prompts puros. El de auditoría **solo lista**, no edita.

## Upgrade al plugin completo (opcional, si se quiere modo "lazy" siempre activo)

```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```
Eso añade los hooks (modo auto-activo en cada sesión) + statusline, a nivel
global (no project-scoped). Considerar que en una app de seguridad de vidas el
modo "lazy" tiene guardas ("never simplify away: validation, error handling,
security, accessibility") pero igual conviene evaluarlo.

## Desinstalar

Borrar `.claude/skills/ponytail*`. Sin estado global que limpiar (no se
instalaron hooks ni config en `~/`).
