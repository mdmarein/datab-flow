@echo off
:: ─────────────────────────────────────────────────────────────
::  dataB Flow — Crea acceso directo en el Desktop (Windows)
::  Uso: doble clic en este archivo
:: ─────────────────────────────────────────────────────────────

setlocal

:: Directorio del proyecto (padre de "tools")
set "TOOLS_DIR=%~dp0"
set "TOOLS_DIR=%TOOLS_DIR:~0,-1%"
for %%I in ("%TOOLS_DIR%\..") do set "PROJECT_DIR=%%~fI"

set "VBS_FILE=%TOOLS_DIR%\launch-windows.vbs"
set "ICO_FILE=%TOOLS_DIR%\icons\datab-flow.ico"
set "SHORTCUT_NAME=dataB Flow"

:: Obtener ruta al Desktop del usuario
for /f "tokens=*" %%D in ('powershell -NoProfile -Command "[Environment]::GetFolderPath(\"Desktop\")"') do set "DESKTOP=%%D"

set "SHORTCUT_PATH=%DESKTOP%\%SHORTCUT_NAME%.lnk"

echo Creando acceso directo en: %SHORTCUT_PATH%

:: Crear el acceso directo via PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $sc = $ws.CreateShortcut('%SHORTCUT_PATH%'); ^
   $sc.TargetPath = 'wscript.exe'; ^
   $sc.Arguments = '\""%VBS_FILE%"\"'; ^
   $sc.WorkingDirectory = '%PROJECT_DIR%'; ^
   $sc.IconLocation = '"%ICO_FILE%",0'; ^
   $sc.Description = 'dataB Flow - MultiplAi'; ^
   $sc.WindowStyle = 1; ^
   $sc.Save()"

if exist "%SHORTCUT_PATH%" (
  echo.
  echo [OK] Acceso directo creado en el Desktop.
  echo      Doble clic en "dataB Flow" para iniciar la app.
) else (
  echo.
  echo [ERROR] No se pudo crear el acceso directo.
  echo         Intenta ejecutar este script como Administrador.
)

echo.
pause
