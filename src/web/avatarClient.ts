import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import type { RelayTokenResponse, RuntimeConfig, SpeechTokenResponse } from "../shared/contracts.js";

type Logger = (name: string, detail?: Record<string, unknown>) => void;

function normalizeRelayToken(payload: unknown): RelayTokenResponse {
  const source = payload as Record<string, unknown>;
  const rawUrls = source.urls ?? source.Urls;
  const urls = Array.isArray(rawUrls) ? rawUrls.map(String) : [String(rawUrls ?? "")].filter(Boolean);
  const username = String(source.username ?? source.Username ?? "");
  const credential = String(source.credential ?? source.Credential ?? source.password ?? source.Password ?? "");

  if (urls.length === 0 || !username || !credential) {
    throw new Error("Avatar relay token response did not include urls, username, and credential.");
  }

  return { urls, username, credential };
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${url} failed with ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export class AzureAvatarClient {
  private synthesizer?: SpeechSDK.AvatarSynthesizer;
  private peerConnection?: RTCPeerConnection;

  async connect(
    videoElement: HTMLVideoElement,
    audioElement: HTMLAudioElement,
    config: RuntimeConfig,
    log: Logger
  ): Promise<void> {
    const speechToken = await fetchJson<SpeechTokenResponse>("/api/speech/token");
    const relayToken = normalizeRelayToken(await fetchJson<unknown>("/api/avatar/relay-token"));

    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(speechToken.token, speechToken.region);
    speechConfig.speechSynthesisVoiceName = config.voiceName;

    const videoFormat = new SpeechSDK.AvatarVideoFormat();
    const avatarConfig = new SpeechSDK.AvatarConfig(config.avatarCharacter, config.avatarStyle, videoFormat);
    avatarConfig.backgroundColor = "#FFFFFFFF";

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: relayToken.urls,
          username: relayToken.username,
          credential: relayToken.credential
        }
      ]
    });

    this.peerConnection.addTransceiver("video", { direction: "sendrecv" });
    this.peerConnection.addTransceiver("audio", { direction: "sendrecv" });

    this.peerConnection.oniceconnectionstatechange = () => {
      log("webrtc-ice-state", { state: this.peerConnection?.iceConnectionState });
    };

    this.peerConnection.onconnectionstatechange = () => {
      log("webrtc-connection-state", { state: this.peerConnection?.connectionState });
    };

    this.peerConnection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) {
        return;
      }

      if (event.track.kind === "video") {
        videoElement.srcObject = stream;
        void videoElement.play();
        log("avatar-video-track");
      }

      if (event.track.kind === "audio") {
        audioElement.srcObject = stream;
        void audioElement.play();
        log("avatar-audio-track");
      }
    };

    this.synthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
    await this.synthesizer.startAvatarAsync(this.peerConnection);
    log("avatar-connected", { voice: config.voiceName, character: config.avatarCharacter, style: config.avatarStyle });
  }

  async speak(text: string): Promise<void> {
    if (!this.synthesizer) {
      throw new Error("Avatar is not connected.");
    }

    const result = await this.synthesizer.speakTextAsync(text);
    if (result.reason === SpeechSDK.ResultReason.Canceled) {
      throw new Error(`Avatar speech canceled: ${result.errorDetails || "unknown error"}`);
    }
  }

  async stopSpeaking(): Promise<void> {
    if (this.synthesizer) {
      await this.synthesizer.stopSpeakingAsync();
    }
  }

  close(): void {
    this.synthesizer?.close();
    this.peerConnection?.close();
    this.synthesizer = undefined;
    this.peerConnection = undefined;
  }
}

export async function recognizeOnceFromMicrophone(config: RuntimeConfig): Promise<string> {
  const speechToken = await fetchJson<SpeechTokenResponse>("/api/speech/token");
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(speechToken.token, speechToken.region);
  speechConfig.speechRecognitionLanguage = "en-US";
  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  return await new Promise<string>((resolve, reject) => {
    recognizer.recognizeOnceAsync(
      (result) => {
        recognizer.close();
        if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          resolve(result.text);
          return;
        }
        reject(new Error(result.errorDetails || `Recognition finished with reason ${result.reason}`));
      },
      (error) => {
        recognizer.close();
        reject(new Error(String(error)));
      }
    );
  });
}

export function speakWithBrowserFallback(text: string): void {
  if (!("speechSynthesis" in window)) {
    throw new Error("Browser speech synthesis is not available.");
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

