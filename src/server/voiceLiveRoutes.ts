import { Router } from "express";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer } from "ws";
import { track } from "./telemetry.js";
import type { VoiceLivePrototypeSessionStore } from "./voiceLiveSession.js";

interface VoiceLiveWebSocketOptions {
  isRequestAuthorized?: (request: IncomingMessage) => boolean;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createVoiceLiveRouter(store: VoiceLivePrototypeSessionStore): Router {
  const router = Router();

  router.post("/sessions", async (_, res) => {
    try {
      const session = await store.create();
      track.event("voicelive.session.created", { sessionId: session.sessionId });
      res.status(201).json(session);
    } catch (error) {
      track.event("voicelive.session.create-failed", { detail: getErrorMessage(error) });
      track.exception(error);
      res.status(409).json({
        error: "Unable to create Voice Live Track B session.",
        detail: getErrorMessage(error)
      });
    }
  });

  router.post("/sessions/:sessionId/avatar-offer", async (req, res) => {
    const session = store.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Voice Live session not found." });
      return;
    }

    const clientSdp = readString(req.body?.clientSdp);
    if (!clientSdp || !clientSdp.startsWith("v=0")) {
      res.status(400).json({ error: "clientSdp must be a valid SDP offer string." });
      return;
    }

    try {
      const serverSdp = await session.connectAvatar(clientSdp);
      track.event("voicelive.avatar.connected", { sessionId: req.params.sessionId });
      res.json({ serverSdp });
    } catch (error) {
      track.event("voicelive.avatar.connect-failed", {
        sessionId: req.params.sessionId,
        detail: getErrorMessage(error)
      });
      track.exception(error, { sessionId: req.params.sessionId });
      res.status(502).json({
        error: "Voice Live avatar SDP negotiation failed.",
        detail: getErrorMessage(error)
      });
    }
  });

  router.post("/sessions/:sessionId/text", async (req, res) => {
    const session = store.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Voice Live session not found." });
      return;
    }

    const text = readString(req.body?.text);
    if (!text) {
      res.status(400).json({ error: "text is required." });
      return;
    }

    try {
      await session.sendText(text);
      track.event("voicelive.text.sent", {
        sessionId: req.params.sessionId,
        textChars: text.length
      });
      res.status(202).json({ accepted: true });
    } catch (error) {
      track.event("voicelive.text.failed", {
        sessionId: req.params.sessionId,
        detail: getErrorMessage(error)
      });
      track.exception(error, { sessionId: req.params.sessionId });
      res.status(502).json({
        error: "Voice Live text fallback failed.",
        detail: getErrorMessage(error)
      });
    }
  });

  router.delete("/sessions/:sessionId", async (req, res) => {
    const deleted = await store.delete(req.params.sessionId);
    if (!deleted) {
      res.status(404).json({ error: "Voice Live session not found." });
      return;
    }
    track.event("voicelive.session.deleted", { sessionId: req.params.sessionId });
    res.status(204).end();
  });

  return router;
}

export function attachVoiceLiveWebSocketServer(
  server: Server,
  store: VoiceLivePrototypeSessionStore,
  options: VoiceLiveWebSocketOptions = {}
): WebSocketServer {
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const host = request.headers.host || "localhost";
    const url = new URL(request.url || "/", `http://${host}`);
    const match = /^\/api\/voice-live\/sessions\/([^/]+)\/ws$/.exec(url.pathname);

    if (!match) {
      return;
    }

    if (options.isRequestAuthorized && !options.isRequestAuthorized(request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const session = store.get(match[1]);
    if (!session) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      session.attachSocket(webSocket);
    });
  });

  return webSocketServer;
}
