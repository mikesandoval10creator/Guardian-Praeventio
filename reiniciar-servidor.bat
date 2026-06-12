@echo off
title Guardian Praeventio - Servidor Dev
cd /d "D:\Guardian Praeventio\repo"
echo paso1 lanzado %date% %time% > dev-server-marker.txt
echo ============================================
echo  Guardian Praeventio - reinicio del servidor
echo ============================================
echo [1/2] Cerrando servidor anterior (puerto 57335) si existe...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :57335 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo paso2 kill completado %time% >> dev-server-marker.txt
ping -n 4 127.0.0.1 >nul
echo paso3 lanzando npm %time% >> dev-server-marker.txt
echo [2/2] Servidor iniciando... NO CIERRES ESTA VENTANA. Logs: dev-server.log
call npm run dev > dev-server.log 2>&1
echo paso4 npm termino codigo %errorlevel% %time% >> dev-server-marker.txt
pause
