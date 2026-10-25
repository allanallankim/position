param(
    [string]$Url = 'http://localhost:5173',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$address = $null
if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$address) -or $address.Scheme -ne 'http' -or $address.UserInfo -or $Url -match '[\s"<>]') {
    throw 'Supply one HTTP URL, for example http://192.168.0.10:5173'
}
$origin = $address.GetLeftPart([UriPartial]::Authority)
$candidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'Install Google Chrome or Microsoft Edge first.' }
# Separate profile for this exact origin; never modify the normal browser profile.
$hasher = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($origin))).Replace('-', '').Substring(0, 16) }
finally { $hasher.Dispose() }
$profile = Join-Path $PSScriptRoot ".http-camera-profile\$hash"
$browserArgs = @(
    "--user-data-dir=`"$profile`"",
    "--unsafely-treat-insecure-origin-as-secure=$origin",
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    "`"$($address.AbsoluteUri)`""
)
Write-Output "HTTP camera origin: $origin"
Write-Output "Browser: $browser"
Write-Output "Isolated profile: $profile"
Write-Output 'Start the app server first. Allow the camera when the browser asks.'
Write-Output 'Use this window only for this development app. HTTP traffic is not encrypted.'
if ($DryRun) { $browserArgs; return }
Start-Process -FilePath $browser -ArgumentList $browserArgs -WindowStyle Hidden
