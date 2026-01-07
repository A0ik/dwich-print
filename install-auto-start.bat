@echo off
echo.
echo ========================================
echo   Installation demarrage automatique
echo ========================================
echo.

:: Créer le raccourci dans le dossier Startup
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SCRIPT=%~dp0start-silent.vbs

echo Creation du raccourci...
copy "%SCRIPT%" "%STARTUP%\dwich-printer.vbs" >nul

echo.
echo ========================================
echo   OK ! DWICH62 demarrera avec Windows
echo ========================================
echo.
pause
