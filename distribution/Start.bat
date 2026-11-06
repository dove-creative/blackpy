@echo off
setlocal
if not exist "%~dp0_runtime\BlackThunder.BlackPy.exe" (
    echo Runtime not found. Ask your teacher for the complete practice folder.
    pause
    exit /b 1
)
"%~dp0_runtime\BlackThunder.BlackPy.exe" --project "%~dp0."
if errorlevel 1 pause
