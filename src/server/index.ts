import "dotenv/config";
import "./telemetry.js";
import { track } from "./telemetry.js";
import express from "express";
import fs from "node:fs";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AssistantRequest,
  AssistantResponse,
  RuntimeConfig,
  VoiceLiveReadiness,
  VoiceLiveSessionPlan,
  VoiceLiveSessionPlanRequest
} from "../shared/contracts.js";
import { createMockAssistantResponse } from "./mockAssistant.js";
import { loadBrandConfig } from "./brandConfig.js";
import { evaluateKioskGuardrails, kioskKnowledgeBase } from "./kioskKnowledge.js";
import { createVoiceLiveRouter, attachVoiceLiveWebSocketServer } from "./voiceLiveRoutes.js";
import { VoiceLivePrototypeSessionStore } from "./voiceLiveSession.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const voiceLiveSessions = new VoiceLivePrototypeSessionStore();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? process.env.WEBSITES_PORT ?? 3000);
const builtClientDist = path.resolve(__dirname, "../web");
const shouldServeBuiltClient = isProduction || fs.existsSync(path.join(builtClientDist, "index.html"));
const voiceLiveDefaultApiVersion = "2025-10-01";
const voiceLiveEnv = {
  endpoint: ["AZURE_VOICE_LIVE_ENDPOINT", "AZURE_VOICELIVE_ENDPOINT"] as const,
  model: ["AZURE_VOICE_LIVE_MODEL", "AZURE_VOICELIVE_MODEL"] as const,
  apiVersion: ["AZURE_VOICE_LIVE_API_VERSION", "AZURE_VOICELIVE_API_VERSION"] as const,
  apiKey: ["AZURE_VOICE_LIVE_API_KEY", "AZURE_VOICELIVE_API_KEY"] as const
};
const voiceLiveCapabilities = [
  "Track B can create a server-side Voice Live session when endpoint, model, and API key are configured.",
  "Browser microphone chunks are forwarded through the backend broker; Azure keys never leave the server.",
  "Avatar media is negotiated through session.avatar.connect and delivered to the browser by WebRTC.",
  "No Voice Live API key, Assistant key, or bearer token is returned to browser code.",
  "Session plan includes Azure deep noise suppression, server echo cancellation, semantic VAD, Azure standard voice, and WebRTC avatar output."
];
const defaultVoiceLiveInstructions =
  "You are a concise retail kiosk assistant. Keep answers short, ask one clarifying question when needed, and stay focused on mobile plan support.";
const prototypeAccessPassword = process.env.PROTOTYPE_ACCESS_PASSWORD?.trim();
const prototypeAccessCookieName = "assistant_avatar_access";
const prototypeAccessCookieMarker = "assistant-avatar-prototype-access-v1";
const prototypeAccessCookieMaxAgeSeconds = 12 * 60 * 60;

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function getPrototypeAccessCookieValue(): string {
  if (!prototypeAccessPassword) {
    return "";
  }

  return createHmac("sha256", prototypeAccessPassword).update(prototypeAccessCookieMarker).digest("base64url");
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=");
    }
  }

  return undefined;
}

function secureStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function hasPrototypeAccess(request: express.Request | IncomingMessage): boolean {
  if (!prototypeAccessPassword) {
    return true;
  }

  const cookieValue = readCookie(request.headers.cookie, prototypeAccessCookieName);
  return Boolean(cookieValue && secureStringEquals(cookieValue, getPrototypeAccessCookieValue()));
}

function setPrototypeAccessCookie(res: express.Response): void {
  res.cookie(prototypeAccessCookieName, getPrototypeAccessCookieValue(), {
    httpOnly: true,
    maxAge: prototypeAccessCookieMaxAgeSeconds * 1000,
    path: "/",
    sameSite: "lax",
    secure: isProduction
  });
}

function renderPrototypeAccessPage(returnTo: string, invalidPassword = false): string {
  const safeReturnTo = escapeHtml(getSafeReturnTo(returnTo));
  const error = invalidPassword
    ? `<p class="error">That password did not work. Check the shared prototype password and try again.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Assistant Avatar Prototype Access</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(135deg, #0b1220, #134e4a); }
      main { width: min(92vw, 430px); background: rgba(255,255,255,0.96); color: #111827; border-radius: 24px; padding: 32px; box-shadow: 0 24px 70px rgba(0,0,0,0.28); }
      h1 { margin: 0 0 12px; font-size: 1.55rem; }
      p { margin: 0 0 20px; line-height: 1.5; color: #4b5563; }
      label { display: block; margin-bottom: 8px; font-weight: 700; }
      input[type="password"] { box-sizing: border-box; width: 100%; border: 1px solid #d1d5db; border-radius: 12px; padding: 13px 14px; font-size: 1rem; }
      button { width: 100%; margin-top: 16px; border: 0; border-radius: 999px; background: #0f766e; color: white; padding: 13px 18px; font-weight: 800; font-size: 1rem; cursor: pointer; }
      .error { color: #b91c1c; font-weight: 700; }
      .note { margin-top: 18px; font-size: 0.9rem; color: #6b7280; }
    </style>
  </head>
  <body>
    <main>
      <h1>Prototype access</h1>
      <p>This kiosk prototype is password protected. Enter the shared password to open it.</p>
      ${error}
      <form method="post" action="/access">
        <input type="hidden" name="returnTo" value="${safeReturnTo}" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">Open prototype</button>
      </form>
      <p class="note">This is a lightweight gate for prototype sharing, not production authentication.</p>
    </main>
  </body>
</html>`;
}

app.get("/access", (req, res) => {
  const returnTo = getSafeReturnTo(req.query.returnTo);
  if (!prototypeAccessPassword || hasPrototypeAccess(req)) {
    res.redirect(returnTo);
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(renderPrototypeAccessPage(returnTo));
});

app.post("/access", (req, res) => {
  const returnTo = getSafeReturnTo((req.body as { returnTo?: unknown }).returnTo);
  const password = (req.body as { password?: unknown }).password;

  if (!prototypeAccessPassword) {
    res.redirect(returnTo);
    return;
  }

  if (typeof password === "string" && secureStringEquals(password, prototypeAccessPassword)) {
    setPrototypeAccessCookie(res);
    res.redirect(303, returnTo);
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(401).type("html").send(renderPrototypeAccessPage(returnTo, true));
});

app.use((req, res, next) => {
  if (req.path === "/health" || hasPrototypeAccess(req)) {
    next();
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  if (!req.path.startsWith("/api/") && req.method === "GET" && req.accepts("html")) {
    res.status(401).type("html").send(renderPrototypeAccessPage(req.originalUrl));
    return;
  }

  res.status(401).json({ error: "Prototype access password required." });
});
app.use("/api/voice-live", createVoiceLiveRouter(voiceLiveSessions));

function getSpeechRegion(): string {
  return process.env.AZURE_SPEECH_REGION || "swedencentral";
}

interface EnvValue {
  name: string;
  value: string;
}

interface NormalizedVoiceLiveEndpoint {
  host?: string;
  origin?: string;
  error?: string;
  warnings: string[];
}

interface VoiceLiveSettings {
  endpointEnv?: EnvValue;
  modelEnv?: EnvValue;
  apiVersionEnv?: EnvValue;
  apiKeyEnv?: EnvValue;
  endpoint: NormalizedVoiceLiveEndpoint;
  model?: string;
  apiVersion: string;
  configured: boolean;
  missing: string[];
  websocketUrl?: string;
  auth: {
    apiKeyConfigured: boolean;
    entraManualPossible: boolean;
    notes: string[];
  };
  warnings: string[];
}

function getConfiguredEnv(names: readonly string[]): EnvValue | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return { name, value };
    }
  }
  return undefined;
}

function formatEnvAlternatives(names: readonly string[]): string {
  return names.join(" or ");
}

function normalizeVoiceLiveEndpoint(rawEndpoint?: string): NormalizedVoiceLiveEndpoint {
  if (!rawEndpoint) {
    return { warnings: [] };
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawEndpoint) ? rawEndpoint : `https://${rawEndpoint}`;
  let url: URL;

  try {
    url = new URL(withProtocol);
  } catch {
    return {
      error: "Voice Live endpoint must be a valid https:// or wss:// URL, or a bare Azure AI Services host.",
      warnings: []
    };
  }

  if (!["https:", "http:", "wss:", "ws:"].includes(url.protocol)) {
    return {
      error: "Voice Live endpoint must use https:// or wss://.",
      warnings: []
    };
  }

  const warnings: string[] = [];
  if (url.username || url.password) {
    warnings.push("Endpoint credentials were ignored. Do not place secrets in the endpoint URL.");
  }
  if (url.search) {
    warnings.push("Endpoint query parameters were ignored. This prototype never returns API-key query URLs.");
  }
  if (url.pathname && url.pathname !== "/" && url.pathname !== "/voice-live/realtime") {
    warnings.push("Endpoint path was ignored. The Voice Live realtime WebSocket path is generated server-side.");
  }
  if (
    !url.hostname.endsWith(".services.ai.azure.com") &&
    !url.hostname.endsWith(".cognitiveservices.azure.com")
  ) {
    warnings.push("Endpoint host does not match the usual Azure AI Services or Cognitive Services host pattern.");
  }

  const originProtocol = url.protocol === "http:" || url.protocol === "ws:" ? "http:" : "https:";
  return {
    host: url.host,
    origin: `${originProtocol}//${url.host}`,
    warnings
  };
}

function buildSanitizedVoiceLiveWebSocketUrl(endpointHost: string, model: string, apiVersion: string): string {
  const url = new URL(`wss://${endpointHost}/voice-live/realtime`);
  url.searchParams.set("api-version", apiVersion);
  url.searchParams.set("model", model);
  return url.toString();
}

function getVoiceLiveAuthSummary(apiKeyEnv?: EnvValue): VoiceLiveSettings["auth"] {
  return {
    apiKeyConfigured: Boolean(apiKeyEnv),
    entraManualPossible: true,
    notes: [
      apiKeyEnv
        ? "A Voice Live API key is present on the server for manual/server-side validation only."
        : "No Voice Live API key is configured. Use Entra bearer auth in a server-side client, or set an API key on the server only.",
      "Browser WebSocket pre-handshake headers are not available, and this prototype does not generate API-key query URLs."
    ]
  };
}

function getVoiceLiveSettings(): VoiceLiveSettings {
  const endpointEnv = getConfiguredEnv(voiceLiveEnv.endpoint);
  const modelEnv = getConfiguredEnv(voiceLiveEnv.model);
  const apiVersionEnv = getConfiguredEnv(voiceLiveEnv.apiVersion);
  const apiKeyEnv = getConfiguredEnv(voiceLiveEnv.apiKey);
  const endpoint = normalizeVoiceLiveEndpoint(endpointEnv?.value);
  const model = modelEnv?.value;
  const apiVersion = apiVersionEnv?.value || voiceLiveDefaultApiVersion;
  const missing = [
    !endpointEnv ? formatEnvAlternatives(voiceLiveEnv.endpoint) : undefined,
    !model ? formatEnvAlternatives(voiceLiveEnv.model) : undefined
  ].filter((value): value is string => Boolean(value));
  const warnings = [...endpoint.warnings];

  if (endpoint.error) {
    warnings.push(endpoint.error);
  }
  if (model && model.length > 128) {
    warnings.push("Voice Live model name is unusually long. Verify the model/deployment name.");
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9.-]+)?$/i.test(apiVersion)) {
    warnings.push("Voice Live API version does not look like an Azure API version.");
  }

  const configured = missing.length === 0 && Boolean(endpoint.host && endpoint.origin && !endpoint.error);
  const websocketUrl =
    configured && endpoint.host && model ? buildSanitizedVoiceLiveWebSocketUrl(endpoint.host, model, apiVersion) : undefined;

  return {
    endpointEnv,
    modelEnv,
    apiVersionEnv,
    apiKeyEnv,
    endpoint,
    model,
    apiVersion,
    configured,
    missing,
    websocketUrl,
    auth: getVoiceLiveAuthSummary(apiKeyEnv),
    warnings
  };
}

function getVoiceLiveManualNextSteps(configured: boolean): string[] {
  if (!configured) {
    return [
      `Set ${formatEnvAlternatives(voiceLiveEnv.endpoint)} to the Azure AI Services endpoint or host.`,
      `Set ${formatEnvAlternatives(voiceLiveEnv.model)} to the Voice Live model/deployment name.`,
      `Optional: set ${formatEnvAlternatives(voiceLiveEnv.apiKey)} on the server for server-side manual validation only.`,
      "Keep using the Speech Avatar path while Voice Live comparison settings are incomplete."
    ];
  }

  return [
    "Click Prepare Voice Live session plan to inspect the sanitized WebSocket URL and session.update payload.",
    "Validate the same model/API version in Foundry/playground or a server-side WebSocket client with Authorization or Ocp-Apim-Subscription-Key headers.",
    "Run the same noisy phrases through Speech Avatar and Voice Live, then compare transcript quality and turn-taking notes."
  ];
}

function buildVoiceLiveReadiness(settings = getVoiceLiveSettings()): VoiceLiveReadiness {
  return {
    configured: settings.configured,
    missing: settings.missing,
    endpointConfigured: Boolean(settings.endpointEnv),
    modelConfigured: Boolean(settings.model),
    endpointHost: settings.endpoint.host,
    endpointOrigin: settings.endpoint.origin,
    model: settings.model,
    apiVersion: settings.apiVersion,
    websocketUrl: settings.websocketUrl,
    auth: settings.auth,
    capabilities: voiceLiveCapabilities,
    manualNextSteps: getVoiceLiveManualNextSteps(settings.configured),
    warnings: settings.warnings,
    message: settings.configured
      ? "Voice Live comparison settings are present. This prototype prepares a safe session plan but does not connect from the browser."
      : "Voice Live comparison is not fully configured. Add endpoint/model on the server; secrets stay server-side."
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalSmallString(
  body: Record<string, unknown>,
  key: keyof VoiceLiveSessionPlanRequest,
  maxLength: number,
  errors: string[],
  pattern?: RegExp
): string | undefined {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    errors.push(`${key} must be a string.`);
    return undefined;
  }

  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  if (value.length > maxLength) {
    errors.push(`${key} must be ${maxLength} characters or less.`);
    return undefined;
  }
  if (pattern && !pattern.test(value)) {
    errors.push(`${key} has an unsupported format.`);
    return undefined;
  }
  return value;
}

function parseVoiceLiveSessionPlanRequest(body: unknown): {
  request: Required<VoiceLiveSessionPlanRequest>;
  errors: string[];
} {
  const errors: string[] = [];
  const defaults: Required<VoiceLiveSessionPlanRequest> = {
    instructions: defaultVoiceLiveInstructions,
    locale: "en-US"
  };

  if (body === undefined || body === null) {
    return { request: defaults, errors };
  }
  if (!isRecord(body)) {
    return { request: defaults, errors: ["Request body must be a JSON object."] };
  }

  const instructions = readOptionalSmallString(body, "instructions", 1200, errors);
  const locale = readOptionalSmallString(
    body,
    "locale",
    32,
    errors,
    /^[a-z]{2,3}(?:-[a-z0-9]{1,8}){0,5}$/i
  );

  return {
    request: {
      instructions: instructions || defaults.instructions,
      locale: locale || defaults.locale
    },
    errors
  };
}

function buildVoiceLiveSessionUpdate(request: Required<VoiceLiveSessionPlanRequest>): Record<string, unknown> {
  const voice = getConfiguredEnv(["AZURE_VOICE_LIVE_VOICE", "AZURE_VOICELIVE_VOICE"])?.value || "en-US-Ava:DragonHDLatestNeural";
  const avatarCharacter =
    getConfiguredEnv(["AZURE_VOICE_LIVE_AVATAR_CHARACTER", "AZURE_VOICELIVE_AVATAR_CHARACTER"])?.value ||
    process.env.AZURE_AVATAR_CHARACTER ||
    "lisa";
  const avatarStyle =
    getConfiguredEnv(["AZURE_VOICE_LIVE_AVATAR_STYLE", "AZURE_VOICELIVE_AVATAR_STYLE"])?.value ||
    process.env.AZURE_AVATAR_STYLE ||
    "casual-sitting";

  return {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      instructions: request.instructions,
      locale: request.locale,
      voice: {
        type: "azure-standard",
        name: voice
      },
      avatar: {
        character: avatarCharacter,
        style: avatarStyle,
        customized: false,
        outputProtocol: "webrtc",
        video: {
          codec: "h264",
          resolution: { width: 1280, height: 720 }
        }
      },
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      inputAudioTranscription: { model: "azure-speech" },
      inputAudioNoiseReduction: { type: "azure_deep_noise_suppression" },
      inputAudioEchoCancellation: { type: "server_echo_cancellation" },
      turnDetection: {
        type: "azure_semantic_vad",
        silenceDurationInMs: 500,
        interruptResponse: true,
        createResponse: true
      }
    }
  };
}

function getRuntimeConfig(): RuntimeConfig {
  const speechConfigured = Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
  const voiceLive = getVoiceLiveSettings();
  const brand = loadBrandConfig();

  return {
    speechConfigured,
    voiceLiveConfigured: voiceLive.configured,
    assistantMode: process.env.ASSISTANT_API_URL ? "real" : "mock",
    region: getSpeechRegion(),
    voiceName: process.env.AZURE_SPEECH_VOICE || "en-US-JennyNeural",
    avatarCharacter: process.env.AZURE_AVATAR_CHARACTER || "lisa",
    avatarStyle: process.env.AZURE_AVATAR_STYLE || "casual-sitting",
    voiceLive: {
      configured: voiceLive.configured,
      endpointConfigured: Boolean(voiceLive.endpointEnv),
      modelConfigured: Boolean(voiceLive.model),
      endpointHost: voiceLive.endpoint.host,
      endpointOrigin: voiceLive.endpoint.origin,
      model: voiceLive.model,
      apiVersion: voiceLive.apiVersion,
      auth: voiceLive.auth,
      warnings: voiceLive.warnings
    },
    brand: {
      partnerName: brand.partner.name,
      partnerShortName: brand.partner.shortName,
      credit: brand.partner.credit,
      accentColor: brand.partner.accentColor,
      customerName: brand.customer.name,
      customerShortName: brand.customer.shortName,
      tagline: brand.customer.tagline,
      logoUrl: brand.logoUrl
    }
  };
}

function requireSpeechKey(): string {
  const key = process.env.AZURE_SPEECH_KEY;
  if (!key) {
    throw new Error("AZURE_SPEECH_KEY is not configured on the server.");
  }
  return key;
}

async function fetchWithSpeechKey(url: string, method: "GET" | "POST" = "POST"): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      "Ocp-Apim-Subscription-Key": requireSpeechKey()
    }
  });
}

app.get("/health", (_, res) => {
  res.status(200).json({
    status: "ok",
    time: new Date().toISOString(),
    speechConfigured: getRuntimeConfig().speechConfigured
  });
});

app.get("/api/config", (_, res) => {
  res.json(getRuntimeConfig());
});

app.get("/api/session", (_, res) => {
  res.json({
    sessionId: randomUUID(),
    createdAt: new Date().toISOString()
  });
});

app.get("/api/speech/token", async (_, res, next) => {
  try {
    const region = getSpeechRegion();
    const response = await fetchWithSpeechKey(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`);

    if (!response.ok) {
      const body = await response.text();
      track.event("speech.token.failed", { region, status: response.status });
      res.status(response.status).json({
        error: "Speech token request failed.",
        status: response.status,
        detail: body.slice(0, 500)
      });
      return;
    }

    track.event("speech.token.issued", { region });
    res.json({
      token: await response.text(),
      region,
      expiresInSeconds: 540
    });
  } catch (error) {
    track.exception(error, { route: "/api/speech/token" });
    next(error);
  }
});

app.get("/api/avatar/relay-token", async (_, res, next) => {
  try {
    const region = getSpeechRegion();
    const response = await fetchWithSpeechKey(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
      "GET"
    );

    if (!response.ok) {
      const body = await response.text();
      track.event("avatar.relay-token.failed", { region, status: response.status });
      res.status(response.status).json({
        error: "Avatar relay token request failed.",
        status: response.status,
        detail: body.slice(0, 500)
      });
      return;
    }

    track.event("avatar.relay-token.issued", { region });
    res.json(await response.json());
  } catch (error) {
    track.exception(error, { route: "/api/avatar/relay-token" });
    next(error);
  }
});

app.get("/api/voice-live/readiness", (_, res) => {
  res.json(buildVoiceLiveReadiness());
});

app.get("/api/knowledge", (_, res) => {
  res.json({
    items: kioskKnowledgeBase,
    generatedAt: new Date().toISOString(),
    note: "Fictional Helios Telecom catalogue for the prototype. Replace it with your own product data before you show real offers, prices or terms."
  });
});

app.post("/api/voice-live/session-plan", (req, res) => {
  const settings = getVoiceLiveSettings();
  const readiness = buildVoiceLiveReadiness(settings);

  if (settings.missing.length > 0) {
    res.status(409).json({
      error: "Voice Live endpoint and model must be configured on the server before preparing a session plan.",
      readiness
    });
    return;
  }
  if (!settings.configured || !settings.endpoint.host || !settings.endpoint.origin || !settings.model || !settings.websocketUrl) {
    res.status(400).json({
      error: "Voice Live endpoint is invalid. Fix the server-side endpoint before preparing a session plan.",
      readiness
    });
    return;
  }

  const parsed = parseVoiceLiveSessionPlanRequest(req.body);
  if (parsed.errors.length > 0) {
    res.status(400).json({
      error: "Voice Live session plan request is invalid.",
      details: parsed.errors
    });
    return;
  }

  const plan: VoiceLiveSessionPlan = {
    configured: true,
    endpointHost: settings.endpoint.host,
    endpointOrigin: settings.endpoint.origin,
    model: settings.model,
    apiVersion: settings.apiVersion,
    websocketUrl: settings.websocketUrl,
    auth: settings.auth,
    sessionUpdate: buildVoiceLiveSessionUpdate(parsed.request),
    capabilities: voiceLiveCapabilities,
    manualNextSteps: getVoiceLiveManualNextSteps(true),
    warnings: settings.warnings,
    message: "Session plan prepared without connecting to Voice Live or exposing any key/token."
  };

  res.json(plan);
});

app.post("/api/assistant/respond", async (req, res, next) => {
  try {
    const startedAt = Date.now();
    const request = req.body as AssistantRequest;

    if (!request.sessionId || !request.utterance?.trim()) {
      res.status(400).json({ error: "sessionId and utterance are required." });
      return;
    }

    const utteranceChars = request.utterance.trim().length;
    const guardrails = evaluateKioskGuardrails(request.utterance);
    if (guardrails.status === "out-of-scope" || guardrails.scope === "customer-account") {
      const response = createMockAssistantResponse(request.utterance, startedAt);
      track.event("assistant.respond", {
        source: "guardrail",
        mode: request.mode ?? "mock",
        guardrailStatus: guardrails.status,
        guardrailScope: guardrails.scope,
        utteranceChars,
        latencyMs: response.latencyMs
      });
      res.json(response);
      return;
    }

    if (!process.env.ASSISTANT_API_URL || request.mode === "mock") {
      const response = createMockAssistantResponse(request.utterance, startedAt);
      track.event("assistant.respond", {
        source: "mock",
        mode: request.mode ?? "mock",
        utteranceChars,
        latencyMs: response.latencyMs
      });
      res.json(response);
      return;
    }

    const assistantResponse = await fetch(process.env.ASSISTANT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ASSISTANT_API_KEY ? { Authorization: `Bearer ${process.env.ASSISTANT_API_KEY}` } : {})
      },
      body: JSON.stringify(request)
    });

    if (!assistantResponse.ok) {
      track.event("assistant.respond", {
        source: "assistant",
        mode: request.mode ?? "real",
        status: assistantResponse.status,
        ok: false,
        utteranceChars,
        latencyMs: Date.now() - startedAt
      });
      res.status(assistantResponse.status).json({
        error: "Assistant API request failed.",
        status: assistantResponse.status,
        fallback: createMockAssistantResponse(request.utterance, startedAt)
      });
      return;
    }

    const payload = (await assistantResponse.json()) as Partial<AssistantResponse>;
    const normalized: AssistantResponse = {
      text: payload.text || "The assistant endpoint returned no spoken response text.",
      cards: payload.cards || [],
      handoffSuggested: Boolean(payload.handoffSuggested),
      source: "assistant",
      latencyMs: Date.now() - startedAt
    };

    track.event("assistant.respond", {
      source: "assistant",
      mode: request.mode ?? "real",
      ok: true,
      utteranceChars,
      responseChars: normalized.text.length,
      handoffSuggested: normalized.handoffSuggested,
      latencyMs: normalized.latencyMs
    });

    res.json(normalized);
  } catch (error) {
    track.exception(error, { route: "/api/assistant/respond" });
    next(error);
  }
});

app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  track.exception(error, { route: req.path, method: req.method });
  res.status(500).json({
    error: isProduction ? "Internal server error." : error.message
  });
});

if (shouldServeBuiltClient) {
  app.use(express.static(builtClientDist));
  app.get("*", (_, res) => {
    res.sendFile(path.join(builtClientDist, "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

const server = createHttpServer(app);
attachVoiceLiveWebSocketServer(server, voiceLiveSessions, { isRequestAuthorized: hasPrototypeAccess });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}; closing Voice Live sessions and HTTP server.`);
  await voiceLiveSessions.closeAll();
  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Avatar kiosk listening on http://localhost:${port}`);
});

