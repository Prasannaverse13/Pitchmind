# PitchMind -> Azure Container Apps. Safe to run again.
# Uses only built in az commands plus one ARM template. It does not need the containerapp extension.
# Run from D:\pitchmind :   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"   # stops az acr build log crashes on Windows
$ROLE_AI_USER = "53ca6127-db72-4b80-b1b0-d745d6d5456d"   # Azure AI User

function Step($t) { Write-Host "`n== $t" -ForegroundColor Green }
function AzOk { if ($LASTEXITCODE -ne 0) { throw "az command failed. See the message above." } }

Step "Find your Foundry account"
$acct = az cognitiveservices account list --query "[?name=='pitchmind-foundry'] | [0]" -o json | ConvertFrom-Json
AzOk
if (-not $acct) { throw "Could not find the pitchmind-foundry account in this subscription." }
$rg = $acct.resourceGroup
$loc = $acct.location
$sub = az account show --query id -o tsv
$tag = ($sub -replace "-", "").Substring(0, 6)
$acr = "pitchmindacr$tag"
$cosmos = "pitchmind-cosmos-$tag"
$storage = "pitchmindq$tag"      # Storage account that holds the match-events queue
# Cosmos DB serverless is sometimes full in a region. Set $env:PITCHMIND_COSMOS_LOCATION (for example "centralindia") to use another one.
$cosmosLoc = if ($env:PITCHMIND_COSMOS_LOCATION) { $env:PITCHMIND_COSMOS_LOCATION } else { $loc }
$endpoint = "https://pitchmind-foundry.services.ai.azure.com/api/projects/pitchmind"
$ver = Get-Date -Format "yyyyMMddHHmmss"
Write-Host "Resource group: $rg   Region: $loc   Registry: $acr   Cosmos: $cosmos ($cosmosLoc)   Version: $ver"

Step "Register Azure providers (first time takes a few minutes)"
foreach ($p in "Microsoft.App", "Microsoft.ContainerRegistry", "Microsoft.OperationalInsights", "Microsoft.DocumentDB", "Microsoft.Insights", "Microsoft.Storage", "Microsoft.Web") {
  az provider register --namespace $p --wait | Out-Null; AzOk
}

Step "Container registry"
az acr create --name $acr --resource-group $rg --sku Basic --admin-enabled true --location $loc --only-show-errors | Out-Null; AzOk
$acrUser = az acr credential show --name $acr --query username -o tsv
$acrPass = az acr credential show --name $acr --query "passwords[0].value" -o tsv
$server = "$acr.azurecr.io"

Step "Build the API image in Azure"
az acr build --registry $acr --image "pitchmind-api:$ver" --file backend.Dockerfile . ; AzOk

function Deploy($withWeb) {
  $params = @{
    '$schema' = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#"
    contentVersion = "1.0.0.0"
    parameters = @{
      location        = @{ value = $loc }
      acrServer       = @{ value = $server }
      acrUser         = @{ value = $acrUser }
      acrPass         = @{ value = $acrPass }
      foundryEndpoint = @{ value = $endpoint }
      tag             = @{ value = $ver }
      deployWeb       = @{ value = $withWeb }
      cosmosName      = @{ value = $cosmos }
      cosmosLocation  = @{ value = $cosmosLoc }
      storageName     = @{ value = $storage }
    }
  }
  $file = Join-Path $env:TEMP "pitchmind-params.json"
  $params | ConvertTo-Json -Depth 6 | Set-Content -Path $file -Encoding ascii
  az deployment group create --resource-group $rg --template-file deploy\pitchmind.json --parameters "@$file" --name "pitchmind-$ver" --only-show-errors | Out-Null; AzOk
  Remove-Item $file -ErrorAction SilentlyContinue
}

Step "Create Cosmos DB, Application Insights, the event queue, the environment and the API (first run takes about 5 to 10 minutes)"
Deploy $false

Step "Let the API use Foundry (Azure AI User role)"
$principal = az resource show --resource-group $rg --resource-type Microsoft.App/containerApps --name pitchmind-api --api-version 2024-03-01 --query identity.principalId -o tsv; AzOk
az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role $ROLE_AI_USER --scope $acct.id --only-show-errors | Out-Null
# A repeat run says the assignment already exists. That is fine.
$apiHost = az resource show --resource-group $rg --resource-type Microsoft.App/containerApps --name pitchmind-api --api-version 2024-03-01 --query properties.configuration.ingress.fqdn -o tsv; AzOk
$apiUrl = "https://$apiHost"
Write-Host "API: $apiUrl"

Step "Let you use the same Cosmos DB from your laptop (optional, for local runs)"
$ErrorActionPreference = "Continue"
try {
  $me = az ad signed-in-user show --query id -o tsv
  if ($me) {
    $cosmosId = az cosmosdb show --name $cosmos --resource-group $rg --query id -o tsv
    az cosmosdb sql role assignment create --account-name $cosmos --resource-group $rg --scope $cosmosId --principal-id $me --role-definition-id 00000000-0000-0000-0000-000000000002 --only-show-errors | Out-Null
    $cosmosEp = az cosmosdb show --name $cosmos --resource-group $rg --query documentEndpoint -o tsv
    Write-Host "To use Cosmos locally add this line to backend\.env :  COSMOS_ENDPOINT=$cosmosEp"
  }
} catch { Write-Host "Skipped the local access step. That is fine." -ForegroundColor Yellow }
$ErrorActionPreference = "Stop"

Step "Build the web image in Azure"
az acr build --registry $acr --image "pitchmind-web:$ver" --build-arg "NEXT_PUBLIC_API=$apiUrl" web ; AzOk

Step "Deploy the web app"
Deploy $true
$webHost = az resource show --resource-group $rg --resource-type Microsoft.App/containerApps --name pitchmind-web --api-version 2024-03-01 --query properties.configuration.ingress.fqdn -o tsv; AzOk

Step "Deploy the settlement function (Azure Functions, queue trigger). Optional: the API settles in process if this is skipped"
$ErrorActionPreference = "Continue"
try { & "$PSScriptRoot\deploy-functions.ps1" -ResourceGroup $rg -Location $loc -Storage $storage -Tag $tag -ApiUrl $apiUrl }
catch { Write-Host "Function deploy skipped: $($_.Exception.Message)" -ForegroundColor Yellow }
$ErrorActionPreference = "Stop"

Step "Check (waits for the API and the Cosmos DB league)"
$ok = $false
for ($i = 0; $i -lt 18; $i++) {
  Start-Sleep -Seconds 10
  try {
    $h = Invoke-RestMethod "$apiUrl/api/health"
    Write-Host ($h | ConvertTo-Json -Compress)
    if ($h.league.ready) { $ok = $true; break }
    try { Invoke-RestMethod "$apiUrl/api/ladder" | Out-Null } catch { }   # nudges the league to retry
  } catch { Write-Host "API starting..." }
}
if (-not $ok) { Write-Host "League storage is not ready yet. New Cosmos roles can take a few minutes. Open the health link below again soon." -ForegroundColor Yellow }

Write-Host "`nDONE" -ForegroundColor Green
Write-Host "Open the app:  https://$webHost"
Write-Host "API health:    $apiUrl/api/health   (shows telemetry and events as true when wired up)"
Write-Host "Tracing:       Azure portal > pitchmind-insights > Investigate > Transaction search / Application map"
