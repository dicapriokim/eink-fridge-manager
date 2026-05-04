@echo off
:: Set code page to Korean (949) for better path handling in Korean Windows
chcp 949 > nul

:: ===================================================
:: CONFIGURE YOUR NAS PATH HERE
:: ===================================================
set "NAS_DIR=\\192.168.0.40\보조 백업\server\eink"
:: ===================================================

echo Starting Deployment v5.2.4...
echo Target: "%NAS_DIR%"
echo.

:: 1. Frontend (public)
echo [1/3] Syncing public folder...
robocopy "%~dp0public" "%NAS_DIR%\public" /MIR /W:1 /R:1
if %ERRORLEVEL% GEQ 8 goto FAIL

:: 2. Data Folder
echo.
echo [2/3] Syncing data folder...
robocopy "%~dp0data" "%NAS_DIR%\data" /MIR /W:1 /R:1
if %ERRORLEVEL% GEQ 8 goto FAIL

:: 3. Server Core Files
echo.
echo [3/3] Syncing server core files...
robocopy "%~dp0." "%NAS_DIR%" "server.js" "package.json" "Dockerfile" "docker-compose.yml" /W:1 /R:1
if %ERRORLEVEL% GEQ 8 goto FAIL

echo.
echo ===================================================
echo √ Deployment Successful! (v5.2.4)
echo.
echo ● Files currently on NAS:
dir "%NAS_DIR%" /B
echo ===================================================
echo.
pause
exit /b

:FAIL
echo.
echo × [ERROR] Deployment failed. Check network or permissions.
pause
exit /b
