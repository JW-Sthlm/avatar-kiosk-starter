param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$PrototypePassword = ""
)

$ErrorActionPreference = "Stop"
$webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

if ($PrototypePassword) {
  $login = Invoke-WebRequest `
    -Uri "$BaseUrl/access" `
    -Method Post `
    -Body @{ password = $PrototypePassword; returnTo = "/" } `
    -WebSession $webSession `
    -SkipHttpErrorCheck

  if ($login.StatusCode -ne 200) {
    throw "Prototype access login failed with status $($login.StatusCode)"
  }
  Write-Host "Prototype access gate: authenticated"
}

$health = Invoke-RestMethod -Uri "$BaseUrl/health" -WebSession $webSession
if ($health.status -ne "ok") {
  throw "Health check failed"
}

$config = Invoke-RestMethod -Uri "$BaseUrl/api/config" -WebSession $webSession
Write-Host "Health:" $health.status
Write-Host "Speech configured:" $config.speechConfigured
Write-Host "Voice Live configured:" $config.voiceLiveConfigured
Write-Host "Assistant mode:" $config.assistantMode

$voiceLive = Invoke-RestMethod -Uri "$BaseUrl/api/voice-live/readiness" -WebSession $webSession
Write-Host "Voice Live readiness:" $voiceLive.configured

if (-not $voiceLive.configured) {
  $voiceLiveCreate = Invoke-WebRequest `
    -Uri "$BaseUrl/api/voice-live/sessions" `
    -Method Post `
    -WebSession $webSession `
    -SkipHttpErrorCheck
  if ($voiceLiveCreate.StatusCode -ne 409) {
    throw "Voice Live missing configuration check failed"
  }
  Write-Host "Voice Live missing configuration handling:" $voiceLiveCreate.StatusCode
}

$voiceLiveMissingSession = Invoke-WebRequest `
  -Uri "$BaseUrl/api/voice-live/sessions/not-a-session/avatar-offer" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{ clientSdp = "v=0`r`n" } | ConvertTo-Json) `
  -WebSession $webSession `
  -SkipHttpErrorCheck
if ($voiceLiveMissingSession.StatusCode -ne 404) {
  throw "Voice Live invalid session check failed"
}
Write-Host "Voice Live invalid session handling:" $voiceLiveMissingSession.StatusCode

$voiceLiveMissingDelete = Invoke-WebRequest `
  -Uri "$BaseUrl/api/voice-live/sessions/not-a-session" `
  -Method Delete `
  -WebSession $webSession `
  -SkipHttpErrorCheck
if ($voiceLiveMissingDelete.StatusCode -ne 404) {
  throw "Voice Live missing session delete check failed"
}
Write-Host "Voice Live missing session cleanup:" $voiceLiveMissingDelete.StatusCode

$knowledge = Invoke-RestMethod -Uri "$BaseUrl/api/knowledge" -WebSession $webSession
if (-not $knowledge.items -or $knowledge.items.Count -lt 4) {
  throw "Knowledge endpoint did not return the product catalogue"
}
Write-Host "Catalogue items:" $knowledge.items.Count

$mockBody = @{
  sessionId = "smoke-test"
  utterance = "She travels a lot in Europe."
} | ConvertTo-Json

$mock = Invoke-RestMethod -Uri "$BaseUrl/api/assistant/respond" -Method Post -ContentType "application/json" -Body $mockBody -WebSession $webSession
if (-not $mock.text -or $mock.source -ne "mock") {
  throw "Mock Assistant response failed"
}
if (-not $mock.knowledgeSources -or -not $mock.guardrails) {
  throw "Mock Assistant response did not include RAG sources and guardrails"
}
Write-Host "Mock Assistant response:" $mock.source

$guardrailBody = @{
  sessionId = "smoke-test"
  utterance = "Can you cancel my contract and take my bank details?"
} | ConvertTo-Json

$guardrail = Invoke-RestMethod -Uri "$BaseUrl/api/assistant/respond" -Method Post -ContentType "application/json" -Body $guardrailBody -WebSession $webSession
if (-not $guardrail.handoffSuggested -or $guardrail.guardrails.status -ne "handoff") {
  throw "Guardrail handoff response failed"
}
Write-Host "Guardrail response:" $guardrail.guardrails.status

$page = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -WebSession $webSession
if ($page.StatusCode -ne 200 -or $page.Content -notmatch "Avatar kiosk|/assets/") {
  throw "Frontend page did not load as expected"
}
Write-Host "Frontend page:" $page.StatusCode

