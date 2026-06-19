---
name: coverage-batch
description: Run a test-coverage batch for Guardian Praeventio — create a branch from main, write tests for untested routes/services, run vitest, commit, push, create a PR, and wait for CI. Use when systematically increasing test coverage across the codebase.
---

# Coverage Batch

Systematically add tests for untested or under-tested server routes and services, then ship them as a PR. This workflow was used for batches 2–9 covering 30+ routes.

## Workflow

### 1. Identify untested targets

```bash
cd "D:/Guardian Praeventio/repo"
echo "=== untested server routes ==="
for f in src/server/routes/*.ts; do
  case "$f" in *.test.ts) continue;; esac
  base=$(basename "$f" .ts)
  if ! grep -rq "$base" src/__tests__/server/ 2>/dev/null; then
    echo "  UNTESTED: $f"
  fi
done
```

Also check services:
```bash
for f in src/services/*/index.ts; do
  dir=$(dirname "$f")
  name=$(basename "$dir")
  if ! find src/__tests__ -name "*${name}*" 2>/dev/null | grep -q .; then
    echo "  UNTESTED SERVICE: $dir"
  fi
done
```

### 2. Create branch from main

```bash
git checkout main --quiet && git pull origin main --quiet 2>&1 | tail -1
git checkout -b test/<topic>-coverage-batch<N> origin/main 2>&1 | tail -1
```

Branch naming convention: `test/<scope>-coverage-batch<N>` or `test/coverage-block<M>-wave<N>`.

### 3. Write tests

- Create test files in `src/__tests__/server/` mirroring the route structure.
- Use the existing test patterns (see `src/__tests__/server/admin.test.ts` or `billing.test.ts` as templates).
- Mock Firestore with `fakeFirestore` from `src/test/fakeFirestore.ts`.
- Target **real router behavior** — test request/response contracts, not internals.
- Fix any `z.unknown()` validation bugs discovered during testing (wrap with `.strict()` or add `.passthrough()` as appropriate).

### 4. Validate

```bash
# Typecheck
find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete 2>/dev/null
npx tsc --noEmit 2>&1 | grep -cE "error TS"

# Run only the new tests first
npx vitest run src/__tests__/server/<new-test-files> 2>&1 | tail -10

# Then run full suite to check for regressions
npx vitest run 2>&1 | tail -5
```

### 5. Commit and push

```bash
git add <test-files> [<source-files-if-bugfix>]
git commit -F - <<'EOF'
test(<scope>): <description> (<N> tests)

<brief summary of what was covered>
EOF
git push origin <branch-name> 2>&1 | tail -3
```

### 6. Create PR

```bash
gh pr create --base main --head <branch-name> \
  --title "test(<scope>): <description> (<N> tests)" \
  --body "$(cat <<'EOF'
## Summary
- <what routes/services were covered>
- <number> new tests
- <any bug fixes discovered>
EOF
)"
```

### 7. Wait for CI and merge

```bash
# Poll until checks complete
for i in $(seq 1 45); do
  state=$(gh pr view <PR_NUM> --json mergeStateStatus -q '.mergeStateStatus')
  echo "iter $i: $state"
  if [ "$state" = "CLEAN" ] || [ "$state" = "MERGEABLE" ]; then
    gh pr merge <PR_NUM> --squash --delete-branch 2>&1 | tail -2
    break
  fi
  sleep 30
done
```

## Batch Sizing

- **6 routes per batch** is the sweet spot — large enough to be efficient, small enough to review.
- Group related routes (e.g., all billing routes, all compliance routes).
- If a route requires a bug fix, include the fix in the same PR.

## Exit Conditions

- All new tests pass.
- No regressions in the full test suite.
- Typecheck clean.
- PR merged to main.

## Notes

- The project uses Vitest for testing and Firebase/Firestore as the backend.
- Many routes had `z.unknown()` validation bugs that silently accepted invalid input — fixing these during coverage work is expected and encouraged.
- After merging a batch, immediately start the next one by re-running the untested-target scan.
