param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE "IBKRBridge")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-PythonCommand {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) { return @($py.Source, "-3") }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) { return @($python.Source) }
  throw "Python 3.11 or newer is required. Install it from python.org and enable the PATH option."
}

function Invoke-Python([string[]]$Arguments) {
  if ($script:PythonCommand.Length -gt 1) {
    & $script:PythonCommand[0] $script:PythonCommand[1..($script:PythonCommand.Length - 1)] @Arguments
  } else {
    & $script:PythonCommand[0] @Arguments
  }
  if ($LASTEXITCODE -ne 0) { throw "Python command failed with exit code $LASTEXITCODE." }
}

$SourceRoot = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "logs") | Out-Null

Get-ChildItem -Path $SourceRoot -Force | Where-Object {
  $_.Name -notin @(".venv", ".env", "data", "logs")
} | Copy-Item -Destination $InstallRoot -Recurse -Force

$script:PythonCommand = Get-PythonCommand
$version = Invoke-Python @("-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
$parts = $version.Trim().Split('.')
if ([int]$parts[0] -lt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -lt 11)) {
  throw "Python 3.11 or newer is required; found $version."
}

$venv = Join-Path $InstallRoot ".venv"
if (-not (Test-Path $venv)) {
  Invoke-Python @("-m", "venv", $venv)
}

$venvPython = Join-Path $venv "Scripts\python.exe"
$envPath = Join-Path $InstallRoot ".env"
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $InstallRoot "windows\.env.windows.example") $envPath
  Write-Host "Created $envPath. Review it before starting the bridge."
}
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install setuptools
if ($LASTEXITCODE -ne 0) { throw "setuptools installation failed." }
& $venvPython -m pip install -r (Join-Path $InstallRoot "requirements.lock")
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

# Install ibapi from IBKR's official downloaded TWS API source. IBKR does not
# endorse pip as the distribution source for its API package.
$apiPath = if ($env:IBKR_TWS_API_PYTHON_PATH) { $env:IBKR_TWS_API_PYTHON_PATH } else { "C:\TWS API\source\pythonclient" }
if (Test-Path $envPath) {
  $configuredApiPath = Get-Content $envPath | Where-Object { $_ -match '^IBKR_TWS_API_PYTHON_PATH=' } | Select-Object -First 1
  if ($configuredApiPath) { $apiPath = ($configuredApiPath -split '=', 2)[1].Trim() }
}
$apiSetup = Join-Path $apiPath "setup.py"
if (-not (Test-Path $apiSetup)) {
  throw "Official IBKR TWS API Python source was not found at '$apiPath'. Download and install the current Windows TWS API from Interactive Brokers, then rerun this installer."
}
Push-Location $apiPath
try {
  & $venvPython .\setup.py install
  if ($LASTEXITCODE -ne 0) { throw "Official IBKR Python API installation failed." }
} finally { Pop-Location }

Push-Location $InstallRoot
try {
  & $venvPython -m app.main --health-check
  if ($LASTEXITCODE -ne 0) { throw "Paper-mode health check failed." }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Windows bridge installation completed."
Write-Host "1. Edit $envPath and set SITE_BASE_URL, BRIDGE_ID, BRIDGE_TOKEN, and IBKR_ACCOUNT_ID."
Write-Host "2. Keep TRADING_MODE=paper and LIVE_TRADING_ENABLED=false for initial testing."
Write-Host "3. Authenticate TWS or IB Gateway manually and configure localhost API access."
Write-Host "4. Run windows\run-bridge.ps1 from $InstallRoot."
