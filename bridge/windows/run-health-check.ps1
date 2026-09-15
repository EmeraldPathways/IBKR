param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$python = Join-Path $InstallRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Bridge is not installed. Run install.ps1 first." }
Push-Location $InstallRoot
try { & $python -m app.main --health-check; exit $LASTEXITCODE }
finally { Pop-Location }
