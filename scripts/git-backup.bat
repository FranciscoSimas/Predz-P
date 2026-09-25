@echo off
REM Duplo-clique ou: scripts\git-backup.bat
REM Commit: Backup: AAAA-MM-DD HH:MM:SS (como no script bash)
REM Contorna ExecutionPolicy sem alterar definicoes do sistema.

setlocal
cd /d "%~dp0.."

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-backup.ps1"

set EXITCODE=%ERRORLEVEL%
if %EXITCODE% neq 0 (
    echo.
    echo Falhou com codigo %EXITCODE%.
    pause
)
exit /b %EXITCODE%
