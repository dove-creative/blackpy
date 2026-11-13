@echo off
chcp 65001 >nul
setlocal
python -X utf8 "%~dp0시작.pyw" --console %*
set "BLACKPY_EXIT_CODE=%ERRORLEVEL%"
if not "%BLACKPY_EXIT_CODE%"=="0" pause
exit /b %BLACKPY_EXIT_CODE%
