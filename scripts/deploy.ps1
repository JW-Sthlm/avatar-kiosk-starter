param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,
  [string]$ResourceGroupName = "rg-avatar-kiosk",
  [string]$Location = "westeurope",
  [string]$NamePrefix = "avatarkiosk",
  [string]$ParameterFile = "infra/main.parameters.json",
  [SecureString]$VoiceLiveApiKey,
  [SecureString]$PrototypeAccessPassword
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-PlainText([SecureString]$Value) {
  return [System.Net.NetworkCredential]::new("", $Value).Password
}

# Every az call names the subscription, so your default az context stays as it is.
$account = az account show --subscription $SubscriptionId --query "{name:name, user:user.name}" -o json | ConvertFrom-Json
if (-not $account) {
  throw "Run az login first, and check that you can use subscription $SubscriptionId."
}
Write-Host "Deploying to subscription '$($account.name)' as $($account.user)"

az group create --subscription $SubscriptionId --name $ResourceGroupName --location $Location | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not create resource group $ResourceGroupName." }

$paramArgs = @()
if ($ParameterFile -and (Test-Path $ParameterFile)) {
  $paramArgs += "@$ParameterFile"
}
$paramArgs += "location=$Location"
$paramArgs += "namePrefix=$NamePrefix"
if ($VoiceLiveApiKey) {
  $paramArgs += "voiceLiveApiKey=$(Get-PlainText $VoiceLiveApiKey)"
}
if ($PrototypeAccessPassword) {
  $paramArgs += "prototypeAccessPassword=$(Get-PlainText $PrototypeAccessPassword)"
}

$deployment = az deployment group create `
  --subscription $SubscriptionId `
  --resource-group $ResourceGroupName `
  --template-file "infra/main.bicep" `
  --parameters @paramArgs `
  --query "properties.outputs" `
  -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $deployment) { throw "The Bicep deployment failed. See the az output above." }

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

$packagePath = ".azure/package.zip"
if (Test-Path $packagePath) {
  Remove-Item $packagePath -Force
}

$publishPath = ".azure/publish"
if (Test-Path $publishPath) {
  Remove-Item $publishPath -Recurse -Force
}

New-Item -ItemType Directory -Path $publishPath | Out-Null
Copy-Item -Path "dist" -Destination $publishPath -Recurse
Copy-Item -Path "package.json","package-lock.json" -Destination $publishPath
Copy-Item -Path "branding" -Destination $publishPath -Recurse

Push-Location $publishPath
npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm ci --omit=dev failed." }
Compress-Archive -Path "dist","package.json","package-lock.json","node_modules","branding" -DestinationPath "../package.zip" -Force
Pop-Location

$webAppName = $deployment.webAppName.value
az webapp deploy `
  --subscription $SubscriptionId `
  --resource-group $ResourceGroupName `
  --name $webAppName `
  --src-path $packagePath `
  --type zip | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The zip deploy to $webAppName failed." }

Write-Host "Kiosk deployed:" $deployment.webAppUrl.value
