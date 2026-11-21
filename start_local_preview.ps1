$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "DOBOKU WORKS ポートフォリオ ローカル確認: http://127.0.0.1:8768/" -ForegroundColor Cyan
python -m http.server 8768 --bind 127.0.0.1
