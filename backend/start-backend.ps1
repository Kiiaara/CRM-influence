# Запуск backend - копипаста для перезапуска
# cd c:\Users\Professional\31232131\zametochnitsa\backend; .\.venv\Scripts\Activate.ps1; uvicorn main:app --reload --host 127.0.0.1 --port 8000

Set-Location $PSScriptRoot
if (-not (Test-Path .venv)) {
    python -m venv .venv
}
. .\.venv\Scripts\Activate.ps1
pip install -q -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
