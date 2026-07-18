param(
    [string]$KeyPath = "$HOME\.ssh\mcp-ssh-yunohost-ed25519",
    [string]$Comment = "mcp-ssh-yunohost",
    [switch]$Rotate
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
    throw "ssh-keygen was not found. Install the Windows OpenSSH Client feature first."
}

$directory = Split-Path -Parent $KeyPath
if (-not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

if ((Test-Path $KeyPath) -or (Test-Path "$KeyPath.pub")) {
    if (-not $Rotate) {
        throw "Key files already exist at $KeyPath. Use -Rotate to generate a new timestamped key without deleting the current identity."
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $KeyPath = "$KeyPath-$timestamp"
}

& ssh-keygen -q -t ed25519 -N '""' -C $Comment -f $KeyPath
if ($LASTEXITCODE -ne 0) {
    throw "ssh-keygen failed with exit code $LASTEXITCODE"
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $KeyPath /inheritance:r | Out-Null
& icacls $KeyPath /grant:r "${currentIdentity}:(F)" | Out-Null

Write-Host "Dedicated MCP SSH key generated."
Write-Host "Private key: $KeyPath"
Write-Host "Public key:  $KeyPath.pub"
Write-Host ""
Write-Host "Paste this public key into the YunoHost application installer or configuration panel:"
Get-Content "$KeyPath.pub"
Write-Host ""
Write-Host "Keep the private key only on this client. Do not copy it to the YunoHost server."
if ($Rotate) {
    Write-Host "The previous key was preserved. Remove it only after the new MCP connection has been tested."
}
