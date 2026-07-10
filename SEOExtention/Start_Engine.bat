@echo off
TITLE Dealership Crawler Backend Server
COLOR 0B

echo ========================================================
echo   Booting Dealership Data Extraction Engine...
echo ========================================================
echo.

:: Get the root directory where this batch file lives
set "ROOT_DIR=%~dp0"

echo [1/2] Installing backend dependencies (if needed)...
cd /d "%ROOT_DIR%backend"
call npm install

echo.
echo [2/2] Starting Local Server...
echo --------------------------------------------------------
echo KEEP THIS WINDOW OPEN. DO NOT CLOSE IT WHILE CRAWLING.
echo --------------------------------------------------------
echo.

:: Starts the server directly from the src folder
node src/server.js

pause