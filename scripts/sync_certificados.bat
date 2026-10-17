@echo off
rem Doble clic para publicar ahora los certificados nuevos. La tarea programada mensual ejecuta este mismo archivo.
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
echo ==== %date% %time% >> scripts\sync.log
python scripts\sync_certificados.py >> scripts\sync.log 2>&1
