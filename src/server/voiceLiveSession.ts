import { AzureKeyCredential } from "@azure/core-auth";
import {
  VoiceLiveClient,
  type IceServer,
  type RequestSession,
  type ServerEventUnion,
  type VoiceLiveSession,
  type VoiceLiveSubscription
} from "@azure/ai-voicelive";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { kioskKnowledgeBase } from "./kioskKnowledge.js";
import { loadBrandConfig } from "./brandConfig.js";
import { track } from "./telemetry.js";

const voiceLiveDefaultApiVersion = "2025-10-01";
const maxAudioBase64Length = 256_000;
const avatarConnectTimeoutMs = 30_000;
const sessionUpdatedTimeoutMs = 5_000;

export interface VoiceLivePrototypeConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  apiVersion: string;
  voice: string;
  avatarCharacter: string;
  avatarStyle?: string;
  region: string;
}

export interface VoiceLivePrototypeSessionCreated {
  sessionId: string;
  createdAt: string;
  model: string;
  apiVersion: string;
  voice: string;
  avatar: {
    character: string;
    style?: string;
  };
  region: string;
  iceServers?: IceServer[];
}

type BrowserOutboundEvent = Record<string, unknown> & {
  type: string;
  at: string;
};

type BrowserInboundEvent =
  | { type: "audio"; audio: string }
  | { type: "text"; text: string }
  | { type: "response.cancel" }
  | { type: "input_audio_buffer.commit" }
  | { type: "input_audio_buffer.clear" };

interface PendingAvatarConnection {
  resolve: (serverSdp: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PendingSessionUpdate {
  resolve: (iceServers?: IceServer[]) => void;
  timeout: NodeJS.Timeout;
}

function getEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeEndpoint(endpoint: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
  const url = new URL(withProtocol);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("AZURE_VOICE_LIVE_ENDPOINT must be an https:// endpoint or bare Azure AI Services host.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function getVoiceLivePrototypeConfig(): {
  config?: VoiceLivePrototypeConfig;
  missing: string[];
  warnings: string[];
} {
  const endpoint = getEnvValue(["AZURE_VOICE_LIVE_ENDPOINT", "AZURE_VOICELIVE_ENDPOINT"]);
  const apiKey = getEnvValue(["AZURE_VOICE_LIVE_API_KEY", "AZURE_VOICELIVE_API_KEY"]);
  const model = getEnvValue(["AZURE_VOICE_LIVE_MODEL", "AZURE_VOICELIVE_MODEL"]);
  const apiVersion =
    getEnvValue(["AZURE_VOICE_LIVE_API_VERSION", "AZURE_VOICELIVE_API_VERSION"]) || voiceLiveDefaultApiVersion;
  const voice =
    getEnvValue(["AZURE_VOICE_LIVE_VOICE", "AZURE_VOICELIVE_VOICE"]) ||
    process.env.AZURE_SPEECH_VOICE?.trim() ||
    "en-US-Ava:DragonHDLatestNeural";
  const avatarCharacter =
    getEnvValue(["AZURE_VOICE_LIVE_AVATAR_CHARACTER", "AZURE_VOICELIVE_AVATAR_CHARACTER"]) ||
    process.env.AZURE_AVATAR_CHARACTER?.trim() ||
    "lisa";
  const avatarStyle =
    getEnvValue(["AZURE_VOICE_LIVE_AVATAR_STYLE", "AZURE_VOICELIVE_AVATAR_STYLE"]) ||
    process.env.AZURE_AVATAR_STYLE?.trim() ||
    "casual-sitting";
  const region =
    getEnvValue(["AZURE_VOICE_LIVE_REGION", "AZURE_VOICELIVE_REGION"]) ||
    process.env.AZURE_SPEECH_REGION?.trim() ||
    "westeurope";

  const missing = [
    endpoint ? undefined : "AZURE_VOICE_LIVE_ENDPOINT or AZURE_VOICELIVE_ENDPOINT",
    apiKey ? undefined : "AZURE_VOICE_LIVE_API_KEY or AZURE_VOICELIVE_API_KEY",
    model ? undefined : "AZURE_VOICE_LIVE_MODEL or AZURE_VOICELIVE_MODEL"
  ].filter((value): value is string => Boolean(value));
  const warnings: string[] = [];

  if (!endpoint || !apiKey || !model) {
    return { missing, warnings };
  }

  let normalizedEndpoint: string;
  try {
    normalizedEndpoint = normalizeEndpoint(endpoint);
  } catch (error) {
    return {
      missing,
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }

  if (!normalizedEndpoint.includes(".services.ai.azure.com") && !normalizedEndpoint.includes(".cognitiveservices.azure.com")) {
    warnings.push("Voice Live endpoint host is unusual. Expected an Azure AI Services or Cognitive Services host.");
  }

  return {
    config: {
      endpoint: normalizedEndpoint,
      apiKey,
      model,
      apiVersion,
      voice,
      avatarCharacter,
      avatarStyle,
      region
    },
    missing,
    warnings
  };
}

function buildKioskInstructions(): string {
  const productContext = kioskKnowledgeBase
    .slice(0, 8)
    .map((item) => `- ${item.title}: ${item.summary}`)
    .join("\n");

  const brand = loadBrandConfig();
  const { greetingEn, greetingSv, greetingFr } = brand.voicePersona;

  return [
    `You are a concise ${brand.customer.name} retail kiosk assistant powered by ${brand.partner.name}.`,
    "Speak naturally in short answers. Ask one clarifying question when needed.",
    `Detect the customer's language and open with the matching greeting:`,
    `- English: "${greetingEn}"`,
    `- Swedish: "${greetingSv}"`,
    `- French: "${greetingFr}"`,
    `Stay within ${brand.customer.name} telecom retail topics: mobile plans, prepaid, roaming, home internet, TV, packs, devices, smart-home bundles, and store handoff.`,
    "Do not collect account numbers, payment details, identity data, PIN, PUK, or contract cancellation details.",
    "Do not promise final prices, promotions, contract terms, stock availability, or checkout completion. For those, suggest a store advisor.",
    `If the customer asks for sensitive account or payment support, explain that a ${brand.customer.shortName} store advisor should help.`,
    "",
    "Product context from the kiosk catalogue:",
    productContext
  ].join("\n");
}

function buildSessionUpdate(config: VoiceLivePrototypeConfig): RequestSession {
  return {
    model: config.model,
    modalities: ["text", "audio"],
    instructions: buildKioskInstructions(),
    inputAudioFormat: "pcm16",
    outputAudioFormat: "pcm16",
    inputAudioSamplingRate: 24000,
    inputAudioTranscription: {
      model: "azure-speech",
      language: "en-US",
      phraseList: [loadBrandConfig().customer.shortName, "prepaid", "roaming", "internet", "TV", "mobile plan", "home pack"]
    },
    voice: {
      type: "azure-standard",
      name: config.voice
    },
    avatar: {
      character: config.avatarCharacter,
      style: config.avatarStyle,
      customized: false,
      outputProtocol: "webrtc",
      video: {
        codec: "h264",
        bitrate: 1_000_000,
        resolution: {
          width: 1280,
          height: 720
        }
      }
    },
    inputAudioNoiseReduction: { type: "azure_deep_noise_suppression" },
    inputAudioEchoCancellation: { type: "server_echo_cancellation" },
    turnDetection: {
      type: "azure_semantic_vad",
      threshold: 0.5,
      prefixPaddingInMs: 300,
      silenceDurationInMs: 500,
      speechDurationInMs: 120,
      removeFillerWords: true,
      languages: ["en"],
      createResponse: true,
      interruptResponse: true,
      autoTruncate: true
    },
    temperature: 0.7
  };
}

function encodeClientSdp(sdp: string): string {
  return Buffer.from(JSON.stringify({ type: "offer", sdp }), "utf8").toString("base64");
}

function decodeServerSdp(serverSdp: string): string {
  if (serverSdp.startsWith("v=0")) {
    return serverSdp;
  }

  const decoded = Buffer.from(serverSdp, "base64").toString("utf8");
  try {
    const payload = JSON.parse(decoded) as { sdp?: unknown };
    return typeof payload.sdp === "string" ? payload.sdp : decoded;
  } catch {
    return decoded;
  }
}

function toOutbound(type: string, payload: Record<string, unknown> = {}): BrowserOutboundEvent {
  return {
    type,
    at: new Date().toISOString(),
    ...payload
  };
}

function parseBrowserMessage(data: WebSocket.RawData): BrowserInboundEvent {
  const raw = Array.isArray(data) ? Buffer.concat(data).toString("utf8") : data.toString("utf8");
  const parsed = JSON.parse(raw) as Partial<BrowserInboundEvent>;
  if (!parsed.type) {
    throw new Error("Browser message must include a type.");
  }
  return parsed as BrowserInboundEvent;
}

function extractIceServers(event: ServerEventUnion): IceServer[] | undefined {
  const session = "session" in event ? event.session : undefined;
  if (!session || typeof session !== "object") {
    return undefined;
  }
  const avatar = (session as { avatar?: { iceServers?: IceServer[] } }).avatar;
  return avatar?.iceServers;
}

export class VoiceLivePrototypeSession {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();

  private readonly client: VoiceLiveClient;
  private readonly session: VoiceLiveSession;
  private readonly sockets = new Set<WebSocket>();
  private subscription: VoiceLiveSubscription | undefined;
  private pendingAvatarConnection: PendingAvatarConnection | undefined;
  private pendingSessionUpdate: PendingSessionUpdate | undefined;
  private iceServers: IceServer[] | undefined;

  constructor(private readonly config: VoiceLivePrototypeConfig) {
    this.client = new VoiceLiveClient(config.endpoint, new AzureKeyCredential(config.apiKey), {
      apiVersion: config.apiVersion
    });
    this.session = this.client.createSession(config.model, {
      enableDebugLogging: false
    });
  }

  async start(): Promise<VoiceLivePrototypeSessionCreated> {
    this.subscription = this.session.subscribe({
      onConnected: async () => this.broadcast("voice-live.connected"),
      onDisconnected: async (event) =>
        this.broadcast("voice-live.disconnected", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        }),
      onError: async (event) => this.broadcast("error", { message: event.error.message, context: event.context }),
      onServerError: async (event) => this.broadcast("error", { message: event.error?.message || "Voice Live server error" }),
      onSessionUpdated: async (event) => {
        this.iceServers = extractIceServers(event);
        this.broadcast("session.updated", { iceServers: this.iceServers });
        if (this.pendingSessionUpdate) {
          clearTimeout(this.pendingSessionUpdate.timeout);
          this.pendingSessionUpdate.resolve(this.iceServers);
          this.pendingSessionUpdate = undefined;
        }
      },
      onSessionAvatarConnecting: async (event) => {
        if (!this.pendingAvatarConnection) {
          this.broadcast("avatar.connecting", { note: "Received avatar SDP without a pending browser offer." });
          return;
        }
        clearTimeout(this.pendingAvatarConnection.timeout);
        this.pendingAvatarConnection.resolve(decodeServerSdp(event.serverSdp));
        this.pendingAvatarConnection = undefined;
      },
      onInputAudioBufferSpeechStarted: async () => this.broadcast("speech.started"),
      onInputAudioBufferSpeechStopped: async () => this.broadcast("speech.stopped"),
      onConversationItemInputAudioTranscriptionCompleted: async (event) =>
        this.broadcast("user.transcript.completed", {
          itemId: event.itemId,
          transcript: event.transcript || ""
        }),
      onConversationItemInputAudioTranscriptionFailed: async (event) =>
        this.broadcast("user.transcript.failed", { error: event.error }),
      onResponseCreated: async () => this.broadcast("response.created"),
      onResponseAudioTranscriptDelta: async (event) =>
        this.broadcast("assistant.transcript.delta", {
          itemId: event.itemId,
          delta: event.delta || ""
        }),
      onResponseAudioTranscriptDone: async (event) =>
        this.broadcast("assistant.transcript.done", {
          itemId: event.itemId,
          transcript: event.transcript || ""
        }),
      onResponseAudioDone: async () => this.broadcast("assistant.audio.done"),
      onResponseDone: async (event) => {
        this.broadcast("response.done");
        const usage = event.response?.usage;
        track.event("voicelive.response.done", {
          sessionId: this.id,
          status: event.response?.status,
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          totalTokens: usage?.totalTokens,
          inputAudioTokens: usage?.inputTokenDetails?.audioTokens,
          inputTextTokens: usage?.inputTokenDetails?.textTokens,
          inputCachedTokens: usage?.inputTokenDetails?.cachedTokens,
          outputAudioTokens: usage?.outputTokenDetails?.audioTokens,
          outputTextTokens: usage?.outputTokenDetails?.textTokens
        });
        if (usage?.totalTokens) {
          track.metric("voicelive.tokens.total", usage.totalTokens, { sessionId: this.id });
        }
      },
      onServerEvent: async (event) => {
        if (event.type.startsWith("input_audio_buffer.") || event.type.startsWith("response.")) {
          this.broadcast("voice-live.event", { eventType: event.type });
        }
      }
    });

    await this.session.connect();
    await this.session.updateSession(buildSessionUpdate(this.config));
    const iceServers = await this.waitForSessionUpdate();

    return {
      sessionId: this.id,
      createdAt: this.createdAt,
      model: this.config.model,
      apiVersion: this.config.apiVersion,
      voice: this.config.voice,
      avatar: {
        character: this.config.avatarCharacter,
        style: this.config.avatarStyle
      },
      region: this.config.region,
      iceServers
    };
  }

  attachSocket(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify(toOutbound("browser.connected", { sessionId: this.id })));

    socket.on("message", (data) => {
      this.handleBrowserMessage(data).catch((error: Error) => {
        socket.send(JSON.stringify(toOutbound("error", { message: error.message })));
      });
    });

    socket.on("close", () => {
      this.sockets.delete(socket);
    });

    socket.on("error", (error) => {
      this.sockets.delete(socket);
      this.broadcast("browser.socket.error", { message: error.message });
    });
  }

  async connectAvatar(clientSdp: string): Promise<string> {
    if (this.pendingAvatarConnection) {
      throw new Error("Avatar connection is already in progress for this session.");
    }
    if (!this.session.isConnected) {
      throw new Error("Voice Live session is not connected.");
    }

    const promise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAvatarConnection = undefined;
        reject(new Error("Timed out waiting for Voice Live avatar SDP answer."));
      }, avatarConnectTimeoutMs);
      this.pendingAvatarConnection = { resolve, reject, timeout };
    });

    await this.session.sendEvent({
      type: "session.avatar.connect",
      clientSdp: encodeClientSdp(clientSdp)
    });

    return promise;
  }

  async sendText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Text fallback requires non-empty text.");
    }
    await this.session.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: trimmed }]
      }
    });
    await this.session.sendEvent({
      type: "response.create",
      response: {
        modalities: ["text", "audio"]
      }
    });
  }

  async close(): Promise<void> {
    if (this.pendingAvatarConnection) {
      clearTimeout(this.pendingAvatarConnection.timeout);
      this.pendingAvatarConnection.reject(new Error("Voice Live session was closed before avatar connected."));
      this.pendingAvatarConnection = undefined;
    }
    if (this.pendingSessionUpdate) {
      clearTimeout(this.pendingSessionUpdate.timeout);
      this.pendingSessionUpdate.resolve(this.iceServers);
      this.pendingSessionUpdate = undefined;
    }
    for (const socket of this.sockets) {
      socket.close(1000, "Voice Live session closed.");
    }
    this.sockets.clear();
    await this.subscription?.close();
    this.subscription = undefined;
    if (this.session.isConnected) {
      await this.session.disconnect();
    }
    await this.session.dispose();
  }

  private async handleBrowserMessage(data: WebSocket.RawData): Promise<void> {
    const message = parseBrowserMessage(data);

    switch (message.type) {
      case "audio": {
        if (!message.audio || message.audio.length > maxAudioBase64Length) {
          throw new Error("Audio message is empty or too large.");
        }
        await this.session.sendAudio(Buffer.from(message.audio, "base64"));
        return;
      }
      case "text":
        await this.sendText(message.text || "");
        return;
      case "response.cancel":
        await this.session.sendEvent({ type: "response.cancel" });
        this.broadcast("response.cancelled");
        return;
      case "input_audio_buffer.commit":
        await this.session.sendEvent({ type: "input_audio_buffer.commit" });
        return;
      case "input_audio_buffer.clear":
        await this.session.sendEvent({ type: "input_audio_buffer.clear" });
        return;
      default:
        throw new Error(`Unsupported browser message type: ${(message as { type: string }).type}`);
    }
  }

  private waitForSessionUpdate(): Promise<IceServer[] | undefined> {
    if (this.iceServers) {
      return Promise.resolve(this.iceServers);
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSessionUpdate = undefined;
        resolve(this.iceServers);
      }, sessionUpdatedTimeoutMs);
      this.pendingSessionUpdate = { resolve, timeout };
    });
  }

  private broadcast(type: string, payload: Record<string, unknown> = {}): void {
    const message = JSON.stringify(toOutbound(type, payload));
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  }
}

export class VoiceLivePrototypeSessionStore {
  private readonly sessions = new Map<string, VoiceLivePrototypeSession>();

  async create(): Promise<VoiceLivePrototypeSessionCreated> {
    const { config, missing, warnings } = getVoiceLivePrototypeConfig();
    if (!config) {
      throw new Error(`Voice Live Track B is not configured. Missing: ${missing.join(", ")}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
    }

    const session = new VoiceLivePrototypeSession(config);
    const created = await session.start();
    this.sessions.set(created.sessionId, session);
    return created;
  }

  get(sessionId: string): VoiceLivePrototypeSession | undefined {
    return this.sessions.get(sessionId);
  }

  async delete(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    this.sessions.delete(sessionId);
    await session.close();
    return true;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.entries()];
    this.sessions.clear();
    await Promise.all(sessions.map(([, session]) => session.close()));
  }
}
