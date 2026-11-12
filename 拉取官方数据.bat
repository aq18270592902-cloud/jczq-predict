@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [INFO] 正在拉取官方赛事数据...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未找到 node.exe，请先安装 Node.js 18+ 并加入 PATH
  echo         下载: https://nodejs.org/
  pause
  exit /b 1
)

node fetch_official.js %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo [OK] 数据已更新，重启服务或等待自动刷新即可看到
) else (
  echo [FAIL] 拉取失败，退出码 %RC%，看上面的报错
)
echo.
pause
