targetScope = 'resourceGroup'

@description('Azure region for the web app, the Speech resource and monitoring.')
param location string = resourceGroup().location

@description('Short lowercase name used in resource names.')
param namePrefix string = 'avatarkiosk'

@description('Azure Speech region used by the app.')
param speechRegion string = location

@description('Azure Speech voice for the Speech avatar fallback.')
param speechVoice string = 'en-US-JennyNeural'

@description('Azure Speech avatar character.')
param avatarCharacter string = 'lisa'

@description('Azure Speech avatar style.')
param avatarStyle string = 'casual-sitting'

@description('Optional assistant API endpoint. Leave empty for mock mode.')
param assistantApiUrl string = ''

@secure()
@description('Optional assistant API key. Leave empty for mock mode.')
param assistantApiKey string = ''

@description('Create an Azure AI Services resource for Voice Live in this deployment. Set to false to bring your own with voiceLiveEndpoint and voiceLiveApiKey.')
param provisionVoiceLive bool = true

@description('Endpoint of an existing Voice Live resource. Only used when you bring your own.')
param voiceLiveEndpoint string = ''

@description('Voice Live model for realtime sessions.')
param voiceLiveModel string = 'gpt-realtime'

@description('Voice Live API version.')
param voiceLiveApiVersion string = '2025-10-01'

@secure()
@description('Key for an existing Voice Live resource. Only needed when you bring your own.')
param voiceLiveApiKey string = ''

@description('Voice Live voice, for example en-US-Ava:DragonHDLatestNeural.')
param voiceLiveVoice string = 'en-US-Ava:DragonHDLatestNeural'

@description('Voice Live avatar character.')
param voiceLiveAvatarCharacter string = 'lisa'

@description('Voice Live avatar style.')
param voiceLiveAvatarStyle string = 'casual-sitting'

@description('Region for the Voice Live resource. Pick one that supports Voice Live avatars: https://learn.microsoft.com/azure/ai-services/speech-service/regions')
param voiceLiveRegion string = location

@secure()
@description('Optional password for the prototype access gate. Leave empty to skip the gate.')
param prototypeAccessPassword string = ''

var suffix = uniqueString(resourceGroup().id, namePrefix)
var appName = '${namePrefix}-web-${suffix}'
var planName = '${namePrefix}-plan-${suffix}'
var speechName = '${namePrefix}-speech-${suffix}'
var voiceLiveName = '${namePrefix}-voicelive-${suffix}'
var useProvisionedVoiceLive = provisionVoiceLive && empty(voiceLiveEndpoint)
var effectiveVoiceLiveEndpoint = useProvisionedVoiceLive
  ? 'https://${voiceLiveName}.cognitiveservices.azure.com'
  : voiceLiveEndpoint
var workspaceName = '${namePrefix}-law-${suffix}'
var appInsightsName = '${namePrefix}-appi-${suffix}'

resource speech 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: speechName
  location: speechRegion
  sku: {
    name: 'S0'
  }
  kind: 'SpeechServices'
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

// Azure AI Services resource that backs the Voice Live API.
resource voiceLive 'Microsoft.CognitiveServices/accounts@2023-05-01' = if (useProvisionedVoiceLive) {
  name: voiceLiveName
  location: voiceLiveRegion
  sku: {
    name: 'S0'
  }
  kind: 'AIServices'
  properties: {
    customSubDomainName: voiceLiveName
    publicNetworkAccess: 'Enabled'
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
  }
}

resource plan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: planName
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2022-09-01' = {
  name: appName
  location: location
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      alwaysOn: true
      healthCheckPath: '/health'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'AZURE_SPEECH_KEY'
          value: speech.listKeys().key1
        }
        {
          name: 'AZURE_SPEECH_REGION'
          value: speechRegion
        }
        {
          name: 'AZURE_SPEECH_VOICE'
          value: speechVoice
        }
        {
          name: 'AZURE_AVATAR_CHARACTER'
          value: avatarCharacter
        }
        {
          name: 'AZURE_AVATAR_STYLE'
          value: avatarStyle
        }
        {
          name: 'ASSISTANT_API_URL'
          value: assistantApiUrl
        }
        {
          name: 'ASSISTANT_API_KEY'
          value: assistantApiKey
        }
        {
          name: 'AZURE_VOICE_LIVE_ENDPOINT'
          value: effectiveVoiceLiveEndpoint
        }
        {
          name: 'AZURE_VOICE_LIVE_API_KEY'
          value: useProvisionedVoiceLive ? voiceLive!.listKeys().key1 : voiceLiveApiKey
        }
        {
          name: 'AZURE_VOICE_LIVE_MODEL'
          value: voiceLiveModel
        }
        {
          name: 'AZURE_VOICE_LIVE_API_VERSION'
          value: voiceLiveApiVersion
        }
        {
          name: 'AZURE_VOICE_LIVE_VOICE'
          value: voiceLiveVoice
        }
        {
          name: 'AZURE_VOICE_LIVE_AVATAR_CHARACTER'
          value: voiceLiveAvatarCharacter
        }
        {
          name: 'AZURE_VOICE_LIVE_AVATAR_STYLE'
          value: voiceLiveAvatarStyle
        }
        {
          name: 'AZURE_VOICE_LIVE_REGION'
          value: voiceLiveRegion
        }
        {
          name: 'PROTOTYPE_ACCESS_PASSWORD'
          value: prototypeAccessPassword
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
      ]
    }
  }
}

output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output speechName string = speech.name
output appInsightsName string = appInsights.name
output voiceLiveResourceName string = useProvisionedVoiceLive ? voiceLiveName : ''
output voiceLiveEndpoint string = effectiveVoiceLiveEndpoint
