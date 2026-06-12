@echo off
title Guardian Praeventio - Verificacion
cd /d "D:\Guardian Praeventio\repo"
echo inicio %date% %time% > verificar-status.txt
echo ============================================== > verificar.log
echo  TYPECHECK (tsc --noEmit) >> verificar.log
echo ============================================== >> verificar.log
call npm run typecheck >> verificar.log 2>&1
echo typecheck_exit=%errorlevel% %time% >> verificar-status.txt
echo. >> verificar.log
echo ============================================== >> verificar.log
echo  LINT I18N >> verificar.log
echo ============================================== >> verificar.log
call npm run lint:i18n >> verificar.log 2>&1
echo lint_i18n_exit=%errorlevel% %time% >> verificar-status.txt
echo fin %time% >> verificar-status.txt
exit
