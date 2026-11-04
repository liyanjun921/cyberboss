param(
  [string]$InstallDir = (Join-Path $HOME "Live2D-XLC"),
  [switch]$EnableTouch,
  [switch]$InstallSampleModel,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$repoUrl = "https://github.com/zziying/ai-live2d-body-starter.git"
$injector = Join-Path $PSScriptRoot "inject-touch.js"

function Require-Command([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Missing $Name. Install it first and reopen PowerShell." }
  return $cmd.Source
}

$node = Require-Command "node"
$git = Require-Command "git"
$pnpm = Require-Command "pnpm"
$nodeMajor = [int]((& $node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Node.js 22+ required by the CyberBoss integration." }

if (Test-Path -LiteralPath $InstallDir) {
  if (-not (Test-Path -LiteralPath (Join-Path $InstallDir ".git"))) {
    throw "InstallDir exists but is not a Git checkout; refusing to overwrite."
  }
  $origin = (& $git -C $InstallDir remote get-url origin 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $origin -or $origin.TrimEnd("/") -notin @(
      $repoUrl.TrimEnd("/"),
      "https://github.com/zziying/ai-live2d-body-starter",
      "https://github.com/zziying/ai-live2d-body-starter.git"
    )) {
    throw "Existing repo is not the expected official Live2D starter; refusing to modify."
  }
  Write-Host "Existing starter detected; no git pull or reset will be performed."
} else {
  $parent = Split-Path -Parent $InstallDir
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  & $git clone $repoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { throw "Git clone failed" }
}

if (-not $SkipInstall) {
  Push-Location $InstallDir
  try {
    & $pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
  } finally {
    Pop-Location
  }
}

$configPath = Join-Path $InstallDir "pet.config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "pet.config.json not found" }

if ($InstallSampleModel) {
  # Download directly from Live2D's official sample URL, no bundled/redistributed model.
  $modelRoot = Join-Path $InstallDir "src/renderer/public/model/hiyori-official"
  if (Test-Path -LiteralPath $modelRoot) {
    throw "Sample model folder already exists; refusing to overwrite: $modelRoot"
  }
  $archive = Join-Path ([System.IO.Path]::GetTempPath()) ("hiyori-official-" + [guid]::NewGuid().ToString("N") + ".zip")
  try {
    Write-Host "Downloading official Hiyori sample. Please respect Live2D sample license."
    Invoke-WebRequest -Uri "https://cubism.live2d.com/sample-data/bin/hiyori/hiyori_en.zip" -OutFile $archive -UseBasicParsing
    New-Item -Path $modelRoot -ItemType Directory -Force | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $modelRoot -Force
    $modelFile = Get-ChildItem -LiteralPath $modelRoot -File -Recurse -Filter "*.model3.json" |
      Select-Object -First 1
    if (-not $modelFile) { throw "Official ZIP had no .model3.json model" }
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $relative = $modelFile.FullName.Substring($modelRoot.Length + 1).Replace("\", "/")
    $modelPath = "model/hiyori-official/$relative"
    $backupPath = "$configPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $configPath -Destination $backupPath
    $config.model.path = $modelPath
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $json = $config | ConvertTo-Json -Depth 30
    [System.IO.File]::WriteAllText($configPath, $json, $utf8NoBom)
    Write-Host "Official sample model configured: $modelPath"
    Write-Host "Config backup: $backupPath"
  } finally {
    Remove-Item -LiteralPath $archive -ErrorAction SilentlyContinue
  }
}

if ($EnableTouch) {
  if (-not (Test-Path -LiteralPath $injector)) { throw "CyberBoss injector not found" }
  $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $config.inject) { throw "Expected inject config not present; refusing to rewrite" }
  $backupPath = "$configPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item -LiteralPath $configPath -Destination $backupPath
  $config.inject.mode = "command"
  $config.inject.command = @($node, $injector, '{message}')
  $config.inject.messages = @{
    stroke = "[pet-touch] 你被摸摸了！"
    double = "[pet-touch] 你被戳了一下！"
    dizzy = "[pet-touch] 你被晃晕了！"
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  $json = $config | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText($configPath, $json, $utf8NoBom)
  Write-Host "Touch injector enabled. Original config backup: $backupPath"
  Write-Warning "This only reaches the SAME-MACHINE CyberBoss bound session; not the cloud CyberBoss."
} else {
  Write-Host "Touch injection left OFF. Verify Live2D rendering first."
}

Write-Host ""
Write-Host "Starter ready: $InstallDir"
Write-Host "Next: put your licensed model in src/renderer/public/model and adjust pet.config.json model.path"
Write-Host "Start: cd '$InstallDir'; pnpm dev"
Write-Host "To enable local CyberBoss touch AFTER verified:"
Write-Host "  & '$PSCommandPath' -InstallDir '$InstallDir' -EnableTouch -SkipInstall"
