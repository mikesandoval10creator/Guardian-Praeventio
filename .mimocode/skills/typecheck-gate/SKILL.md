---
name: typecheck-gate
description: Run the TypeScript typecheck gate for Guardian Praeventio — clean stale build info, run tsc --noEmit, parse errors, and report results. Use before committing, pushing, or as a pre-merge quality gate.
---

# Typecheck Gate

Run a clean TypeScript typecheck cycle and report results. This is the standard quality gate used before every commit and PR in Guardian Praeventio.

## Workflow

1. **Clean stale build info** — remove `.tsbuildinfo` files that cause false cache hits:
   ```bash
   cd "D:/Guardian Praeventio/repo"
   find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete 2>/dev/null
   ```

2. **Run typecheck** — execute `tsc --noEmit` and capture output:
   ```bash
   npx tsc --noEmit 2>&1 | tee /tmp/tsc_output.txt
   TSC_EXIT=$?
   ```

3. **Parse errors** — extract and count TypeScript errors:
   ```bash
   ERR_COUNT=$(grep -cE "error TS" /tmp/tsc_output.txt 2>/dev/null || echo 0)
   ```

4. **Report results** — structured output:
   - If `TSC_EXIT == 0` and `ERR_COUNT == 0`: report **CLEAN** — safe to commit/push.
   - If errors found: report the count and the first 20 error lines with file paths for triage.

5. **If errors found**: fix each error, then repeat from step 1 until clean.

## Exit Conditions

- **Pass**: `tsc --noEmit` exits 0 with 0 `error TS` lines.
- **Fail**: Non-zero exit or any `error TS` lines — list them and stop.

## Variations

- **Quick check** (skip clean): `npx tsc --noEmit 2>&1 | grep -cE "error TS"` — for fast iteration during active editing.
- **CI mode**: Use `npm run typecheck:ci` if available, which may include additional lint rules.
- **With lint**: Append `npm run lint 2>&1 | tail -5` after typecheck for a combined gate.

## Notes

- The `.tsbuildinfo` clean step is critical — stale cache causes phantom errors that waste cycles.
- The project uses `npx tsc --noEmit` (not `npm run typecheck`) as the primary gate in most sessions.
- JAVA_HOME must be set for Android-related builds but is not needed for pure TypeScript checks.
