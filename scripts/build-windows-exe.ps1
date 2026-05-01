param(
  [ValidateSet("release", "debug")]
  [string]$Profile = "release",
  [switch]$SkipInstall,
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$appDir = Join-Path $repoRoot "desktop\app"
$packageJson = Join-Path $appDir "package.json"

if (!(Test-Path $packageJson)) {
  throw "desktop/app/package.json was not found. Run this script from the StudyGraph app repository."
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

foreach ($command in @("npm", "cargo", "rustc")) {
  if (!(Test-Command $command)) {
    throw "$command is required to build the desktop app."
  }
}

Push-Location $appDir
try {
  if (!$SkipInstall -and !(Test-Path (Join-Path $appDir "node_modules"))) {
    Write-Host "Installing npm dependencies..."
    npm install
  }

  Write-Host "Running TypeScript/Vite build..."
  npm run build

  if ($Profile -eq "debug") {
    Write-Host "Building Tauri debug app..."
    npm run tauri -- build --debug
  } else {
    Write-Host "Building Tauri release app..."
    npm run tauri -- build
  }
} finally {
  Pop-Location
}

$targetDir = Join-Path $repoRoot "target\$Profile"
$bundleDir = Join-Path $targetDir "bundle"

if (!$OutputDir) {
  $OutputDir = Join-Path $repoRoot "release-artifacts\windows\$Profile"
}

if (!(Test-Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$copied = @()
$mainExe = Join-Path $targetDir "studygraph_desktop.exe"
if (Test-Path $mainExe) {
  Copy-Item -LiteralPath $mainExe -Destination $OutputDir -Force
  $copied += (Join-Path $OutputDir "studygraph_desktop.exe")
}

if (Test-Path $bundleDir) {
  Get-ChildItem -Path $bundleDir -Recurse -File -Include "*.exe", "*.msi" | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $OutputDir -Force
    $copied += (Join-Path $OutputDir $_.Name)
  }
}

Write-Host ""
Write-Host "Build complete."
Write-Host "Copied Windows artifacts to:"
Write-Host $OutputDir
Write-Host ""
if ($copied.Count -eq 0) {
  Write-Warning "No .exe or .msi artifacts were copied. Check the Tauri build output above."
} else {
  $copied | Sort-Object -Unique | ForEach-Object { Write-Host " - $_" }
}
