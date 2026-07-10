@echo off
TITLE RevFetch Auto-Installer
COLOR 0A

echo ========================================================
echo   RevFetch Native Engine - Automated Setup
echo ========================================================
echo.

:: --- DEVELOPER: REPLACE THIS WITH YOUR ACTUAL CHROME EXTENSION ID ---
set "jdidcnpmpkgnfjmifeheacelnlnjihpo"
:: --------------------------------------------------------------------

set "HOST_NAME=com.maxxopp.revfetch"

:: Find exactly where the client unzipped the folder
set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"

set "MANIFEST_PATH=%DIR%\manifest.json"
set "EXE_PATH=%DIR%\revfetch-engine.exe"

:: Chrome requires double backslashes in JSON file paths
set "ESCAPED_EXE=%EXE_PATH:\=\\%"

echo Detecting installation path:
echo %DIR%
echo.

:: Auto-write the Native Manifest file
echo Linking engine to Google Chrome...
(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "RevFetch WAF Bypass Engine",
echo   "path": "%ESCAPED_EXE%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

:: Inject the path into the Windows Registry
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul

echo.
echo ========================================================
echo   SUCCESS! The system is fully configured.
echo ========================================================
echo You may now close this window and load the Chrome Extension.
pause