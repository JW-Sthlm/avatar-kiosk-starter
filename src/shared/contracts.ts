export interface BrandSummary {
  partnerName: string;
  partnerShortName: string;
  credit: string;
  accentColor: string;
  customerName: string;
  customerShortName: string;
  tagline: string;
  logoUrl?: string;
}

export interface RuntimeConfig {
  speechConfigured: boolean;
  voiceLiveConfigured: boolean;
  assistantMode: "mock" | "real";
  region: string;
  voiceName: string;
  avatarCharacter: string;
  avatarStyle: string;
  voiceLive: VoiceLiveRuntimeConfig;
  brand: BrandSummary;
}

export interface VoiceLiveAuthSummary {
  apiKeyConfigured: boolean;
  entraManualPossible: boolean;
  notes: string[];
}

export interface VoiceLiveRuntimeConfig {
  configured: boolean;
  endpointConfigured: boolean;
  modelConfigured: boolean;
  endpointHost?: string;
  endpointOrigin?: string;
  model?: string;
  apiVersion: string;
  auth: VoiceLiveAuthSummary;
  warnings: string[];
}

export interface SpeechTokenResponse {
  token: string;
  region: string;
  expiresInSeconds: number;
}

export interface RelayTokenResponse {
  urls: string[];
  username: string;
  credential: string;
}

export interface AssistantCard {
  title: string;
  body: string;
  tag?: string;
}

export interface ProductKnowledgeItem {
  id: string;
  title: string;
  category: string;
  summary: string;
  sourceTitle: string;
  sourceUrl: string;
  tags: string[];
}

export interface KnowledgeSource {
  title: string;
  category: string;
  sourceTitle: string;
  sourceUrl: string;
  excerpt: string;
}

export type GuardrailStatus = "allowed" | "handoff" | "out-of-scope";

export interface GuardrailResult {
  status: GuardrailStatus;
  scope: "retail" | "customer-account" | "unsupported";
  reasons: string[];
  safeCompletion: string;
  requiresHandoff: boolean;
}

export interface AssistantRequest {
  sessionId: string;
  utterance: string;
  mode?: "mock" | "real";
}

export interface AssistantResponse {
  text: string;
  cards: AssistantCard[];
  handoffSuggested: boolean;
  source: "mock" | "assistant";
  latencyMs: number;
  knowledgeSources?: KnowledgeSource[];
  guardrails?: GuardrailResult;
}

export interface TimelineEvent {
  at: string;
  name: string;
  detail?: Record<string, unknown>;
}

export interface ValidationExport {
  sessionId: string;
  exportedAt: string;
  runtimeConfig?: RuntimeConfig;
  latestTranscript?: string;
  latestNoiseFloor?: number;
  latestPeakLevel?: number;
  testerNotes: string;
  timeline: TimelineEvent[];
}

export interface VoiceLiveReadiness {
  configured: boolean;
  missing: string[];
  endpointConfigured: boolean;
  modelConfigured: boolean;
  endpointHost?: string;
  endpointOrigin?: string;
  model?: string;
  apiVersion: string;
  websocketUrl?: string;
  auth: VoiceLiveAuthSummary;
  capabilities: string[];
  manualNextSteps: string[];
  warnings: string[];
  message: string;
}

export interface VoiceLiveSessionPlanRequest {
  instructions?: string;
  locale?: string;
}

export interface VoiceLiveSessionPlan {
  configured: true;
  endpointHost: string;
  endpointOrigin: string;
  model: string;
  apiVersion: string;
  websocketUrl: string;
  auth: VoiceLiveAuthSummary;
  sessionUpdate: Record<string, unknown>;
  capabilities: string[];
  manualNextSteps: string[];
  warnings: string[];
  message: string;
}

