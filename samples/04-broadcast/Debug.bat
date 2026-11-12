@echo off
chcp 65001 >nul
setlocal
set "BLACKPY_RUNTIME=%~dp0..\..\artifacts\blackpy\실습\_runtime"
if not exist "%BLACKPY_RUNTIME%\BlackThunder.BlackPy.exe" (
    echo 실행 파일이 없습니다. 저장소 루트의 PowerShell 7에서 아래 명령을 실행해 주세요.
    echo ./scripts/Publish.ps1
    pause
    exit /b 1
)
"%BLACKPY_RUNTIME%\BlackThunder.BlackPy.exe" --project "%~dp0." %*
set "BLACKPY_EXIT_CODE=%ERRORLEVEL%"
if not "%BLACKPY_EXIT_CODE%"=="0" pause
exit /b %BLACKPY_EXIT_CODE%
