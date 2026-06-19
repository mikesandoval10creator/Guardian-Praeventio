---
description: Poll GitHub PR CI checks until all are complete, report results, and optionally merge when green. Usage: pr-ci-poll <PR_NUMBER> [--merge]
---

# PR CI Poll

Poll a GitHub PR's CI checks until they complete, then report the status.

## Instructions

Given PR number `$1` (and optional `--merge` flag):

1. **Poll loop** — check CI status every 30 seconds, up to 45 iterations (~22 minutes):
   ```bash
   cd "D:/Guardian Praeventio/repo"
   for i in $(seq 1 45); do
     info=$(gh pr view $1 --json mergeStateStatus,statusCheckRollup \
       -q '"\(.mergeStateStatus)|\([.statusCheckRollup[]|select(.status!="COMPLETED")|.name]|join(","))"')
     mss=$(echo "$info" | cut -d'|' -f1)
     pending=$(echo "$info" | cut -d'|' -f2)
     echo "iter $i: mergeState=$mss pending=[$pending]"
     if [ -z "$pending" ] || [ "$pending" = "" ]; then
       echo "=== ALL CHECKS COMPLETE ==="
       break
     fi
     sleep 30
   done
   ```

2. **Report results** — show check conclusions:
   ```bash
   gh pr view $1 --json statusCheckRollup \
     -q '.statusCheckRollup[] | "\(.name): \(.conclusion // .state)"'
   ```

3. **Check for failures**:
   ```bash
   fails=$(gh pr view $1 --json statusCheckRollup \
     -q '[.statusCheckRollup[]|select(.conclusion!="SUCCESS" and .conclusion!="NEUTRAL")]|length')
   ```

4. **If `--merge` and all green**:
   ```bash
   gh pr merge $1 --squash --delete-branch 2>&1 | tail -2
   ```

5. **If failures**: list the failing checks with their detail URLs for investigation.

## Output Format

```
PR #<N> status: <MERGEABLE|BLOCKED|CLEAN>
Checks: <N> passed, <M> failed, <K> pending
<list of failed checks with URLs>
```
