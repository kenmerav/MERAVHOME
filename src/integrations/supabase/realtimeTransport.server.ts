import WebSocket from "ws";

export const realtimeTransport = globalThis.WebSocket ?? WebSocket;
