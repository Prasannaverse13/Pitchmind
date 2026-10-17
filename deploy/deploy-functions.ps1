# Deploys the PitchMind settlement function (Azure Functions, Flex Consumption, Python).
# Normally called by deploy.ps1. You can also run it alone after deploy.ps1 has run once:
#   powershell -ExecutionPolicy Bypass -File deploy\deploy-functions.ps1 -ResourceGroup <rg> -Location <region> -Storage <storage> -Tag <tag> -ApiUrl <https://api...>
param(
  [Parameter(Mandatory = $true)][string]$ResourceGroup,
  [Parameter(Mandatory = $true)][string]$Location,
  [Parameter(Mandatory = $true)][string]$Storage,
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$ApiUrl
)
$ErrorActionPreference = "Stop"
$ROLE_QUEUE_CONTRIBUTOR = "974c5e8b-45b9-4653-ba55-5f855dd0fb88"   # Storage Queue Data Contributor
function Step($t) { Write-Host "`n== $t" -ForegroundColor Green }
function AzOk { if ($LASTEXITCODE -ne 0) { throw "az command failed. See the message above." } }

$fn = "pitchmind-fn-$Tag"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "functions"

Step "Create the function app $fn (Flex Consumption, Python 3.11)"
$exists = az functionapp list --resource-group $ResourceGroup --query "[?name=='$fn'].name | [0]" -o tsv
if (-not $exists) {
  az functionapp create --name $fn --resource-group $ResourceGroup --flexconsumption-location $Location `
    --runtime python --runtime-version 3.11 --storage-account $Storage --app-insights pitchmind-insights --only-show-errors | Out-Null; AzOk
}

Step "Give the function its own identity and access to the queue (no keys)"
$principal = az functionapp identity assign --name $fn --resource-group $ResourceGroup --query principalId -o tsv; AzOk
$storageId = az storage account show --name $Storage --resource-group $ResourceGroup --query id -o tsv; AzOk
az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role $ROLE_QUEUE_CONTRIBUTOR --scope $storageId --only-show-errors | Out-Null
# A repeat run says the assignment already exists. That is fine.
az functionapp config appsettings set --name $fn --resource-group $ResourceGroup --only-show-errors `
  --settings "StorageConn__queueServiceUri=https://$Storage.queue.core.windows.net" "API_URL=$ApiUrl" | Out-Null; AzOk

Step "Publish the function code"
$zip = Join-Path $env:TEMP "pitchmind-functions.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
$files = Get-ChildItem $src -Force | Where-Object { $_.Name -notin @(".venv", "__pycache__", "local.settings.json", ".funcignore") }
Compress-Archive -Path $files.FullName -DestinationPath $zip -Force
az functionapp deployment source config-zip --name $fn --resource-group $ResourceGroup --src $zip --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "config-zip did not work. Trying az functionapp deploy..." -ForegroundColor Yellow
  az functionapp deploy --name $fn --resource-group $ResourceGroup --src-path $zip --type zip --only-show-errors | Out-Null; AzOk
}

Step "Check that the function is registered"
Start-Sleep -Seconds 20
az functionapp function list --name $fn --resource-group $ResourceGroup --query "[].name" -o tsv
Write-Host "Function app: $fn  (queue: $Storage / match-events)" -ForegroundColor Green
