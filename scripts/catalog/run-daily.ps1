# Mim 全量商城每日同步（Windows 本地/开发机）
# 用法：由「任务计划程序」每天 02:30 调用，或手动执行：
#   powershell -ExecutionPolicy Bypass -File scripts\catalog\run-daily.ps1
# 默认全量全分类、按 source_key 幂等累积；日志写 .catalog-sync\sync.log。
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')
$state = Join-Path $repo '.catalog-sync'
$images = Join-Path $repo 'storage\catalog-images'
New-Item -ItemType Directory -Force -Path $state, (Join-Path $state 'reports'), $images | Out-Null

$log = Join-Path $state 'sync.log'
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5242880)) {
  Move-Item -Force $log "$log.1"
}

$env:SYNC_STATE_DIR = $state
$env:CATALOG_IMAGE_DIR = $images
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
"[ $stamp ] ===== [egluosi] sync start =====" | Out-File -Append -Encoding utf8 $log

# 计划任务环境可能没有用户 PATH：先查命令，再回落到当前用户的 tools 目录
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:USERPROFILE 'tools\nodejs\node.exe' }
if (-not (Test-Path $node)) {
  "[ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ] [fatal] 未找到 node，请把 node 加入 PATH 或修改本脚本" | Out-File -Append -Encoding utf8 $log
  exit 127
}

Push-Location $repo
try {
  & $node (Join-Path $here 'cli.mjs') sync --site egluosi --max-runtime-min 150 --no-delist *>> $log
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    "[ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ] [retry] 首次失败 code=$code，30s 后续跑" | Out-File -Append -Encoding utf8 $log
    Start-Sleep -Seconds 30
    & $node (Join-Path $here 'cli.mjs') sync --site egluosi --resume --max-runtime-min 150 --no-delist *>> $log
    $code = $LASTEXITCODE
  }
  if ($code -eq 0) {
    "[ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ] ===== catalog sync OK =====" | Out-File -Append -Encoding utf8 $log
  } else {
    "[ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ] ===== catalog sync FAILED code=$code =====" | Out-File -Append -Encoding utf8 $log
  }
  exit $code
} finally {
  Pop-Location
}
