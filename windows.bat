@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Uncensored AI Studio
cd /d "%~dp0"

set APP=%~dp0app
set NODE=%APP%\tools\node-win\node.exe
set NPM=%APP%\tools\node-win\pm.cmd
set DIST=%APP%\dist\index.html
set SETUP=%~dp0scripts\setup\setup.ps1
set CUDA_BACKEND=%APP%\backend\win\cuda\sd-cuda.exe
set VULKAN_BACKEND=%APP%\backend\win\vulkan\sd-vulkan.exe
set LLM_CUDA_BACKEND=%APP%\llm-backend\win\cuda\llama-server.exe
set LLM_HIP_BACKEND=%APP%\llm-backend\win\hip\llama-server.exe
set LLM_VULKAN_BACKEND=%APP%\llm-backend\win\vulkan\llama-server.exe
set LLM_SYCL_BACKEND=%APP%\llm-backend\win\sycl\llama-server.exe
set LLM_CPU_BACKEND=%APP%\llm-backend\win\cpu\llama-server.exe
set SPEECH_BACKEND=%APP%\speech-backend\win\cpu\whisper-cli.exe
set TTS_RUNTIME=%APP%\tts-runtime\node_modules\kokoro-js
set SERVE=%~dp0scripts\server\serve.cjs
if "%FRONTEND_PORT%"=="" set FRONTEND_PORT=1420
if "%LLM_PORT%"=="" set LLM_PORT=10086
set SETUP_REASON=
set SETUP_MODE=Repair

:: ── Проверка первого запуска ─────────────────────────────────────────────────
if not exist "%APP%\tools\node-win" set SETUP_MODE=First-Time Setup
if not exist "%NODE%" (
    set SETUP_REASON=Портативный Node.js отсутствует.
    goto :run_setup
)
if not exist "%NPM%" (
    set SETUP_REASON=Портативный npm отсутствует.
    goto :run_setup
)
if not exist "%DIST%" (
    set SETUP_REASON=Сборка фронтенда отсутствует.
    goto :run_setup
)
if not exist "%LLM_CUDA_BACKEND%" if not exist "%LLM_HIP_BACKEND%" if not exist "%LLM_VULKAN_BACKEND%" if not exist "%LLM_SYCL_BACKEND%" if not exist "%LLM_CPU_BACKEND%" (
    set SETUP_REASON=Отсутствует текстовый бэкенд llama.cpp.
    goto :run_setup
)
if not exist "%SPEECH_BACKEND%" (
    set SETUP_REASON=Отсутствует speech backend whisper.cpp.
    goto :run_setup
)
if not exist "%TTS_RUNTIME%" (
    set SETUP_REASON=Отсутствует runtime для Kokoro text-to-speech.
    goto :run_setup
)
if exist "%CUDA_BACKEND%" goto :launch
if exist "%VULKAN_BACKEND%" goto :launch
set SETUP_REASON=Не установлен ни один бинарник бэкенда.
goto :run_setup

:run_setup
echo.
echo  ============================================================
echo   UNCENSORED AI STUDIO      ^|  %SETUP_MODE%
echo  ============================================================
echo.
if "%SETUP_MODE%"=="First-Time Setup" (
    echo  Похоже, это первый запуск. Настройка выполняется автоматически...
) else (
    echo  Для запуска Uncensored AI Studio требуется быстрое восстановление...
)
if not "%SETUP_REASON%"=="" echo  Причина: %SETUP_REASON%
echo  Во время настройки модели не скачиваются. Скачайте или импортируйте их в приложении.
echo.
echo  Нажмите любую клавишу для продолжения или Ctrl+C для отмены.
pause >nul

:: Очистка старых управляемых процессов бэкенда перед настройкой,
:: чтобы можно было заменить app\tools\node-win.
:: Не убиваем порт фронтенда; при запуске будет выбран свободный порт.
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 "') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%LLM_PORT% "') do taskkill /f /pid %%a >nul 2>nul

powershell -ExecutionPolicy Bypass -File "%SETUP%"
if errorlevel 1 (
    echo.
    echo  [ОШИБКА] Настройка не удалась. Проверьте вывод выше.
    pause
    exit /b 1
)

:: После настройки продолжаем запуск
goto :launch

:: ── Запуск ─────────────────────────────────────────────────────────────────────
:launch
echo.
echo  ============================================================
echo   UNCENSORED AI STUDIO      ^|  Запуск...
echo  ============================================================
echo.

set "REQUESTED_FRONTEND_PORT=%FRONTEND_PORT%"
call :resolve_frontend_port
if errorlevel 1 exit /b 1
if not "%FRONTEND_PORT%"=="%REQUESTED_FRONTEND_PORT%" echo  Порт фронтенда %REQUESTED_FRONTEND_PORT% занят; используется %FRONTEND_PORT% вместо.

:: Очищаем управляемые порты бэкенда, чтобы избежать конфликтов API.
echo  Очистка порта бэкенда 8080 и текстового порта %LLM_PORT%...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 "') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%LLM_PORT% "') do taskkill /f /pid %%a >nul 2>nul

:: Запуск сервера фронтенда + менеджера бэкенда (serve.cjs управляет sd-vulkan.exe)
echo  Запуск Uncensored AI Studio...
echo  Открытие браузера: http://localhost:%FRONTEND_PORT%...
start /b cmd /c "timeout /t 2 >nul && start http://localhost:%FRONTEND_PORT%"

echo.
echo  ============================================================
echo   Работает!
echo   Web UI:     http://localhost:%FRONTEND_PORT%
echo   GPU API:    Выбран приложением автоматически (стартует с 8080)
echo   Text API:   Запускается, когда загружена GGUF модель (порт %LLM_PORT%)
echo   Speech:     Управляется приложением локально
echo   TTS:        Управляется приложением локально
echo.
echo   Нажмите Ctrl+C в этом окне, чтобы остановить все сервисы.
echo  ============================================================
echo.

"%NODE%" "%SERVE%"
exit /b %ERRORLEVEL%

:resolve_frontend_port
call :is_port_available "%FRONTEND_PORT%"
if "%PORT_AVAILABLE%"=="1" exit /b 0

for /L %%p in (1421,1,1499) do (
    if not "%%p"=="%FRONTEND_PORT%" (
        call :is_port_available "%%p"
        if "!PORT_AVAILABLE!"=="1" (
            set "FRONTEND_PORT=%%p"
            exit /b 0
        )
    )
)

echo  [ОШИБКА] Свободный порт для фронтенда не найден. Проверено: %FRONTEND_PORT% и 1421-1499.
exit /b 1

:is_port_available
set "PORT_AVAILABLE=1"
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%~1 " ^| findstr /I "LISTENING"') do (
    set "PORT_AVAILABLE=0"
)
exit /b 0

