@echo off
chcp 65001 > nul
:: 아래 경로를 본인의 NAS 환경에 맞게 수정 후 사용하세요

set "NAS_DIR=\\YOUR_NAS_IP\path\to\eink"

echo ===================================================
echo 🚀 냉장고 관리 앱(eink-fridge) v5.0.5 자동 배포 
echo ===================================================
echo.
echo [검증] 목적지 경로: "%NAS_DIR%"
echo.

if "%NAS_DIR%"=="" (
    echo [경고] deploy.bat 파일을 편집하여 NAS_DIR 경로를 설정해주세요.
    pause
    exit /b
)

:: 1. 프론트엔드 (public) 폴더 동기화
echo [1/2] 프론트엔드 (public) 파일 복사 중...
robocopy "%~dp0public" "%NAS_DIR%\public" /MIR /W:1 /R:1
if %ERRORLEVEL% GEQ 8 (
    echo.
    echo ❌ [오류] public 폴더 복사 실패! (Robocopy 에러코드: %ERRORLEVEL%)
    pause
    exit /b
)

:: 2. 서버 핵심 파일 복사
echo.
echo [2/2] 서버 핵심 파일 복사 중...
robocopy "%~dp0." "%NAS_DIR%" "server.js" "package.json" "Dockerfile" "docker-compose.yml" /W:1 /R:1
if %ERRORLEVEL% GEQ 8 (
    echo.
    echo ❌ [오류] 서버 파일 복사 실패! (Robocopy 에러코드: %ERRORLEVEL%)
    pause
    exit /b
)

echo.
echo ===================================================
echo 📂 [현황] NAS 목적지 파일 목록:
dir "%NAS_DIR%" /B
echo.
echo ✅ 모든 파일이 성공적으로 배포되었습니다. (v5.0.5)
echo ===================================================
pause
exit /b

:FAIL
echo.
echo ❌ [오류] 예상치 못한 문제가 발생했습니다. (권한 또는 네트워크 확인)
pause