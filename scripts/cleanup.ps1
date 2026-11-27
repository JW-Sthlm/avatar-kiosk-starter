param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,
  [string]$ResourceGroupName = "rg-avatar-kiosk"
)

$ErrorActionPreference = "Stop"

az group delete --subscription $SubscriptionId --name $ResourceGroupName --yes --no-wait
if ($LASTEXITCODE -ne 0) { throw "Could not start deleting $ResourceGroupName." }
Write-Host "Deleting resource group $ResourceGroupName. It takes a few minutes."
