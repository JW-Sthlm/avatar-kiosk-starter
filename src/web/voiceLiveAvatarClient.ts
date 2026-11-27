interface VoiceLiveIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface VoiceLiveCreateResponse {
  sessionId: string;
  model: string;
  apiVersion: string;
  voice: string;
  region: string;
  avatar: {
    character: string;
    style?: string;
  };
  iceServers?: VoiceLiveIceServer[];
}

export interface VoiceLiveBrowserEvent {
  type: string;
  at?: string;
  [key: string]: unknown;
}

export interface VoiceLiveAvatarClientCallbacks {
  onStatus?: (status: string, detail?: string) => void;
  onEvent?: (event: VoiceLiveBrowserEvent) => void;
  onError?: (message: string) => void;
  onAudioLevel?: (level: { rms: number; peak: number }) => void;
}

function getWebSocketUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/voice-live/sessions/${encodeURIComponent(sessionId)}/ws`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
    };
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Browser WebSocket could not connect to the Voice Live broker."));
    };
    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
  });
}

function waitForIceGathering(peerConnection: RTCPeerConnection): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    }, 10000);

    const handleChange = () => {
      if (peerConnection.iceGatheringState === "complete") {
        window.clearTimeout(timeout);
        peerConnection.removeEventListener("icegatheringstatechange", handleChange);
        resolve();
      }
    };

    peerConnection.addEventListener("icegatheringstatechange", handleChange);
  });
}

function waitForWebRtcConnected(peerConnection: RTCPeerConnection): Promise<void> {
  const state = peerConnection.connectionState;
  if (state === "connected") {
    return Promise.resolve();
  }
  if (state === "failed" || state === "closed") {
    return Promise.reject(new Error(`WebRTC negotiation ended early with state "${state}".`));
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peerConnection.removeEventListener("connectionstatechange", handleChange);
      reject(
        new Error(
          `WebRTC did not reach a connected state in time (state="${peerConnection.connectionState}", ice="${peerConnection.iceConnectionState}").`
        )
      );
    }, 15000);

    const handleChange = () => {
      const next = peerConnection.connectionState;
      if (next === "connected") {
        window.clearTimeout(timeout);
        peerConnection.removeEventListener("connectionstatechange", handleChange);
        resolve();
        return;
      }
      if (next === "failed" || next === "closed") {
        window.clearTimeout(timeout);
        peerConnection.removeEventListener("connectionstatechange", handleChange);
        reject(new Error(`WebRTC failed during avatar negotiation (state="${next}", ice="${peerConnection.iceConnectionState}").`));
      }
    };

    peerConnection.addEventListener("connectionstatechange", handleChange);
  });
}

function downsampleTo24Khz(input: Float32Array, sourceRate: number): Int16Array {
  const targetRate = 24000;
  if (sourceRate === targetRate) {
    return float32ToPcm16(input);
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    output[i] = floatToPcm16Sample(count > 0 ? sum / count : 0);
  }

  return output;
}

function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = floatToPcm16Sample(input[i]);
  }
  return output;
}

function floatToPcm16Sample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function pcm16ToBase64(input: Int16Array): string {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

function calculateAudioLevel(input: Float32Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (const sample of input) {
    const value = Math.abs(sample);
    sum += sample * sample;
    peak = Math.max(peak, value);
  }
  return {
    rms: Math.sqrt(sum / input.length),
    peak
  };
}

export class VoiceLiveAvatarClient {
  private session: VoiceLiveCreateResponse | undefined;
  private socket: WebSocket | undefined;
  private peerConnection: RTCPeerConnection | undefined;
  private microphoneStream: MediaStream | undefined;
  private audioContext: AudioContext | undefined;
  private sourceNode: MediaStreamAudioSourceNode | undefined;
  private processorNode: ScriptProcessorNode | undefined;
  private isSendingAudio = false;
  private isMuted = false;

  constructor(private readonly callbacks: VoiceLiveAvatarClientCallbacks = {}) {}

  get sessionId(): string | undefined {
    return this.session?.sessionId;
  }

  async start(videoElement: HTMLVideoElement, audioElement: HTMLAudioElement): Promise<VoiceLiveCreateResponse> {
    this.callbacks.onStatus?.("connecting", "Creating server-side Voice Live session");
    const createResponse = await fetch("/api/voice-live/sessions", { method: "POST" });
    if (!createResponse.ok) {
      const detail = await createResponse.text();
      throw new Error(`Voice Live session creation failed (${createResponse.status}): ${detail}`);
    }

    this.session = (await createResponse.json()) as VoiceLiveCreateResponse;
    this.socket = new WebSocket(getWebSocketUrl(this.session.sessionId));
    this.socket.addEventListener("message", (event) => this.handleSocketMessage(event));
    this.socket.addEventListener("close", () => this.callbacks.onStatus?.("disconnected", "Broker WebSocket closed"));
    this.socket.addEventListener("error", () => this.callbacks.onError?.("Broker WebSocket error."));
    await waitForOpen(this.socket);

    this.callbacks.onStatus?.("avatar connecting", "Negotiating avatar WebRTC media");
    await this.connectAvatar(videoElement, audioElement, this.session.iceServers);
    this.callbacks.onStatus?.("avatar connected", "Voice Live avatar media is ready");

    return this.session;
  }

  async startMicrophone(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Start Track B before starting the microphone.");
    }
    if (this.isSendingAudio) {
      return;
    }

    this.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextCtor();
    await this.audioContext.resume();

    this.sourceNode = this.audioContext.createMediaStreamSource(this.microphoneStream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      if (!this.isSendingAudio || this.isMuted || !this.socket || this.socket.readyState !== WebSocket.OPEN || !this.audioContext) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      this.callbacks.onAudioLevel?.(calculateAudioLevel(input));
      const pcm = downsampleTo24Khz(input, this.audioContext.sampleRate);
      this.socket.send(
        JSON.stringify({
          type: "audio",
          audio: pcm16ToBase64(pcm)
        })
      );
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
    this.isSendingAudio = true;
    this.callbacks.onStatus?.("listening", "Microphone streaming to Voice Live");
  }

  stopMicrophone(): void {
    this.isSendingAudio = false;
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.processorNode = undefined;
    this.sourceNode = undefined;
    for (const track of this.microphoneStream?.getTracks() || []) {
      track.stop();
    }
    this.microphoneStream = undefined;
    void this.audioContext?.close();
    this.audioContext = undefined;
    this.callbacks.onStatus?.("avatar connected", "Microphone stopped");
  }

  interrupt(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "response.cancel" }));
      this.callbacks.onStatus?.("interrupting", "Sent response.cancel to Voice Live");
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    for (const track of this.microphoneStream?.getTracks() || []) {
      track.enabled = !muted;
    }
    this.callbacks.onStatus?.(
      muted ? "muted" : "listening",
      muted ? "Mic muted. The avatar is not hearing you." : "Mic live. The avatar is listening."
    );
  }

  get muted(): boolean {
    return this.isMuted;
  }

  sendText(text: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "text", text }));
    }
  }

  async reset(): Promise<void> {
    this.isMuted = false;
    this.stopMicrophone();
    this.peerConnection?.close();
    this.peerConnection = undefined;
    this.socket?.close(1000, "Browser reset");
    this.socket = undefined;

    if (this.session) {
      await fetch(`/api/voice-live/sessions/${encodeURIComponent(this.session.sessionId)}`, {
        method: "DELETE"
      }).catch((error: unknown) => {
        this.callbacks.onError?.(error instanceof Error ? error.message : String(error));
      });
    }

    this.session = undefined;
    this.callbacks.onStatus?.("disconnected", "Track B reset");
  }

  private async connectAvatar(
    videoElement: HTMLVideoElement,
    audioElement: HTMLAudioElement,
    iceServers?: VoiceLiveIceServer[]
  ): Promise<void> {
    if (!this.session) {
      throw new Error("Voice Live session has not been created.");
    }

    const peerConnection = new RTCPeerConnection({ iceServers });
    this.peerConnection = peerConnection;

    videoElement.muted = true;
    videoElement.playsInline = true;
    audioElement.autoplay = true;

    peerConnection.addTransceiver("video", { direction: "recvonly" });
    peerConnection.addTransceiver("audio", { direction: "recvonly" });
    peerConnection.onconnectionstatechange = () => {
      this.callbacks.onStatus?.(`webrtc ${peerConnection.connectionState}`);
    };
    peerConnection.oniceconnectionstatechange = () => {
      this.callbacks.onStatus?.(`ice ${peerConnection.iceConnectionState}`);
    };
    peerConnection.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (event.track.kind === "video") {
        videoElement.srcObject = stream;
        void videoElement.play().catch((error: unknown) => {
          this.callbacks.onError?.(error instanceof Error ? error.message : String(error));
        });
      } else if (event.track.kind === "audio") {
        audioElement.srcObject = stream;
        void audioElement.play().catch((error: unknown) => {
          this.callbacks.onError?.(error instanceof Error ? error.message : String(error));
        });
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);

    const clientSdp = peerConnection.localDescription?.sdp;
    if (!clientSdp) {
      throw new Error("Browser could not create a WebRTC SDP offer.");
    }

    const response = await fetch(`/api/voice-live/sessions/${encodeURIComponent(this.session.sessionId)}/avatar-offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientSdp })
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Avatar SDP negotiation failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as { serverSdp?: string };
    if (!payload.serverSdp) {
      throw new Error("Voice Live avatar response did not include serverSdp.");
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: payload.serverSdp
    });
    await waitForWebRtcConnected(peerConnection);
  }

  private handleSocketMessage(event: MessageEvent): void {
    const parsed = JSON.parse(event.data as string) as VoiceLiveBrowserEvent;
    this.callbacks.onEvent?.(parsed);

    if (parsed.type === "error") {
      const message = typeof parsed.message === "string" ? parsed.message : "Voice Live broker error.";
      this.callbacks.onError?.(message);
    }
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
