@echo off
echo.
echo ========================================
echo   DWICH62 - Installation Imprimante
echo ========================================
echo.

:: Vérifier si Node.js est installé
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Node.js n'est pas installe!
    echo.
    echo Telechargez Node.js ici: https://nodejs.org/
    echo Choisissez la version LTS et installez-la.
    echo Puis relancez ce script.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js detecte
echo.
echo Installation des dependances...
call npm install
echo.
echo [OK] Installation terminee!
echo.
echo ========================================
echo   Pour demarrer le serveur:
echo   Double-cliquez sur "start.bat"
echo ========================================
echo.
pause
