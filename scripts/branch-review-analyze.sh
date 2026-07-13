#!/usr/bin/env bash
# Branch review / consolidation helper.
#
# Cataloga TODA rama remota NO fusionada a main y determina si su trabajo ya
# está en main (git cherry / patch-id) + archivos que toca. Pensado para correr
# LOCALMENTE (rápido, sin el timeout del sandbox). Para 629 ramas tarda ~minutos.
#
# Uso:
#   bash scripts/branch-review-analyze.sh
# Salida:
#   docs/audits/branch-review/FULL-ANALYSIS.tsv   (una fila por rama)
#
# Columnas: unique  total  date  branch  files  subject
#   unique = commits NO presentes en main (patch-id). 0 = trabajo YA en main (a salvo).
#            BIG = rama muy divergente (>60 commits), revisar a mano.
#   total  = commits que la rama tiene por delante de main.
#   files  = primeros 6 archivos que toca (vs main).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "Fetching origin/main..."
git fetch origin main -q || true

OUT=docs/audits/branch-review/FULL-ANALYSIS.tsv
mkdir -p "$(dirname "$OUT")"
printf "unique\ttotal\tdate\tbranch\tfiles\tsubject\n" > "$OUT"

mapfile -t BRANCHES < <(git for-each-ref --no-merged=origin/main \
  --sort=-committerdate --format='%(refname:short)' refs/remotes/origin \
  | grep -v 'origin/HEAD')

total_n=${#BRANCHES[@]}
i=0
for b in "${BRANCHES[@]}"; do
  i=$((i+1))
  name="${b#origin/}"
  tot=$(git rev-list --count "origin/main..$b" 2>/dev/null || echo 0)
  if [ "${tot:-0}" -gt 60 ]; then
    uniq="BIG"
  else
    uniq=$(git cherry origin/main "$b" 2>/dev/null | grep -c '^+' || echo "NA")
  fi
  files=$(git diff --name-only "origin/main...$b" 2>/dev/null | head -6 | tr '\n' ',' | sed 's/,$//')
  date=$(git log -1 --format='%cs' "$b" 2>/dev/null || echo '?')
  subj=$(git log -1 --format='%s' "$b" 2>/dev/null || echo '')
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$uniq" "$tot" "$date" "$name" "$files" "$subj" >> "$OUT"
  printf "\r[%d/%d] %-50s" "$i" "$total_n" "$name" >&2
done
echo "" >&2

echo "=================================================="
echo "Listo. $(($(wc -l < "$OUT")-1)) ramas -> $OUT"
echo "Ya en main (0 unicos, a salvo):  $(awk -F'\t' 'NR>1 && $1==0' "$OUT" | wc -l)"
echo "A revisar (>0 unicos):           $(awk -F'\t' 'NR>1 && $1!=0 && $1!="NA" && $1!="BIG"' "$OUT" | wc -l)"
echo "Muy divergentes (BIG, a mano):   $(awk -F'\t' 'NR>1 && $1=="BIG"' "$OUT" | wc -l)"
echo "=================================================="
echo "Top 25 a revisar (mas commits unicos):"
awk -F'\t' 'NR>1 && $1!="NA" && $1!="BIG" && $1+0>0 {print $1"\t"$4"\t"$6}' "$OUT" \
  | sort -t$'\t' -k1 -rn | head -25
