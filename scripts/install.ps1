# One-shot installer for olama-trades (Windows)
# Assumptions: PowerShell 5+; Node.js 20+ on PATH; network for npm.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host ""
Write-Host "  Solana Terminal Bot — installer" -ForegroundColor Cyan
Write-Host "  Dry-run by default · secrets stay local" -ForegroundColor DarkGray
Write-Host ""

function Test-NodeVersion {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is not installed." -ForegroundColor Red
    Write-Host "Install Node 20+ from https://nodejs.org/ then re-run this script."
    exit 1
  }
  $ver = (node -v).TrimStart("v")
  $major = [int]($ver.Split(".")[0])
  if ($major -lt 20) {
    Write-Host "Node.js >= 20 required (found v$ver)." -ForegroundColor Red
    Write-Host "Upgrade: https://nodejs.org/"
    exit 1
  }
  Write-Host "OK Node v$ver" -ForegroundColor Green
}

function Upsert-Env([string]$Key, [string]$Val) {
  if ([string]::IsNullOrWhiteSpace($Val)) { return }
  $envFile = Join-Path $Root ".env"
  $text = if (Test-Path $envFile) { Get-Content $envFile -Raw } else { "" }
  $line = "$Key=$Val"
  $pattern = "(?m)^#?\s*$([regex]::Escape($Key))=.*$"
  if ($text -match $pattern) {
    $text = [regex]::Replace($text, $pattern, $line, 1)
  } else {
    $text = $text.TrimEnd() + "`n$line`n"
  }
  Set-Content -Path $envFile -Value $text -NoNewline
}

function Prompt-Secret([string]$VarName, [string]$Hint) {
  $secure = Read-Host -Prompt "  $Hint (blank = skip/keep)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  if ([string]::IsNullOrWhiteSpace($plain)) { return }
  Upsert-Env $VarName $plain
  Write-Host "  Saved $VarName (value hidden)" -ForegroundColor Green
}

Test-NodeVersion
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "npm not found." -ForegroundColor Red
  exit 1
}

Write-Host "Installing npm dependencies..." -ForegroundColor DarkGray
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example (DRY_RUN=true)" -ForegroundColor Green
} else {
  Write-Host "Keeping existing .env" -ForegroundColor Green
}

Write-Host "Building TypeScript..." -ForegroundColor DarkGray
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Optional connections (Enter/blank to skip)" -ForegroundColor White
Write-Host "  Jupiter: https://portal.jup.ag/" -ForegroundColor DarkGray
Write-Host "  X/Twitter: https://developer.x.com/" -ForegroundColor DarkGray
Write-Host "  Ollama: https://ollama.com/ (ollama pull qwen2.5-coder:14b)" -ForegroundColor DarkGray
Write-Host "  xAI fallback (optional): https://console.x.ai/" -ForegroundColor DarkGray
Prompt-Secret "JUPITER_API_KEY" "Jupiter API key"
Prompt-Secret "X_BEARER_TOKEN" "X/Twitter bearer token"
Prompt-Secret "XAI_API_KEY" "xAI API key (optional fallback)"
Prompt-Secret "HELIUS_API_KEY" "Helius API key (optional)"
$rpc = Read-Host "  Custom RPC_URL (blank = keep)"
if (-not [string]::IsNullOrWhiteSpace($rpc)) {
  Upsert-Env "RPC_URL" $rpc
  Write-Host "  Updated RPC_URL" -ForegroundColor Green
}

$walletPath = Join-Path $Root ".wallet\keypair.json"
if (-not (Test-Path $walletPath)) {
  Write-Host "Creating bot wallet..." -ForegroundColor DarkGray
  npm run bot -- wallet create
} else {
  Write-Host "Existing wallet kept (.wallet/keypair.json)" -ForegroundColor Green
}

$addr = (npm run bot -- wallet address 2>$null | Select-Object -Last 1)

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Fundable public address: $addr" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps"
Write-Host "  1. Connections wizard:  npm run bot -- setup"
Write-Host "  2. Fund the address above with a little SOL"
Write-Host "  3. Arm bot (still dry-run):  npm run bot -- bot on"
Write-Host "  4. Scan:  npm run bot -- scan"
Write-Host "  5. Terminal UI:  npm run bot -- dashboard"
Write-Host "  6. Browser UI:  npm run bot -- web"
Write-Host ""
Write-Host "DRY_RUN stays true until you edit .env. Never commit .env or .wallet/" -ForegroundColor Yellow
