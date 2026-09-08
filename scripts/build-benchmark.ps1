param(
  [ValidateSet('baseline','optimized')][string]$Variant = 'optimized',
  [string]$BaseRef = '330f61bd68f9a2ceb909524d514a0f1fe0eb2a24'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
$previousConfig = $env:TAURI_CONFIG
try {
  New-Item -ItemType Directory -Force '.perf' | Out-Null
  if ($Variant -eq 'baseline') {
    git archive --format=zip --output=.perf/baseline-source.zip $BaseRef src src-tauri
    if ($LASTEXITCODE -ne 0) { throw 'Cannot export the baseline ref' }
    Expand-Archive -LiteralPath '.perf/baseline-source.zip' -DestinationPath '.perf/baseline-source' -Force
    $manifest = '.perf/baseline-source/src-tauri/Cargo.toml'
  } else { $manifest = 'src-tauri/Cargo.toml' }
  $benchmarkConfig = Get-Content -Encoding UTF8 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
  $benchmarkConfig.identifier = 'com.starfishc.imagerail.benchmark'
  $benchmarkConfig.app.windows[0] | Add-Member -Force additionalBrowserArgs '--remote-debugging-port=9335'
  $benchmarkConfig.app.windows[0] | Add-Member -Force dataDirectory 'performance-test'
  $env:TAURI_CONFIG = $benchmarkConfig | ConvertTo-Json -Depth 10 -Compress
  cargo build --release --manifest-path $manifest --target-dir src-tauri/target
  if ($LASTEXITCODE -ne 0) { throw 'Benchmark build failed' }
  New-Item -ItemType Directory -Force ".perf/$Variant" | Out-Null
  Copy-Item -LiteralPath 'src-tauri/target/release/imagerail.exe' -Destination ".perf/$Variant/imagerail.exe"
} finally {
  $env:TAURI_CONFIG = $previousConfig
  Pop-Location
}
