@echo off
REM Duplo-clique ou: scripts\git-backup-2.bat
REM Menu: 1) Commit and push  2) Merge dev into main
REM Contorna ExecutionPolicy sem alterar definicoes do sistema.

setlocal
cd /d "%~dp0.."

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-backup-2.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% neq 0 (
    echo Falhou com codigo %EXITCODE%.
) else (
    echo Concluido.
)
pause
exit /b %EXITCODE%
