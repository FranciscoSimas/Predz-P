# Menu interactivo:
#   1) Commit + push (escolhe branch main/dev e mensagem)
#   2) Merge ff-only de dev -> main e regressa a dev
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

function Assert-GitOk {
    param([string]$Context)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO: $Context (codigo $LASTEXITCODE)." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

function Read-Choice {
    param(
        [string]$Prompt,
        [string[]]$Valid
    )
    while ($true) {
        $raw = Read-Host $Prompt
        $value = if ($null -eq $raw) { "" } else { $raw.Trim() }
        if ($Valid -contains $value) {
            return $value
        }
        Write-Host "Opcao invalida. Escolhe: $($Valid -join ', ')" -ForegroundColor Yellow
    }
}

$current = Invoke-Git rev-parse --abbrev-ref HEAD
if (-not $current) {
    Write-Host "ERRO: Nao foi possivel determinar o branch." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Branch actual: $current" -ForegroundColor Cyan
Write-Host ""
Write-Host "O que queres fazer?"
Write-Host "   1 - Commit and push"
Write-Host "   2 - Merge dev into main"
$action = Read-Choice -Prompt "Escolhe 1 ou 2" -Valid @("1", "2")

if ($action -eq "2") {
    Write-Host ""
    Write-Host "ATENCAO: isto actualiza PRODUCAO (predz.app) se o merge for ff-only." -ForegroundColor Yellow
    $confirmMerge = Read-Choice -Prompt "Continuar? (s/N)" -Valid @("s", "S", "n", "N", "")
    if ($confirmMerge -notin @("s", "S")) {
        Write-Host "Cancelado." -ForegroundColor Yellow
        exit 0
    }

    $dirty = Invoke-Git status --porcelain
    if ($dirty) {
        Write-Host "ERRO: ha alteracoes locais por commit. Faz Commit and push (opcao 1) primeiro." -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "Merge ff-only: dev -> main..." -ForegroundColor Cyan

    Invoke-Git checkout main
    Assert-GitOk "checkout main"

    Invoke-Git pull origin main
    Assert-GitOk "pull origin main"

    Invoke-Git merge --ff-only dev
    Assert-GitOk "merge --ff-only dev"

    Invoke-Git push origin main
    Assert-GitOk "push origin main"

    Invoke-Git checkout dev
    Assert-GitOk "checkout dev"

    Write-Host "Merge concluido. Estas em dev; main = origin/main." -ForegroundColor Green
    exit 0
}

# --- Opcao 1: Commit and push ---

Write-Host ""
Write-Host "A) Qual branch enviar?"
Write-Host "   1 - main   (producao / predz.app)"
Write-Host "   2 - dev    (testes / dev.predz.app)"
$branchChoice = Read-Choice -Prompt "Escolhe 1 ou 2" -Valid @("1", "2")
$target = if ($branchChoice -eq "1") { "main" } else { "dev" }

if ($target -eq "main") {
    Write-Host ""
    Write-Host "ATENCAO: main actualiza PRODUCAO (predz.app)." -ForegroundColor Yellow
    $confirm = Read-Choice -Prompt "Tens a certeza? (s/N)" -Valid @("s", "S", "n", "N", "")
    if ($confirm -notin @("s", "S")) {
        Write-Host "Cancelado." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "B) Qual commit queres?"
Write-Host "   1 - Backup generico (Backup: data/hora)"
Write-Host "   2 - Commit custom"
$commitChoice = Read-Choice -Prompt "Escolhe 1 ou 2" -Valid @("1", "2")

$message = $null
if ($commitChoice -eq "1") {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $message = "Backup: $timestamp"
} else {
    while ($true) {
        $custom = Read-Host "Mensagem do commit"
        if ($custom -and $custom.Trim()) {
            $message = $custom.Trim()
            break
        }
        Write-Host "Mensagem vazia. Escreve algo." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Resumo: branch=$target | commit=$message" -ForegroundColor Cyan
Write-Host "A processar..." -ForegroundColor Cyan

$stashed = $false
if ($current -ne $target) {
    $porcelainBefore = Invoke-Git status --porcelain
    if ($porcelainBefore) {
        Write-Host "Alteracoes locais: stash temporario para mudar para $target..."
        Invoke-Git stash push -u -m "git-backup-2: temp before checkout $target"
        Assert-GitOk "stash"
        $stashed = $true
    }

    Write-Host "Checkout $target..."
    Invoke-Git checkout $target
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO: checkout $target falhou." -ForegroundColor Red
        if ($stashed) {
            Write-Host "A restaurar stash na branch $current..."
            Invoke-Git checkout $current 2>$null
            Invoke-Git stash pop 2>$null
        }
        exit 1
    }

    if ($stashed) {
        Write-Host "A aplicar stash em $target..."
        Invoke-Git stash pop
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERRO: stash pop falhou (conflitos?). Resolve manualmente." -ForegroundColor Red
            Write-Host "O stash pode ainda estar em 'git stash list'." -ForegroundColor Yellow
            exit $LASTEXITCODE
        }
    }

    $current = $target
}

$porcelain = Invoke-Git status --porcelain
if ($porcelain) {
    Invoke-Git add -A
    Assert-GitOk "git add"
    Invoke-Git commit -m $message
    Assert-GitOk "commit"
    Write-Host "Commit: $message" -ForegroundColor Green
} else {
    Write-Host "Sem alteracoes para commit (so push, se houver)."
}

$upstream = Invoke-Git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push para origin/$target (primeira vez)..."
    Invoke-Git push -u origin $target
} else {
    Invoke-Git push
}
Assert-GitOk "push"

Write-Host "Backup concluido (branch $target)." -ForegroundColor Green
exit 0
