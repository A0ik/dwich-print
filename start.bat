@echo off
title DWICH62 - Impression
echo.
echo ========================================
echo   DWICH62 - Demarrage...
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Lancement du serveur d'impression...
start "DWICH62-Server" cmd /k "node server.js"

echo [2/2] Lancement du tunnel Cloudflare...
timeout /t 2 >nul
start "DWICH62-Tunnel" cmd /k "cloudflared tunnel run dwich-printer"

echo.
echo ========================================
echo   TOUT EST LANCE !
echo ========================================
echo.
echo   Serveur: http://localhost:3333
echo   Test:    http://localhost:3333/test
echo.
echo   Tu peux fermer cette fenetre.
echo   (Les 2 autres fenetres doivent rester ouvertes)
echo.
pause
