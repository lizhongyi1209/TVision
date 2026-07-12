@echo off
cd /d "%~dp0"
echo ============================
echo   正在拉取最新版本...
echo ============================
echo.
git pull origin main
if errorlevel 1 (
    echo.
    echo 拉取失败：请检查网络连接或本地未提交的改动。
    echo.
    pause
    exit /b 1
)
echo.
echo 已更新到最新版本，窗口将在 3 秒后自动关闭。
timeout /t 3 /nobreak >nul
