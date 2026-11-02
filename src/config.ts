/**
 * Configuration comes from the environment so nothing secret is written down
 * next to the code. Room links are secrets: they carry the encryption key.
 */
export interface RoomConfig {
  /** Socket.IO relay the browser talks to, e.g. http://127.0.0.1:8082. */
  relayUrl: string;
  /** HTTP Origin presented on the handshake; relays commonly check it. */
  origin: string;
  /** Excalidraw frontend, used by `/excalidraw open` to build a link. */
  frontendUrl: string;
  /** Display name shown to people in the room. */
  agentName: string;
  /** Optional room link, so a session can join without being told the URL. */
  roomLink: string | null;
  /**
   * HTTP storage backend for scene persistence, or null to disable it. The
   * relay stores nothing, so without this a reload loses the scene.
   */
  storageUrl: string | null;
  /** Socket.IO transport to pin. The Go relay panicked once on an upgrade. */
  transport: "websocket" | "polling";
  /** Print protocol diagnostics to stderr. */
  debug: boolean;
}

const DEFAULTS = {
  relayUrl: "http://127.0.0.1:8082",
  frontendUrl: "http://127.0.0.1",
  storageUrl: "http://127.0.0.1:8081/api/v2",
  agentName: "pi-agent",
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RoomConfig {
  const frontendUrl = env.EXCALIDRAW_URL?.trim() || DEFAULTS.frontendUrl;
  const transport = env.EXCALIDRAW_TRANSPORT?.trim() === "polling" ? "polling" : "websocket";
  return {
    relayUrl: (env.EXCALIDRAW_RELAY_URL?.trim() || DEFAULTS.relayUrl).replace(/\/+$/, ""),
    origin: (env.EXCALIDRAW_ORIGIN?.trim() || frontendUrl).replace(/\/+$/, ""),
    frontendUrl: frontendUrl.replace(/\/+$/, ""),
    agentName: env.EXCALIDRAW_AGENT_NAME?.trim() || DEFAULTS.agentName,
    roomLink: env.EXCALIDRAW_ROOM_LINK?.trim() || null,
    storageUrl:
      env.EXCALIDRAW_STORAGE_URL === undefined
        ? DEFAULTS.storageUrl
        : env.EXCALIDRAW_STORAGE_URL.trim().replace(/\/+$/, "") || null,
    transport,
    debug: env.EXCALIDRAW_ROOM_DEBUG === "1",
  };
}

export function log(config: RoomConfig, ...args: unknown[]): void {
  if (config.debug) console.error("[excalidraw-room]", ...args);
}
