# Auto commit + push. Mensagem: Backup: yyyy-MM-dd HH:mm:ss
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    Write-Host "ERRO: Nao e um repositorio git." -ForegroundColor Red
    exit 1
}

$GitExe = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (-not $GitExe) {
    $fallback = Join-Path $env:LOCALAPPDATA "Programs\Git\cmd\git.exe"
    if (Test-Path $fallback) {
        $GitExe = $fallback
    }
}
if (-not $GitExe) {
    Write-Host "ERRO: git.exe nao foi encontrado." -ForegroundColor Red
    exit 1
}

function Invoke-Git {
    & $GitExe -c gc.auto=0 @args
}

$branch = Invoke-Git rev-parse --abbrev-ref HEAD
if (-not $branch) {
    Write-Host "ERRO: Nao foi possivel determinar o branch." -ForegroundColor Red
    exit 1
}

$porcelain = Invoke-Git status --porcelain
if ($porcelain) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $message = "Backup: $timestamp"

    Invoke-Git add -A
    Invoke-Git commit -m $message
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO: commit falhou." -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "Commit: $message" -ForegroundColor Green
} else {
    Write-Host "Sem alteracoes para commit."
}

$upstream = Invoke-Git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push para origin/$branch (primeira vez)..."
    Invoke-Git push -u origin $branch
} else {
    Invoke-Git push
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: push falhou." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Backup concluido (branch $branch)." -ForegroundColor Green
exit 0
