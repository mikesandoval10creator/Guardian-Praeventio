@echo off
REM ===================================================================
REM  Lanza Claude Code en este repo para que cree el PR del Sprint E2E-99.
REM  Doble clic para ejecutar.
REM ===================================================================
cd /d "%~dp0"

echo.
echo  Repo: %CD%
echo  Lanzando Claude Code para crear el PR (Sprint E2E-99)...
echo.

where claude >nul 2>nul
if errorlevel 1 (
  echo  [!] No encontre el comando "claude" en el PATH.
  echo      Abre Claude Code manualmente en esta carpeta y pega este prompt:
  echo.
  echo      Lee CLAUDE_CODE_PR_HANDOFF.md y ejecutalo: borra el index.lock,
  echo      commitea solo los archivos listados, push de la rama y abre el PR.
  echo.
  pause
  exit /b 1
)

claude "Lee CLAUDE_CODE_PR_HANDOFF.md y ejecutalo: borra .git\index.lock si existe, haz commit SOLO de los 11 archivos del Sprint E2E-99 listados (NO los *.router.test.ts), push de la rama feat/e2e-coverage-99-percent y abre el PR contra main usando COMMIT_MSG_E2E99.txt."

pause
