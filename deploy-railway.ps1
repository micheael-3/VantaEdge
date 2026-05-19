#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot Railway deploy for VantaEdge (backend + frontend + Postgres).

.DESCRIPTION
  After `railway login`, this script creates the Railway project, provisions
  Postgres, deploys both services from this repo, generates public domains,
  and sets every environment variable. The only thing you paste is your three
  API keys.

.REQUIREMENTS
  - Railway CLI: npm i -g @railway/cli   (the script will install if missing)
  - You ran `railway login` once in this shell (browser flow)
  - You've pushed this repo to GitHub (the GitHub-source services need a remote)
#>

$ErrorActionPreference = 'Stop'

function Section($title) {
  Write-Host ""
  Write-Host "==> $title" -ForegroundColor Cyan
}

function ReadSecret($prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function NewSecret([int]$bytes = 64) {
  $buf = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return ([System.BitConverter]::ToString($buf)).Replace('-', '').ToLower()
}

# ----------------------------------------------------------------------------
# 0. Railway CLI presence + login check
# ----------------------------------------------------------------------------
Section "Checking Railway CLI"
if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Host "Railway CLI not found. Installing globally with npm..." -ForegroundColor Yellow
  npm install -g @railway/cli
  if ($LASTEXITCODE -ne 0) { throw "Failed to install @railway/cli" }
}
railway --version

Section "Verifying you're logged in"
$whoami = railway whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Run 'railway login' (it opens a browser), then re-run this script." -ForegroundColor Red
  exit 1
}
Write-Host $whoami

# ----------------------------------------------------------------------------
# 1. Collect the only three secrets the user must paste
# ----------------------------------------------------------------------------
Section "Paste your three API keys"
Write-Host "These are the only inputs you need to type. Everything else is auto-generated." -ForegroundColor Gray
$FOOTBALL_API_KEY        = ReadSecret "FOOTBALL_API_KEY (from dashboard.api-football.com)"
$OPENROUTER_API_KEY      = ReadSecret "OPENROUTER_API_KEY (from openrouter.ai/keys)"
$REVENUECAT_WEBHOOK_SECRET = ReadSecret "REVENUECAT_WEBHOOK_SECRET (any strong string, also paste into RevenueCat webhook header)"

if (-not $FOOTBALL_API_KEY -or -not $OPENROUTER_API_KEY -or -not $REVENUECAT_WEBHOOK_SECRET) {
  throw "All three keys are required."
}

Section "Generating JWT secrets"
$JWT_SECRET         = NewSecret 64
$JWT_REFRESH_SECRET = NewSecret 64
Write-Host "JWT secrets generated (128 hex chars each)." -ForegroundColor Green

# ----------------------------------------------------------------------------
# 2. Project + Postgres
# ----------------------------------------------------------------------------
Section "Creating Railway project: vantaedge"
railway init --name vantaedge
if ($LASTEXITCODE -ne 0) { throw "railway init failed" }

Section "Adding Postgres plugin"
railway add --database postgres
if ($LASTEXITCODE -ne 0) { throw "railway add postgres failed" }

# ----------------------------------------------------------------------------
# 3. Backend service
# ----------------------------------------------------------------------------
Section "Creating backend service (root: backend/)"
railway add --service vantaedge-backend
if ($LASTEXITCODE -ne 0) { throw "creating backend service failed" }
railway service vantaedge-backend

# Set every backend variable except the cross-service URL (frontend not deployed yet)
Section "Setting backend env vars"
railway variables `
  --set "NODE_ENV=production" `
  --set "JWT_SECRET=$JWT_SECRET" `
  --set "JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET" `
  --set "FOOTBALL_API_KEY=$FOOTBALL_API_KEY" `
  --set "OPENROUTER_API_KEY=$OPENROUTER_API_KEY" `
  --set "REVENUECAT_WEBHOOK_SECRET=$REVENUECAT_WEBHOOK_SECRET" `
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}'

Section "Deploying backend (this builds + runs `prisma migrate deploy`)"
Push-Location "$PSScriptRoot\backend"
railway up --service vantaedge-backend --detach
Pop-Location

Section "Generating backend public domain"
railway domain --service vantaedge-backend
$backendUrl = (railway variables --service vantaedge-backend --json | ConvertFrom-Json).RAILWAY_PUBLIC_DOMAIN
if (-not $backendUrl) {
  # Fallback: query domains directly
  $backendUrl = (railway domain --service vantaedge-backend --json 2>$null | ConvertFrom-Json).domain
}
if ($backendUrl -and -not $backendUrl.StartsWith("https://")) { $backendUrl = "https://$backendUrl" }
Write-Host "Backend URL: $backendUrl" -ForegroundColor Green

# ----------------------------------------------------------------------------
# 4. Frontend service
# ----------------------------------------------------------------------------
Section "Creating frontend service (root: frontend/)"
railway add --service vantaedge-frontend
railway service vantaedge-frontend

Section "Setting VITE_API_URL on frontend"
railway variables --set "VITE_API_URL=$backendUrl"

Section "Deploying frontend"
Push-Location "$PSScriptRoot\frontend"
railway up --service vantaedge-frontend --detach
Pop-Location

Section "Generating frontend public domain"
railway domain --service vantaedge-frontend
$frontendUrl = (railway variables --service vantaedge-frontend --json | ConvertFrom-Json).RAILWAY_PUBLIC_DOMAIN
if (-not $frontendUrl) {
  $frontendUrl = (railway domain --service vantaedge-frontend --json 2>$null | ConvertFrom-Json).domain
}
if ($frontendUrl -and -not $frontendUrl.StartsWith("https://")) { $frontendUrl = "https://$frontendUrl" }
Write-Host "Frontend URL: $frontendUrl" -ForegroundColor Green

# ----------------------------------------------------------------------------
# 5. Round-trip: tell the backend about the frontend (for CORS + cookies)
# ----------------------------------------------------------------------------
Section "Setting FRONTEND_URL on backend (required for CORS + cross-site cookies)"
railway service vantaedge-backend
railway variables --set "FRONTEND_URL=$frontendUrl"
Write-Host "Backend will redeploy to pick up the new FRONTEND_URL." -ForegroundColor Yellow

# ----------------------------------------------------------------------------
# Done
# ----------------------------------------------------------------------------
Section "Done"
Write-Host ""
Write-Host "Backend:  $backendUrl"  -ForegroundColor Green
Write-Host "Frontend: $frontendUrl" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Open $frontendUrl in your browser and register a test account."
Write-Host "  2. (Optional) Configure the RevenueCat webhook to:"
Write-Host "       $backendUrl/api/webhook/revenuecat"
Write-Host "     with Authorization header = your REVENUECAT_WEBHOOK_SECRET."
Write-Host ""
Write-Host "Logs:  railway logs --service vantaedge-backend"
Write-Host "       railway logs --service vantaedge-frontend"
