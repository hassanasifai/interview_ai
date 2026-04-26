$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Graphify = "C:\Users\Hassa\anaconda3\Scripts\graphify.exe"
$LogPath = Join-Path $ProjectRoot "graphify-out\watch.log"

Set-Location $ProjectRoot
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null

"[$(Get-Date -Format s)] Starting graphify watch for $ProjectRoot" | Out-File -FilePath $LogPath -Append -Encoding utf8
& $Graphify watch . 2>&1 | Tee-Object -FilePath $LogPath -Append
