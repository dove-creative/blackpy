@echo off
chcp 65001 >nul
setlocal
if not exist "%~dp0..\실습\_runtime\BlackThunder.BlackPy.exe" (
    echo Runtime not found. Keep this unit inside the complete course folder.
    pause
    exit /b 1
)
"%~dp0..\실습\_runtime\BlackThunder.BlackPy.exe" --project "%~dp0." %*
if errorlevel 1 pause
