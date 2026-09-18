# Запуск фронта - копипаста для перезапуска
# cd c:\Users\Professional\31232131\zametochnitsa\frontend; npm run dev

Set-Location $PSScriptRoot
if (-not (Test-Path node_modules)) {
    npm install
}
npm run dev
