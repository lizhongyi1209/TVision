@echo off
setlocal
title TVision 启动器
cd /d "%~dp0"

echo.
echo  ================================================
echo    TVision - 本地电商 AI 生图工作台
echo  ================================================
echo.

rem ---------- 已在运行则直接打开浏览器 ----------
curl -s -o nul --max-time 2 http://localhost:3000/ >nul 2>nul
if not errorlevel 1 (
    echo  检测到服务已在运行，直接打开浏览器。
    start "" http://localhost:3000
    exit /b 0
)

rem ---------- 环境检查 ----------
where node >nul 2>nul
if errorlevel 1 (
    echo  [错误] 未找到 Node.js（需要 18.18 及以上）。请先安装：https://nodejs.org
    echo.
    pause
    exit /b 1
)

rem ---------- 首次运行自动补齐：依赖 / 构建 ----------
if not exist "node_modules\" (
    echo  首次运行：正在安装依赖 npm ci ，可能需要几分钟...
    call npm ci
    if errorlevel 1 (
        echo  [错误] 依赖安装失败，请检查网络后重新双击。
        echo.
        pause
        exit /b 1
    )
)

if not exist ".next\BUILD_ID" (
    echo  未找到构建产物：正在构建 npm run build ，约半分钟...
    call npm run build
    if errorlevel 1 (
        echo  [错误] 构建失败，请把上方报错信息发给开发者。
        echo.
        pause
        exit /b 1
    )
)

rem ---------- 启动服务（独立最小化窗口）----------
echo  正在启动服务，端口 3000 ...
start "TVision Server - 关闭此窗口即停止服务" /min cmd /c "npm run start || pause"

rem ---------- 等待就绪后打开浏览器，最多约 60 秒 ----------
for /l %%i in (1,1,60) do (
    curl -s -o nul --max-time 2 http://localhost:3000/ >nul 2>nul && goto ready
    ping -n 2 127.0.0.1 >nul
)

echo  [警告] 等待约 60 秒服务仍未就绪。
echo  请点开任务栏里的 "TVision Server" 窗口查看报错。
echo.
pause
exit /b 1

:ready
echo  服务已就绪，正在打开浏览器 ...
start "" http://localhost:3000
exit /b 0
