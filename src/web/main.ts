import type {
  AssistantResponse,
  ProductKnowledgeItem,
  RuntimeConfig,
  TimelineEvent,
  ValidationExport,
  VoiceLiveReadiness,
  VoiceLiveSessionPlan
} from "../shared/contracts.js";
import { AzureAvatarClient, recognizeOnceFromMicrophone, speakWithBrowserFallback } from "./avatarClient.js";
import { VoiceLiveAvatarClient, type VoiceLiveBrowserEvent } from "./voiceLiveAvatarClient.js";
import "./styles.css";

const sessionId = crypto.randomUUID();
const timeline: TimelineEvent[] = [];

let runtimeConfig: RuntimeConfig | undefined;
let avatarClient: AzureAvatarClient | undefined;
let micStream: MediaStream | undefined;
let analyser: AnalyserNode | undefined;
let meterTimer: number | undefined;
let latestTranscript = "";
let latestNoiseFloor = 0;
let latestPeakLevel = 0;
let liveModeActive = false;
let liveLoopRunning = false;
let trackBClient: VoiceLiveAvatarClient | undefined;
let trackBAssistantTranscript = "";
const rollingNoiseSamples: number[] = [];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found.");
}

app.innerHTML = `
  <main class="shell kiosk">
    <header class="kiosk-top">
      <div class="brand-wordmark" id="brandWordmark">Helios</div>
      <div class="kiosk-status">
        <span id="statusDot" class="dot"></span>
        <span id="statusText">Loading...</span>
        <span id="brandPoweredBy" class="powered">Powered by Aurora</span>
        <small id="sessionText" class="session-id">Session ${sessionId}</small>
      </div>
    </header>

    <section class="stage">
      <div class="stage-copy">
        <p class="eyebrow" id="brandEyebrow">In-store assistant</p>
        <h1 id="brandTitle">Ask Helios</h1>
        <p class="lede" id="brandLede">Talk to a smart store advisor.</p>
        <div class="button-row main-actions cta-row">
          <button id="startTrackBButton" class="primary">Tap to talk</button>
          <button id="interruptTrackBButton">Interrupt</button>
          <button id="resetTrackBButton">Reset</button>
          <button id="muteTrackBMicButton">Mute mic</button>
          <button id="stopTrackBMicButton">Stop</button>
          <button id="fullscreenButton" type="button" title="Fullscreen kiosk mode. ESC also exits.">Fullscreen</button>
        </div>
        <div class="prompt-chips" aria-label="Try saying">
          <span>"I need a mobile plan for my daughter."</span>
          <span>"Compare prepaid and monthly."</span>
          <span>"Do you have a smart-home bundle?"</span>
        </div>
        <div id="trackBStatus" class="voice-live-status ready">
          <strong>Ready when you are.</strong>
          <p>Tap to talk, allow the microphone once, then just speak naturally.</p>
        </div>
      </div>

      <div class="stage-avatar">
        <div class="avatar-frame">
          <video id="avatarVideo" autoplay playsinline></video>
          <div id="mockAvatar" class="mock-avatar">
            <div class="face"></div>
            <p>Your store advisor</p>
            <small>Tap to talk to begin.</small>
          </div>
        </div>
        <audio id="avatarAudio" autoplay></audio>
        <div id="trackBTranscript" class="track-b-transcript">
          <strong>Conversation</strong>
          <p class="muted">What you say, and the advisor's reply, will appear here.</p>
        </div>
      </div>
    </section>

    <details class="facilitator-drawer">
      <summary><span class="gear" aria-hidden="true">&#9881;</span> Demo controls &amp; diagnostics</summary>
      <div class="facilitator-body">

        <section class="panel">
          <h2>Voice &amp; noise check</h2>
          <p class="helper-text">Reads the same microphone stream sent to the advisor. Use it to compare a quiet room with a busy store floor.</p>
          <div class="gauge-rack">
            <div class="gauge">
              <div class="gauge-ring" id="voiceGaugeRing"><span class="gauge-value" id="voiceGaugeValue">0</span></div>
              <div class="gauge-label">Voice level</div>
              <div class="gauge-sub">live mic energy</div>
            </div>
            <div class="gauge">
              <div class="gauge-ring noise" id="noiseGaugeRing"><span class="gauge-value" id="noiseGaugeValue">0</span></div>
              <div class="gauge-label">Ambient noise</div>
              <div class="gauge-sub">rolling background</div>
            </div>
          </div>
          <div class="snr-readout"><span class="muted">Voice over noise</span><span class="snr-value" id="snrValue">--</span></div>
          <div class="level-bar"><span id="peakBar"></span></div>
          <div class="metrics">
            <div><strong id="micPermission">unknown</strong><small>Mic permission</small></div>
            <div><strong id="inputLevel">0%</strong><small>Current input</small></div>
            <div><strong id="noiseFloor">0%</strong><small>Noise floor</small></div>
            <div><strong id="peakLevel">0%</strong><small>Peak</small></div>
          </div>
          <label for="testerNotes">Tester notes</label>
          <textarea id="testerNotes" rows="3" placeholder="Example: background music, two people nearby, mic 1m from speaker..."></textarea>
          <div class="button-row">
            <button id="audioTestButton">Play audio test</button>
            <button id="phraseButton">Insert test phrases</button>
            <button id="voiceLiveButton">Check Voice Live readiness</button>
            <button id="prepareVoiceLiveButton">Prepare Voice Live session plan</button>
            <button id="exportButton">Export evidence</button>
          </div>
          <div id="voiceLiveStatus" class="voice-live-status">
            <strong>Voice Live comparison</strong>
            <p>Loading server-side configuration...</p>
          </div>
          <pre id="exportBox" class="export-box"></pre>
        </section>

        <section class="panel">
          <h2>Fallback &amp; manual controls</h2>
          <details class="fallback-controls">
            <summary>Speech Avatar / Track A fallback</summary>
            <p>Use only if the live advisor path fails, or to compare the older half-duplex flow.</p>
            <div class="button-row">
              <button id="beginButton">Enable browser audio meter</button>
              <button id="connectAvatarButton">Connect Speech Avatar fallback</button>
              <button id="liveButton">Start Track A half-duplex loop</button>
              <button id="stopLiveButton">Stop Track A loop</button>
              <button id="stopButton">Stop fallback speech</button>
              <button id="resetButton">Reset all fallback state</button>
            </div>
            <div id="liveStatus" class="live-status warn">
              <strong>Track A fallback is off</strong>
              <p>Listens once, answers through Speech Avatar, then listens again. Not the realtime path.</p>
            </div>
          </details>
          <details class="fallback-controls manual-fallback-details">
            <summary>Manual text question</summary>
            <p>Test the mock response without live audio.</p>
            <label for="utteranceInput">Manual customer question</label>
            <textarea id="utteranceInput" rows="3">I need internet and a mobile plan for my family.</textarea>
            <div class="button-row">
              <button id="sendButton" class="primary">Ask manual assistant</button>
              <button id="recognizeButton">Transcribe once into text box</button>
              <button id="fallbackSpeakButton">Speak current answer in browser</button>
            </div>
            <div id="responseText" class="response"></div>
            <div id="guardrailBox" class="guardrail-box"></div>
            <div id="cards" class="cards"></div>
            <div class="source-panel">
              <strong>Retrieved context</strong>
              <div id="sourceList" class="source-list"></div>
            </div>
          </details>
        </section>

        <section class="panel">
          <h2>Product knowledge</h2>
          <p class="muted">Fictional demo catalogue. Used for retrieval in the prototype, with no final prices or contract promises.</p>
          <div id="knowledgeList" class="knowledge-list"></div>
        </section>

        <div class="facilitator-cols">
          <section class="panel">
            <h2>Event timeline</h2>
            <ol id="timeline" class="timeline"></ol>
          </section>
          <section class="panel guardrail-notes">
            <h2>Guardrails</h2>
            <ul>
              <li>Stay within retail topics.</li>
              <li>No account, payment, identity, PIN/PUK or contract details.</li>
              <li>No final prices or promotions without an advisor.</li>
              <li>Hand off sensitive or purchase-finalization requests to a store advisor.</li>
            </ul>
          </section>
        </div>

      </div>
    </details>
  </main>
`;

const statusDot = document.querySelector<HTMLSpanElement>("#statusDot")!;
const statusText = document.querySelector<HTMLElement>("#statusText")!;
const utteranceInput = document.querySelector<HTMLTextAreaElement>("#utteranceInput")!;
const responseText = document.querySelector<HTMLDivElement>("#responseText")!;
const guardrailBox = document.querySelector<HTMLDivElement>("#guardrailBox")!;
const cards = document.querySelector<HTMLDivElement>("#cards")!;
const sourceList = document.querySelector<HTMLDivElement>("#sourceList")!;
const knowledgeList = document.querySelector<HTMLDivElement>("#knowledgeList")!;
const timelineList = document.querySelector<HTMLOListElement>("#timeline")!;
const avatarVideo = document.querySelector<HTMLVideoElement>("#avatarVideo")!;
const avatarAudio = document.querySelector<HTMLAudioElement>("#avatarAudio")!;
const micPermission = document.querySelector<HTMLElement>("#micPermission")!;
const inputLevel = document.querySelector<HTMLElement>("#inputLevel")!;
const noiseFloor = document.querySelector<HTMLElement>("#noiseFloor")!;
const peakLevel = document.querySelector<HTMLElement>("#peakLevel")!;
const voiceGaugeRing = document.querySelector<HTMLElement>("#voiceGaugeRing")!;
const voiceGaugeValue = document.querySelector<HTMLElement>("#voiceGaugeValue")!;
const noiseGaugeRing = document.querySelector<HTMLElement>("#noiseGaugeRing")!;
const noiseGaugeValue = document.querySelector<HTMLElement>("#noiseGaugeValue")!;
const snrValue = document.querySelector<HTMLElement>("#snrValue")!;
const peakBar = document.querySelector<HTMLElement>("#peakBar")!;
const avatarFrameEl = document.querySelector<HTMLElement>(".avatar-frame")!;
const testerNotes = document.querySelector<HTMLTextAreaElement>("#testerNotes")!;
const exportBox = document.querySelector<HTMLPreElement>("#exportBox")!;
const voiceLiveStatus = document.querySelector<HTMLDivElement>("#voiceLiveStatus")!;
const liveStatus = document.querySelector<HTMLDivElement>("#liveStatus")!;
const trackBStatus = document.querySelector<HTMLDivElement>("#trackBStatus")!;
const trackBTranscript = document.querySelector<HTMLDivElement>("#trackBTranscript")!;

function setStatus(text: string, mode: "ready" | "warn" | "error" = "ready"): void {
  statusText.textContent = text;
  statusDot.className = `dot ${mode}`;
}

function logEvent(name: string, detail?: Record<string, unknown>): void {
  const event: TimelineEvent = {
    at: new Date().toISOString(),
    name,
    detail
  };
  timeline.unshift(event);
  timelineList.replaceChildren(
    ...timeline.slice(0, 25).map((item) => {
      const li = document.createElement("li");
      const title = document.createElement("strong");
      const time = document.createElement("small");
      const detail = document.createElement("code");

      title.textContent = item.name;
      time.textContent = item.at;
      detail.textContent = JSON.stringify(item.detail ?? {});

      li.append(title, time, detail);
      return li;
    })
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setLiveStatus(text: string, mode: "ready" | "warn" | "error" = "ready"): void {
  const heading = document.createElement("strong");
  const summary = document.createElement("p");
  heading.textContent =
    mode === "ready" ? "Live mode active" : mode === "warn" ? "Live mode paused" : "Live mode needs attention";
  summary.textContent = text;
  liveStatus.className = `live-status ${mode}`;
  liveStatus.replaceChildren(heading, summary);
}

function setTrackBStatus(text: string, mode: "ready" | "warn" | "error" = "ready", detail?: string): void {
  const heading = document.createElement("strong");
  const summary = document.createElement("p");
  heading.textContent =
    mode === "ready" ? "Voice Live demo active" : mode === "warn" ? "Voice Live demo ready" : "Voice Live demo needs attention";
  summary.textContent = detail ? `${text}: ${detail}` : text;
  trackBStatus.className = `voice-live-status ${mode}`;
  trackBStatus.replaceChildren(heading, summary);
}

function renderTrackBTranscript(event?: VoiceLiveBrowserEvent): void {
  const title = document.createElement("strong");
  const userLine = document.createElement("p");
  const assistantLine = document.createElement("p");
  const eventLine = document.createElement("small");

  title.textContent = "Conversation";
  userLine.textContent =
    event?.type === "user.transcript.completed" && typeof event.transcript === "string"
      ? `Customer: ${event.transcript}`
      : latestTranscript
        ? `Customer: ${latestTranscript}`
        : "Customer: waiting for speech...";
  assistantLine.textContent = trackBAssistantTranscript
    ? `Assistant: ${trackBAssistantTranscript}`
    : "Assistant: waiting for response...";
  eventLine.textContent = event ? `Last event: ${event.type}` : "Last event: none";
  trackBTranscript.replaceChildren(title, userLine, assistantLine, eventLine);
}

function resetAudioMetrics(): void {
  rollingNoiseSamples.length = 0;
  latestNoiseFloor = 0;
  latestPeakLevel = 0;
  inputLevel.textContent = "0%";
  noiseFloor.textContent = "0%";
  peakLevel.textContent = "0%";
  voiceGaugeRing.style.setProperty("--val", "0");
  voiceGaugeValue.textContent = "0";
  noiseGaugeRing.style.setProperty("--val", "0");
  noiseGaugeValue.textContent = "0";
  peakBar.style.width = "0%";
  snrValue.textContent = "--";
  avatarFrameEl.style.setProperty("--voice", "0");
}

function formatAudioPercent(value: number): string {
  return `${Math.min(100, Math.round(value * 1000) / 10).toFixed(1)}%`;
}

function updateAudioMetrics(rms: number, peak: number): void {
  rollingNoiseSamples.push(rms);
  if (rollingNoiseSamples.length > 40) {
    rollingNoiseSamples.shift();
  }

  latestNoiseFloor = rollingNoiseSamples.reduce((total, value) => total + value, 0) / rollingNoiseSamples.length;
  latestPeakLevel = Math.max(latestPeakLevel * 0.95, peak);
  inputLevel.textContent = formatAudioPercent(rms);
  noiseFloor.textContent = formatAudioPercent(latestNoiseFloor);
  peakLevel.textContent = formatAudioPercent(latestPeakLevel);

  const voicePct = Math.min(100, rms * 280);
  const noisePct = Math.min(100, latestNoiseFloor * 280);
  const peakPct = Math.min(100, latestPeakLevel * 220);
  voiceGaugeRing.style.setProperty("--val", voicePct.toFixed(1));
  voiceGaugeValue.textContent = Math.round(voicePct).toString();
  noiseGaugeRing.style.setProperty("--val", noisePct.toFixed(1));
  noiseGaugeValue.textContent = Math.round(noisePct).toString();
  peakBar.style.width = `${peakPct}%`;
  const snr = 20 * Math.log10((rms + 0.0001) / (latestNoiseFloor + 0.0001));
  snrValue.textContent = `${snr >= 0 ? "+" : ""}${snr.toFixed(0)} dB`;
  avatarFrameEl.style.setProperty("--voice", Math.min(1, rms * 4).toFixed(3));
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${url} failed with ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

interface KnowledgeResponse {
  items: ProductKnowledgeItem[];
  generatedAt: string;
  note: string;
}

function renderKnowledge(items: ProductKnowledgeItem[]): void {
  knowledgeList.replaceChildren(
    ...items.map((item) => {
      const article = document.createElement("article");
      const title = document.createElement("strong");
      const summary = document.createElement("p");
      const meta = document.createElement("small");

      article.className = "knowledge-item";
      title.textContent = item.title;
      summary.textContent = item.summary;
      meta.textContent = `${item.category} | Source: ${item.sourceTitle}`;
      article.append(title, summary, meta);
      return article;
    })
  );
}

async function loadKnowledge(): Promise<void> {
  const knowledge = await fetchJson<KnowledgeResponse>("/api/knowledge");
  renderKnowledge(knowledge.items);
  logEvent("knowledge-loaded", { items: knowledge.items.length, note: knowledge.note });
}

function createVoiceLiveDetail(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  const title = document.createElement("dt");
  const detail = document.createElement("dd");
  title.textContent = label;
  detail.textContent = value;
  row.append(title, detail);
  return row;
}

function appendVoiceLiveList(container: HTMLElement, titleText: string, values: string[]): void {
  if (values.length === 0) {
    return;
  }

  const title = document.createElement("strong");
  const list = document.createElement("ul");
  title.textContent = titleText;
  list.append(
    ...values.map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    })
  );
  container.append(title, list);
}

function renderVoiceLiveStatus(options: {
  configured: boolean;
  message: string;
  details: Array<[string, string]>;
  steps?: string[];
  warnings?: string[];
  sessionUpdate?: Record<string, unknown>;
}): void {
  const heading = document.createElement("strong");
  const summary = document.createElement("p");
  const details = document.createElement("dl");

  heading.textContent = options.configured ? "Voice Live ready for manual comparison" : "Voice Live not fully configured";
  summary.textContent = options.message;
  details.append(...options.details.map(([label, value]) => createVoiceLiveDetail(label, value)));

  voiceLiveStatus.className = `voice-live-status ${options.configured ? "ready" : "warn"}`;
  voiceLiveStatus.replaceChildren(heading, summary, details);
  appendVoiceLiveList(voiceLiveStatus, "Next steps", options.steps ?? []);
  appendVoiceLiveList(voiceLiveStatus, "Warnings", options.warnings ?? []);

  if (options.sessionUpdate) {
    const title = document.createElement("strong");
    const payload = document.createElement("pre");
    title.textContent = "Initial session.update";
    payload.className = "mini-json";
    payload.textContent = JSON.stringify(options.sessionUpdate, null, 2);
    voiceLiveStatus.append(title, payload);
  }
}

function renderVoiceLiveRuntime(config: RuntimeConfig): void {
  renderVoiceLiveStatus({
    configured: config.voiceLive.configured,
    message: config.voiceLive.configured
      ? "Server has endpoint/model settings. Use readiness or session plan for sanitized details."
      : "Server is missing endpoint/model settings for Voice Live comparison.",
    details: [
      ["Endpoint", config.voiceLive.endpointHost || "not configured"],
      ["Model", config.voiceLive.model || "not configured"],
      ["API version", config.voiceLive.apiVersion],
      ["API key on server", config.voiceLive.auth.apiKeyConfigured ? "present" : "not configured"],
      ["Entra manual auth", config.voiceLive.auth.entraManualPossible ? "possible server-side" : "not available"]
    ],
    warnings: config.voiceLive.warnings
  });
}

function renderVoiceLiveReadiness(readiness: VoiceLiveReadiness): void {
  renderVoiceLiveStatus({
    configured: readiness.configured,
    message: readiness.message,
    details: [
      ["Endpoint", readiness.endpointOrigin || readiness.endpointHost || "not configured"],
      ["Model", readiness.model || "not configured"],
      ["API version", readiness.apiVersion],
      ["WebSocket URL", readiness.websocketUrl || "not available until endpoint/model are configured"],
      ["Missing env", readiness.missing.length ? readiness.missing.join(", ") : "none"],
      ["API key on server", readiness.auth.apiKeyConfigured ? "present" : "not configured"],
      ["Entra manual auth", readiness.auth.entraManualPossible ? "possible server-side" : "not available"]
    ],
    steps: readiness.manualNextSteps,
    warnings: [...readiness.auth.notes, ...readiness.warnings]
  });
}

function renderVoiceLivePlan(plan: VoiceLiveSessionPlan): void {
  renderVoiceLiveStatus({
    configured: plan.configured,
    message: plan.message,
    details: [
      ["Endpoint", plan.endpointOrigin],
      ["Model", plan.model],
      ["API version", plan.apiVersion],
      ["WebSocket URL", plan.websocketUrl],
      ["API key on server", plan.auth.apiKeyConfigured ? "present" : "not configured"],
      ["Entra manual auth", plan.auth.entraManualPossible ? "possible server-side" : "not available"]
    ],
    steps: plan.manualNextSteps,
    warnings: [...plan.auth.notes, ...plan.warnings],
    sessionUpdate: plan.sessionUpdate
  });
}

function renderGuardrails(response: AssistantResponse): void {
  guardrailBox.replaceChildren();
  if (!response.guardrails) {
    guardrailBox.className = "guardrail-box empty";
    return;
  }

  const heading = document.createElement("strong");
  const summary = document.createElement("p");
  const reasons = document.createElement("ul");

  guardrailBox.className = `guardrail-box ${response.guardrails.status}`;
  heading.textContent =
    response.guardrails.status === "allowed"
      ? "Guardrails: in scope"
      : response.guardrails.status === "handoff"
        ? "Guardrails: advisor handoff recommended"
        : "Guardrails: out of scope";
  summary.textContent = response.guardrails.safeCompletion;
  reasons.append(
    ...response.guardrails.reasons.map((reason) => {
      const item = document.createElement("li");
      item.textContent = reason;
      return item;
    })
  );

  guardrailBox.append(heading, summary);
  if (response.guardrails.reasons.length > 0) {
    guardrailBox.append(reasons);
  }
}

function renderSources(response: AssistantResponse): void {
  sourceList.replaceChildren();
  if (!response.knowledgeSources || response.knowledgeSources.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No catalogue entry matched this turn.";
    sourceList.append(empty);
    return;
  }

  sourceList.append(
    ...response.knowledgeSources.map((source) => {
      const article = document.createElement("article");
      const title = document.createElement("strong");
      const excerpt = document.createElement("p");
      const link = document.createElement("a");

      article.className = "source-item";
      title.textContent = `${source.title} (${source.category})`;
      excerpt.textContent = source.excerpt;
      link.href = source.sourceUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = source.sourceTitle;
      article.append(title, excerpt, link);
      return article;
    })
  );
}

async function loadConfig(): Promise<void> {
  runtimeConfig = await fetchJson<RuntimeConfig>("/api/config");
  renderBrand(runtimeConfig.brand);
  const voiceLiveText = runtimeConfig.voiceLiveConfigured
    ? "Voice Live config present; Track B available"
    : "Voice Live not fully configured";
  const speechText = runtimeConfig.speechConfigured ? "Speech configured" : "Speech not configured";
  setStatus(`${speechText}. ${voiceLiveText}. Assistant mode: ${runtimeConfig.assistantMode}.`, runtimeConfig.speechConfigured ? "ready" : "warn");
  renderVoiceLiveRuntime(runtimeConfig);
  logEvent("config-loaded", { ...runtimeConfig });
}

function renderBrand(brand: RuntimeConfig["brand"]): void {
  document.body.dataset.brand = (brand.customerShortName || "").toLowerCase();
  if (brand.accentColor) {
    document.documentElement.style.setProperty("--accent", brand.accentColor);
  }
  const wordmark = document.getElementById("brandWordmark");
  if (wordmark) {
    if (brand.logoUrl) {
      wordmark.classList.add("brand-logo");
      wordmark.innerHTML = `<img src="${brand.logoUrl}" alt="${brand.customerShortName}">`;
    } else {
      wordmark.classList.remove("brand-logo");
      wordmark.textContent = brand.customerShortName;
    }
  }
  const poweredBy = document.getElementById("brandPoweredBy");
  if (poweredBy) {
    poweredBy.textContent = `Powered by ${brand.partnerName}, Azure Speech Avatar, and Voice Live Avatar`;
  }
  const eyebrow = document.getElementById("brandEyebrow");
  if (eyebrow) {
    eyebrow.textContent = `${brand.customerName} · In-store assistant`;
  }
  const title = document.getElementById("brandTitle");
  if (title) {
    title.textContent = `Ask ${brand.customerShortName}`;
  }
  const lede = document.getElementById("brandLede");
  if (lede) {
    lede.textContent = brand.tagline || "Talk to a smart store advisor.";
  }
  document.title = `${brand.customerName} retail avatar`;
}

async function beginAudio(): Promise<void> {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micPermission.textContent = "granted";
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("This browser does not expose AudioContext.");
  }
  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(micStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  if (meterTimer) {
    window.clearInterval(meterTimer);
  }

  const values = new Uint8Array(analyser.fftSize);
  meterTimer = window.setInterval(() => {
    analyser?.getByteTimeDomainData(values);
    let sum = 0;
    let peak = 0;
    for (const value of values) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
      peak = Math.max(peak, Math.abs(centered));
    }
    const rms = Math.sqrt(sum / values.length);
    updateAudioMetrics(rms, peak);
  }, 200);

  void avatarAudio.play();
  setStatus("Mic is active. Ready for noisy testing.");
  logEvent("mic-started");
}

async function connectAvatar(): Promise<void> {
  if (!runtimeConfig) {
    throw new Error("Runtime config not loaded.");
  }
  if (!runtimeConfig.speechConfigured) {
    throw new Error("Speech is not configured. Add AZURE_SPEECH_KEY and AZURE_SPEECH_REGION on the server.");
  }

  avatarClient?.close();
  avatarClient = new AzureAvatarClient();
  await avatarClient.connect(avatarVideo, avatarAudio, runtimeConfig, logEvent);
  setStatus("Azure avatar connected.");
}

function renderAssistantResponse(response: AssistantResponse): void {
  responseText.textContent = response.text;
  renderGuardrails(response);
  renderSources(response);
  cards.replaceChildren(
    ...response.cards.map((card) => {
      const article = document.createElement("article");
      const title = document.createElement("strong");
      const body = document.createElement("p");

      article.className = "card";
      title.textContent = card.title;
      body.textContent = card.body;
      article.append(title, body);

      if (card.tag) {
        const tag = document.createElement("small");
        tag.textContent = card.tag;
        article.append(tag);
      }

      return article;
    })
  );
}

async function processUtterance(utterance: string, source: "manual" | "live" = "manual"): Promise<void> {
  const trimmed = utterance.trim();
  if (!trimmed) {
    throw new Error("Enter or recognize an utterance first.");
  }

  const startedAt = performance.now();
  utteranceInput.value = trimmed;
  logEvent("orchestrator-request", { utterance: trimmed, source });
  const response = await fetchJson<AssistantResponse>("/api/assistant/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, utterance: trimmed })
  });
  logEvent("orchestrator-response", { source: response.source, latencyMs: response.latencyMs });
  renderAssistantResponse(response);

  try {
    if (avatarClient) {
      await avatarClient.speak(response.text);
      logEvent("avatar-spoken", { totalTurnMs: Math.round(performance.now() - startedAt) });
    } else {
      speakWithBrowserFallback(response.text);
      logEvent("browser-speech-fallback", { totalTurnMs: Math.round(performance.now() - startedAt) });
    }
  } catch (error) {
    logEvent("speak-failed", { message: String(error) });
    throw error;
  }
}

async function sendUtterance(): Promise<void> {
  await processUtterance(utteranceInput.value, "manual");
}

async function recognizeTranscriptOnce(): Promise<string> {
  if (!runtimeConfig) {
    throw new Error("Runtime config not loaded.");
  }
  if (!runtimeConfig.speechConfigured) {
    throw new Error("Speech is not configured on the server.");
  }

  logEvent("stt-started");
  latestTranscript = await recognizeOnceFromMicrophone(runtimeConfig);
  utteranceInput.value = latestTranscript;
  logEvent("stt-result", { transcript: latestTranscript });
  return latestTranscript;
}

async function recognizeOnce(): Promise<void> {
  await recognizeTranscriptOnce();
}

async function runLiveInteractionLoop(): Promise<void> {
  if (liveLoopRunning) {
    return;
  }

  liveLoopRunning = true;
  try {
    while (liveModeActive) {
      setLiveStatus("Listening. Ask one complete question, then pause.", "ready");
      setStatus("Live mode listening.");

      let transcript = "";
      try {
        transcript = await recognizeTranscriptOnce();
      } catch (error) {
        if (!liveModeActive) {
          break;
        }
        const message = String(error instanceof Error ? error.message : error);
        logEvent("live-stt-retry", { message });
        setLiveStatus("I did not catch that. Listening again.", "warn");
        await delay(900);
        continue;
      }

      if (!liveModeActive) {
        break;
      }
      if (!transcript.trim()) {
        await delay(400);
        continue;
      }

      setLiveStatus("Thinking and speaking. I will listen again when the answer is finished.", "ready");
      await processUtterance(transcript, "live");

      if (liveModeActive) {
        await delay(700);
      }
    }
  } catch (error) {
    liveModeActive = false;
    const message = String(error instanceof Error ? error.message : error);
    setStatus(message, "error");
    setLiveStatus(message, "error");
    logEvent("live-mode-error", { message });
  } finally {
    liveLoopRunning = false;
    if (!liveModeActive) {
      setLiveStatus("Stopped. Click Start live interaction to resume hands-free turns.", "warn");
      setStatus("Live mode stopped.", "warn");
    }
  }
}

async function startLiveInteraction(): Promise<void> {
  if (!runtimeConfig) {
    throw new Error("Runtime config not loaded.");
  }
  if (!runtimeConfig.speechConfigured) {
    throw new Error("Speech is not configured on the server.");
  }
  if (liveModeActive) {
    return;
  }

  liveModeActive = true;
  setLiveStatus("Starting microphone and avatar, then I will listen for the first question.", "ready");

  try {
    if (!micStream) {
      await beginAudio();
    }
    if (!avatarClient) {
      await connectAvatar();
    }
  } catch (error) {
    liveModeActive = false;
    setLiveStatus("Could not start live mode. Check microphone permission and avatar connectivity.", "error");
    throw error;
  }

  logEvent("live-mode-started");
  void runLiveInteractionLoop();
}

async function stopLiveInteraction(): Promise<void> {
  liveModeActive = false;
  window.speechSynthesis?.cancel();
  await avatarClient?.stopSpeaking();
  setLiveStatus("Stopped. Click Start live interaction to resume hands-free turns.", "warn");
  logEvent("live-mode-stopped");
}

function handleTrackBEvent(event: VoiceLiveBrowserEvent): void {
  logEvent(`track-b:${event.type}`, event as Record<string, unknown>);

  if (event.type === "user.transcript.completed" && typeof event.transcript === "string") {
    latestTranscript = event.transcript;
  }

  if (event.type === "assistant.transcript.delta" && typeof event.delta === "string") {
    trackBAssistantTranscript += event.delta;
  }

  if (event.type === "assistant.transcript.done" && typeof event.transcript === "string") {
    trackBAssistantTranscript = event.transcript;
  }

  if (event.type === "response.created") {
    trackBAssistantTranscript = "";
    setTrackBStatus("Assistant is responding", "ready");
  } else if (event.type === "speech.started") {
    setTrackBStatus("Listening", "ready", "customer speech detected");
  } else if (event.type === "response.done") {
    setTrackBStatus("Ready for next input", "ready");
  }

  renderTrackBTranscript(event);
}

async function startTrackB(): Promise<void> {
  if (trackBClient) {
    await trackBClient.reset();
  }

  trackBAssistantTranscript = "";
  micPermission.textContent = "requesting";
  resetAudioMetrics();
  renderTrackBTranscript();
  trackBClient = new VoiceLiveAvatarClient({
    onStatus: (status, detail) => setTrackBStatus(status, "ready", detail),
    onEvent: handleTrackBEvent,
    onAudioLevel: ({ rms, peak }) => updateAudioMetrics(rms, peak),
    onError: (message) => {
      setTrackBStatus(message, "error");
      logEvent("track-b-error", { message });
    }
  });

  try {
    const session = await trackBClient.start(avatarVideo, avatarAudio);
    await trackBClient.startMicrophone();
    micPermission.textContent = "granted";
    setStatus("Guided Voice Live demo is running.");
    setTrackBStatus("Speak naturally to the avatar. Try interrupting it while it answers.", "ready", `${session.region}, ${session.model}`);
    logEvent("track-b-started", {
      sessionId: session.sessionId,
      model: session.model,
      region: session.region,
      avatar: session.avatar
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    setTrackBStatus("Avatar transport could not connect", "error", message);
    logEvent("track-b-start-failed", { message });
    throw error;
  }
}

function stopTrackBMic(): void {
  trackBClient?.stopMicrophone();
  micPermission.textContent = "stopped";
  resetAudioMetrics();
  logEvent("track-b-mic-stopped");
}

function setMuteButtonLabel(muted: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>("#muteTrackBMicButton");
  if (!btn) return;
  btn.textContent = muted ? "Unmute mic" : "Mute mic";
  btn.classList.toggle("primary", muted);
}

function toggleTrackBMute(): void {
  if (!trackBClient) {
    setTrackBStatus("Start the avatar first, then mute or unmute.", "warn");
    return;
  }
  const muted = !trackBClient.muted;
  trackBClient.setMuted(muted);
  setMuteButtonLabel(muted);
  micPermission.textContent = muted ? "muted" : "granted";
  if (muted) {
    resetAudioMetrics();
  }
  logEvent(muted ? "track-b-mic-muted" : "track-b-mic-unmuted");
}

function interruptTrackB(): void {
  trackBClient?.interrupt();
  logEvent("track-b-interrupt");
}

async function resetTrackB(): Promise<void> {
  await trackBClient?.reset();
  trackBClient = undefined;
  trackBAssistantTranscript = "";
  micPermission.textContent = "stopped";
  resetAudioMetrics();
  renderTrackBTranscript();
  setTrackBStatus("Reset complete. Select Tap to talk when you're ready.", "warn");
  logEvent("track-b-reset");
}

function exportEvidence(): void {
  const payload: ValidationExport = {
    sessionId,
    exportedAt: new Date().toISOString(),
    runtimeConfig,
    latestTranscript,
    latestNoiseFloor,
    latestPeakLevel,
    testerNotes: testerNotes.value,
    timeline
  };
  exportBox.textContent = JSON.stringify(payload, null, 2);
  void navigator.clipboard?.writeText(exportBox.textContent);
  logEvent("evidence-exported");
}

async function resetSession(): Promise<void> {
  liveModeActive = false;
  window.speechSynthesis?.cancel();
  avatarClient?.close();
  avatarClient = undefined;
  await resetTrackB();
  latestTranscript = "";
  resetAudioMetrics();
  responseText.textContent = "";
  cards.replaceChildren();
  guardrailBox.replaceChildren();
  sourceList.replaceChildren();
  setLiveStatus("Reset complete. Live mode is off.", "warn");
  setStatus("Reset complete.");
  logEvent("session-reset");
}

async function toggleFullscreen(): Promise<void> {
  const target = document.documentElement;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else if (target.requestFullscreen) {
    await target.requestFullscreen();
  } else {
    setStatus("Fullscreen is not supported in this browser.", "warn");
  }
}

document.addEventListener("fullscreenchange", () => {
  const button = document.querySelector<HTMLButtonElement>("#fullscreenButton");
  if (!button) return;
  const isFullscreen = Boolean(document.fullscreenElement);
  button.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
  logEvent(isFullscreen ? "fullscreen-enter" : "fullscreen-exit");
});

function wireButton(selector: string, handler: () => Promise<void> | void): void {
  document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", () => {
    Promise.resolve(handler()).catch((error) => {
      setStatus(String(error.message || error), "error");
      logEvent("error", { message: String(error.message || error) });
    });
  });
}

wireButton("#beginButton", beginAudio);
wireButton("#connectAvatarButton", connectAvatar);
wireButton("#liveButton", startLiveInteraction);
wireButton("#stopLiveButton", stopLiveInteraction);
wireButton("#startTrackBButton", startTrackB);
wireButton("#muteTrackBMicButton", toggleTrackBMute);
wireButton("#stopTrackBMicButton", stopTrackBMic);
wireButton("#interruptTrackBButton", interruptTrackB);
wireButton("#resetTrackBButton", resetTrackB);
wireButton("#fullscreenButton", toggleFullscreen);
wireButton("#sendButton", sendUtterance);
wireButton("#recognizeButton", recognizeOnce);
wireButton("#fallbackSpeakButton", () => speakWithBrowserFallback(responseText.textContent || utteranceInput.value));
wireButton("#stopButton", async () => {
  window.speechSynthesis?.cancel();
  await avatarClient?.stopSpeaking();
  logEvent("stop-speaking");
});
wireButton("#resetButton", resetSession);
wireButton("#audioTestButton", () => {
  speakWithBrowserFallback("Audio test. If you can hear this clearly, run the phrase test while noise is present.");
  logEvent("audio-test");
});
wireButton("#phraseButton", () => {
  utteranceInput.value = [
    "I need internet and a mobile plan for my family.",
    "My daughter needs data and she travels in Europe.",
    "Can I add TV to the pack?",
    "Stop, I meant prepaid.",
    "Can you cancel my contract and take my bank details?"
  ].join("\n");
  logEvent("test-phrases-inserted");
});
wireButton("#voiceLiveButton", async () => {
  const readiness = await fetchJson<VoiceLiveReadiness>("/api/voice-live/readiness");
  renderVoiceLiveReadiness(readiness);
  exportBox.textContent = JSON.stringify(readiness, null, 2);
  logEvent("voice-live-readiness", readiness as unknown as Record<string, unknown>);
});
wireButton("#prepareVoiceLiveButton", async () => {
  const plan = await fetchJson<VoiceLiveSessionPlan>("/api/voice-live/session-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: navigator.language || "en-US" })
  });
  renderVoiceLivePlan(plan);
  exportBox.textContent = JSON.stringify(plan, null, 2);
  logEvent("voice-live-session-plan", plan as unknown as Record<string, unknown>);
});
wireButton("#exportButton", exportEvidence);

if (!("mediaDevices" in navigator)) {
  micPermission.textContent = "not supported";
  setStatus("This browser does not expose navigator.mediaDevices.", "error");
} else {
  void navigator.permissions
    ?.query({ name: "microphone" as PermissionName })
    .then((permission) => {
      micPermission.textContent = permission.state;
      permission.onchange = () => {
        micPermission.textContent = permission.state;
        logEvent("mic-permission-change", { state: permission.state });
      };
    })
    .catch(() => {
      micPermission.textContent = "prompt";
    });
}

void loadConfig();
void loadKnowledge().catch((error) => {
  logEvent("knowledge-load-failed", { message: String(error.message || error) });
});
