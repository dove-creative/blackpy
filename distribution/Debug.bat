@echo off
chcp 65001 >nul
setlocal
if not exist "%~dp0_runtime\BlackThunder.BlackPy.exe" (
    echo 실행 파일이 없습니다. 실습 폴더 전체를 다시 받아 주세요.
    pause
    exit /b 1
)
"%~dp0_runtime\BlackThunder.BlackPy.exe" --project "%~dp0.." %*
if errorlevel 1 pause
