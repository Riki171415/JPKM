@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
    echo Siapkan Node.js versi 24 atau lebih baru.
    pause
    exit /b 1
)
if not exist node_modules\pdfjs-dist\package.json (
    echo Pasang dependensi di folder ini dengan npm ci.
    pause
    exit /b 1
)
node server\index.js
pause
