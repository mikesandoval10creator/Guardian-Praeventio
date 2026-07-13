# Branch review / consolidation helper (PowerShell).
#
# Cataloga TODA rama remota NO fusionada a main y determina si su trabajo ya
# esta en main (git cherry / patch-id) + archivos que toca. Correr LOCALMENTE.
#
# Uso (desde la raiz del repo):
#   powershell -ExecutionPolicy Bypass -File scripts\branch-review-analyze.ps1
#
# Salida: docs\audits\branch-review\FULL-ANALYSIS.tsv  (una fila por rama)
# Columnas: unique  total  date  branch  files  subject
#   unique = commits NO presentes en main (0 = trabajo YA en main, a salvo).
#            BIG = rama muy divergente (>60 commits), revisar a mano.

$ErrorActionPreference = 'Continue'
$root = (git rev-parse --show-toplevel)
Set-Location $root

Write-Host "Fetching origin/main..."
git fetch origin main -q 2>$null

$outDir = "docs/audits/branch-review"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "FULL-ANALYSIS.tsv"
"unique`ttotal`tdate`tbranch`tfiles`tsubject" | Out-File -Encoding utf8 $out

$branches = git for-each-ref --no-merged=origin/main --sort=-committerdate --format='%(refname:short)' refs/remotes/origin |
  Where-Object { $_ -notmatch 'origin/HEAD' }

$n = $branches.Count
$i = 0
foreach ($b in $branches) {
  $i++
  $name = $b -replace '^origin/', ''
  $tot = (git rev-list --count "origin/main..$b" 2>$null)
  if (-not $tot) { $tot = 0 }
  if ([int]$tot -gt 60) {
    $uniq = 'BIG'
  } else {
    $cherry = git cherry origin/main $b 2>$null
    $uniq = @($cherry | Select-String '^\+').Count
  }
  $files = ((git diff --name-only "origin/main...$b" 2>$null | Select-Object -First 6) -join ',')
  $date = (git log -1 --format='%cs' $b 2>$null)
  $subj = (git log -1 --format='%s' $b 2>$null)
  "$uniq`t$tot`t$date`t$name`t$files`t$subj" | Out-File -Append -Encoding utf8 $out
  Write-Host -NoNewline ("`r[{0}/{1}] {2,-55}" -f $i, $n, $name)
}
Write-Host ""

$rows   = Import-Csv $out -Delimiter "`t"
$inMain = @($rows | Where-Object { $_.unique -eq '0' }).Count
$review = @($rows | Where-Object { $_.unique -ne '0' -and $_.unique -ne 'NA' -and $_.unique -ne 'BIG' }).Count
$big    = @($rows | Where-Object { $_.unique -eq 'BIG' }).Count

Write-Host "=================================================="
Write-Host ("Listo. {0} ramas -> {1}" -f $rows.Count, $out)
Write-Host ("Ya en main (0 unicos, a salvo): {0}" -f $inMain)
Write-Host ("A revisar (>0 unicos):          {0}" -f $review)
Write-Host ("Muy divergentes (BIG, a mano):  {0}" -f $big)
Write-Host "=================================================="
Write-Host "Top 25 a revisar (mas commits unicos):"
$rows |
  Where-Object { $_.unique -ne 'NA' -and $_.unique -ne 'BIG' -and ([int]$_.unique) -gt 0 } |
  Sort-Object { [int]$_.unique } -Descending |
  Select-Object -First 25 |
  ForEach-Object { "{0}`t{1}`t{2}" -f $_.unique, $_.branch, $_.subject }
