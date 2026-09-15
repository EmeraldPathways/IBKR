param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$TaskName = "IBKR Event Contract Bridge"
)

$ErrorActionPreference = "Stop"
$runScript = Join-Path $InstallRoot "windows\run-bridge.ps1"
if (-not (Test-Path $runScript)) { throw "Bridge files were not found at $InstallRoot." }

$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`" -InstallRoot `"$InstallRoot`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered '$TaskName' for the current Windows user."
Write-Host "The bridge still requires TWS or IB Gateway to be running and authenticated."
