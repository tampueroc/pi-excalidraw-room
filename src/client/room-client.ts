/**
 * Headless participant in an Excalidraw live collaboration room.
 *
 * The relay speaks the protocol of upstream `excalidraw-room`; every payload
 * is JSON `{type, payload}` encrypted with the room key (AES-GCM, 12 byte IV)
 * and carried by `server-broadcast` / `client-broadcast`:
 *
 *   server → "init-room"                      we answer "join-room" <roomId>
 *   server → "first-in-room"                  nobody else here, so no scene
 *   server → "new-user" <socketId>            a peer joined: send it SCENE_INIT
 *   server → "room-user-change" <socketId[]>  current participants
 *   server → "client-broadcast" <cipher,iv>   a peer message, decrypt to read
 *   we     → "server-broadcast" <roomId,cipher,iv>
 *
 * The relay stores nothing: a fresh join always gets `first-in-room`, so
 * durability is the storage backend's job (see docs/IMPLEMENTATION_PLAN.md).
 */
import { io, type Socket } from "socket.io-client";
import { log, type RoomConfig } from "../config.ts";
import { parseRoomLink, redactLink, type RoomLink } from "../link.ts";
import { decrypt, encryptJson } from "./crypto.ts";
import { isSceneElement, orderByIndex, reconcile, sceneVersion } from "../scene/reconcile.ts";
import { loadRoom, saveRoom } from "../storage/http-storage.ts";
import type { SceneElement } from "../scene/types.ts";
import type { BuiltElement } from "../scene/elements.ts";

/** How long a join waits for the room to say who is here. */
const INIT_TIMEOUT_MS = 5000;
/** Quiet period before a change is written to the storage backend. */
const PERSIST_DEBOUNCE_MS = 1000;
/** Presence refresh, so a browser that joins later still learns our name. */
const IDLE_BROADCAST_MS = 30_000;
/** Handshake attempts before a join reports the relay as unreachable. */
const MAX_CONNECT_ATTEMPTS = 3;
/** Marks our presence as an agent rather than a person; browsers ignore it. */
const AGENT_MARKER = "piExcalidrawAgent";

export interface RoomPeer {
  socketId: string;
  name: string | null;
}

export type SceneSource = "empty" | "peer" | "storage" | null;

export interface RoomStatus {
  connected: boolean;
  roomId: string | null;
  /** The room id and hidden key, for logs: never print the key itself. */
  room: string | null;
  relayUrl: string;
  name: string;
  peers: RoomPeer[];
  source: SceneSource;
  elementCount: number;
  deletedCount: number;
  sceneVersion: number;
  lastRemoteUpdate: string | null;
  /** Whether the stored copy matches the scene we hold. */
  persisted: boolean;
  lastPersistedAt: string | null;
  persistError: string | null;
}

interface WireMessage {
  type?: unknown;
  payload?: { elements?: unknown; socketId?: unknown; username?: unknown };
}

/**
 * Close a socket for good.
 *
 * `disconnect()` alone leaves the websocket open against the Go relay, because
 * that server never completes the close handshake: a long session that joins
 * and leaves repeatedly would accumulate dead TCP connections. Terminating the
 * transport handle releases it.
 */
export function hardClose(socket: Socket): void {
  const transport = (socket.io?.engine as { transport?: { ws?: { terminate?: () => void } } } | undefined)
    ?.transport;
  const ws = transport?.ws;
  socket.removeAllListeners();
  socket.io.opts.reconnection = false;
  socket.disconnect();
  try {
    ws?.terminate?.();
  } catch {
    // The transport is already gone; nothing to release.
  }
}

export class RoomClient {
  private socket: Socket | null = null;
  private roomId: string | null = null;
  private roomKey: string | null = null;
  /** The link we joined with, so `/excalidraw open` can reopen it. */
  private currentLink: RoomLink | null = null;
  private scene = new Map<string, SceneElement>();
  private peers = new Map<string, string | null>();
  private source: SceneSource = null;
  private lastRemoteUpdate: number | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  /** Version of the scene the storage backend last accepted. */
  private storedVersion: number | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private lastPersistedAt: number | null = null;
  private persistError: string | null = null;
  private sceneListeners = new Set<() => void>();

  private readonly config: RoomConfig;

  constructor(config: RoomConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.socket?.connected === true && this.roomId !== null;
  }

  get roomIdOrNull(): string | null {
    return this.roomId;
  }

  /** The parsed link of the current room; carries the key, so do not print it. */
  get roomLink(): RoomLink | null {
    return this.currentLink;
  }

  onSceneChange(listener: () => void): () => void {
    this.sceneListeners.add(listener);
    return () => this.sceneListeners.delete(listener);
  }

  elements(includeDeleted = false): SceneElement[] {
    const ordered = orderByIndex([...this.scene.values()]);
    return includeDeleted ? ordered : ordered.filter((el) => !el.isDeleted);
  }

  element(id: string): SceneElement | undefined {
    return this.scene.get(id);
  }

  /** Fractional index of the last element, the anchor for appending. */
  lastIndex(): string | null {
    const ordered = orderByIndex([...this.scene.values()]);
    const last = ordered[ordered.length - 1];
    return (last?.index as string | undefined) ?? null;
  }

  /** The scene as a map, for the pure mutation helpers. */
  sceneMap(): Map<string, SceneElement> {
    return this.scene;
  }

  /**
   * The single write path: record the change locally, then send exactly those
   * elements to the room. Peers merge them by id and version.
   */
  async apply(changed: BuiltElement[]): Promise<void> {
    if (changed.length === 0) return;
    for (const element of changed) this.scene.set(element.id, element);
    this.notifyScene();
    await this.broadcast("SCENE_UPDATE", changed);
    this.schedulePersist();
  }

  /** Read the scene the frontend last saved, if the backend has one. */
  private async loadStored(): Promise<void> {
    if (!this.config.storageUrl || !this.roomId || !this.roomKey) return;
    const stored = await loadRoom(this.config.storageUrl, this.roomId, this.roomKey);
    if (!stored) return;
    const elements = stored.elements.filter(isSceneElement);
    const merged = reconcile([...this.scene.values()], elements);
    this.scene = new Map(merged.map((el) => [el.id, el]));
    this.storedVersion = stored.version;
    if (this.source === null) this.source = "storage";
    log(this.config, "loaded", elements.length, "element(s) from storage");
    this.notifyScene();
  }

  /**
   * Saving is debounced: a tool that draws three shapes and connects them would
   * otherwise POST three times, and the backend accepts one write per second at
   * best without contention.
   */
  private schedulePersist(): void {
    if (!this.config.storageUrl) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref();
  }

  /** Write the scene if it is ahead of the stored copy. Serialised per client. */
  private persist(): Promise<void> {
    this.persistChain = this.persistChain.then(async () => {
      if (!this.config.storageUrl || !this.roomId || !this.roomKey) return;
      const all = this.elements(true);
      const version = sceneVersion(all);
      if (this.storedVersion !== null && version <= this.storedVersion) return;
      const roomId = this.roomId;
      const roomKey = this.roomKey;
      try {
        await saveRoom(this.config.storageUrl, roomId, roomKey, all, version);
        this.storedVersion = version;
        this.lastPersistedAt = Date.now();
        this.persistError = null;
        log(this.config, "persisted", all.length, "element(s) at version", version);
      } catch (err) {
        this.persistError = (err as Error).message;
        log(this.config, "persist failed:", this.persistError);
      }
    });
    return this.persistChain;
  }

  /** Write out anything pending; call before leaving so nothing is lost. */
  async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persist();
  }

  status(): RoomStatus {
    const all = [...this.scene.values()];
    return {
      connected: this.isConnected,
      roomId: this.roomId,
      room: this.roomId && this.roomKey ? `#room=${this.roomId},${"*".repeat(this.roomKey.length)}` : null,
      relayUrl: this.config.relayUrl,
      name: this.config.agentName,
      peers: [...this.peers.entries()].map(([socketId, name]) => ({ socketId, name })),
      source: this.source,
      elementCount: all.filter((el) => !el.isDeleted).length,
      deletedCount: all.filter((el) => el.isDeleted).length,
      sceneVersion: sceneVersion(all),
      lastRemoteUpdate: this.lastRemoteUpdate ? new Date(this.lastRemoteUpdate).toISOString() : null,
      persisted:
        this.config.storageUrl !== null &&
        this.storedVersion !== null &&
        this.storedVersion >= sceneVersion(all),
      lastPersistedAt: this.lastPersistedAt ? new Date(this.lastPersistedAt).toISOString() : null,
      persistError: this.persistError,
    };
  }

  async join(link: string): Promise<RoomStatus> {
    if (this.socket || this.roomId) this.teardown();

    const parsed = parseRoomLink(link);
    this.roomId = parsed.roomId;
    this.roomKey = parsed.roomKey;
    this.currentLink = parsed;
    this.scene.clear();
    this.peers.clear();
    this.source = null;
    this.lastRemoteUpdate = null;
    log(this.config, "joining", redactLink(parsed), "via", this.config.relayUrl, this.config.transport);

    await this.open(1);
    this.startPresence();
    return this.status();
  }

  /**
   * Connect, and retry once when the room has peers but never sends a scene.
   *
   * The relay occasionally drops the `new-user` that makes a browser send its
   * SCENE_INIT, which leaves the agent in a busy room with an empty canvas.
   * Leaving and rejoining makes the relay announce us again.
   */
  private async open(attempt: number): Promise<void> {
    let outcome: "scene" | "empty" | "no-scene-with-peers";
    try {
      outcome = await this.openSocket();
    } catch (err) {
      // A wedged relay accepts TCP and then never answers, which surfaces as a
      // handshake timeout. Give it two more chances before failing the join.
      if (attempt <= MAX_CONNECT_ATTEMPTS) {
        log(this.config, `connect attempt ${attempt} failed (${(err as Error).message}); retrying`);
        if (this.socket) hardClose(this.socket);
        this.socket = null;
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        return this.open(attempt + 1);
      }
      throw err;
    }
    if (outcome === "no-scene-with-peers" && attempt < 2) {
      log(this.config, "peers present but no scene after", INIT_TIMEOUT_MS, "ms; rejoining once");
      if (this.socket) hardClose(this.socket);
      this.socket = null;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return this.open(attempt + 1);
    }
    if (outcome === "no-scene-with-peers") {
      log(this.config, "still no scene after rejoining; continuing with what we have");
    }
  }

  private openSocket(): Promise<"scene" | "empty" | "no-scene-with-peers"> {
    const socket = io(this.config.relayUrl, {
      transports: [this.config.transport],
      extraHeaders: { Origin: this.config.origin },
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: INIT_TIMEOUT_MS,
    });
    this.socket = socket;

    let settled = false;
    return new Promise((resolve, reject) => {
      const done = (outcome: "scene" | "empty" | "no-scene-with-peers") => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(outcome);
      };
      const deadline = setTimeout(() => {
        if (this.source !== null) {
          done("scene");
          return;
        }
        done(this.peers.size > 0 ? "no-scene-with-peers" : "empty");
      }, INIT_TIMEOUT_MS);

      socket.on("connect_error", (err: Error) => {
        // Only the first attempt rejects the join; later ones are reconnects.
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(new Error(`relay ${this.config.relayUrl} refused the connection: ${err.message}`));
      });
      socket.on("connect", () => {
        log(this.config, "connected", socket.id);
      });
      socket.on("disconnect", (reason: string) => {
        log(this.config, "disconnected:", reason);
        this.stopPresence();
      });
      socket.on("init-room", () => {
        log(this.config, "init-room → join-room", this.roomId);
        socket.emit("join-room", this.roomId);
      });
      socket.on("first-in-room", () => {
        log(this.config, "first-in-room: no peers, loading the stored scene");
        void (async () => {
          await this.loadStored().catch((err) => log(this.config, "storage load failed", err));
          if (this.source === null) this.source = "empty";
          done("empty");
        })();
      });
      socket.on("new-user", (socketId: string) => {
        log(this.config, "new-user", socketId);
        // A browser hands its scene to whoever just arrived. An agent holding
        // nothing stays silent on purpose: an empty SCENE_INIT would blank the
        // browser's canvas, and the browser would then persist that blank.
        if (this.scene.size > 0) void this.broadcast("SCENE_INIT", this.elements(true));
        void this.announce("MOUSE_LOCATION");
      });
      socket.on("room-user-change", (socketIds: string[]) => {
        const next = new Map<string, string | null>();
        for (const id of socketIds) {
          if (id === this.socket?.id) continue;
          next.set(id, this.peers.get(id) ?? null);
        }
        this.peers = next;
      });
      socket.on("client-broadcast", (cipher: ArrayBuffer | Uint8Array, iv: Uint8Array) => {
        void this.ingest(cipher, iv).then(
          () => {
            if (this.source !== null) done("scene");
          },
          (err) => log(this.config, "dropped a peer message:", (err as Error).message),
        );
      });
    });
  }

  /** Announce ourselves the way a browser does, so people see who is editing. */
  private startPresence(): void {
    this.stopPresence();
    void this.announce("MOUSE_LOCATION").catch((err) => log(this.config, "presence failed", err));
    this.presenceTimer = setInterval(() => {
      void this.announce("IDLE_STATUS").catch((err) => log(this.config, "presence failed", err));
    }, IDLE_BROADCAST_MS);
    this.presenceTimer.unref();
  }

  private stopPresence(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }

  private async announce(type: "MOUSE_LOCATION" | "IDLE_STATUS"): Promise<void> {
    const socketId = this.socket?.id;
    if (!socketId) return;
    const common = {
      socketId,
      username: this.config.agentName,
      customData: { [AGENT_MARKER]: true },
    };
    const payload =
      type === "MOUSE_LOCATION"
        ? { ...common, pointer: { x: 0, y: 0, tool: "pointer" }, button: "up", selectedElementIds: {} }
        : { ...common, userState: "idle" };
    await this.emit(type, payload);
  }

  private async ingest(cipher: ArrayBuffer | Uint8Array, iv: Uint8Array): Promise<void> {
    if (!this.roomKey) return;
    const message = await decrypt<WireMessage>(this.roomKey, new Uint8Array(iv), cipher);
    const type = typeof message.type === "string" ? message.type : "";

    if (type === "SCENE_INIT" || type === "SCENE_UPDATE") {
      const incoming = Array.isArray(message.payload?.elements) ? message.payload.elements : [];
      const elements = incoming.filter(isSceneElement);
      const merged = reconcile([...this.scene.values()], elements);
      this.scene = new Map(merged.map((el) => [el.id, el]));
      this.lastRemoteUpdate = Date.now();
      if (type === "SCENE_INIT" && this.source === null) this.source = "peer";
      log(this.config, type, "with", elements.length, "element(s), scene now", this.scene.size);
      this.notifyScene();
      return;
    }

    if (type === "MOUSE_LOCATION" || type === "IDLE_STATUS") {
      const socketId = message.payload?.socketId;
      const username = message.payload?.username;
      if (typeof socketId === "string" && typeof username === "string" && socketId !== this.socket?.id) {
        this.peers.set(socketId, username);
      }
    }
  }

  private notifyScene(): void {
    for (const listener of this.sceneListeners) {
      try {
        listener();
      } catch (err) {
        log(this.config, "scene listener failed", err);
      }
    }
  }

  private async broadcast(type: "SCENE_INIT" | "SCENE_UPDATE", elements: SceneElement[]): Promise<void> {
    await this.emit(type, { elements });
  }

  private async emit(type: string, payload: unknown): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected || !this.roomKey || !this.roomId) return;
    const { ciphertext, iv } = await encryptJson(this.roomKey, { type, payload });
    socket.emit("server-broadcast", this.roomId, ciphertext, iv);
  }

  async leave(): Promise<void> {
    await this.flushPersist().catch((err) => log(this.config, "final persist failed", err));
    this.teardown();
  }

  private teardown(): void {
    this.stopPresence();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.socket) {
      hardClose(this.socket);
      this.socket = null;
    }
    this.roomId = null;
    this.roomKey = null;
    this.currentLink = null;
    this.scene.clear();
    this.peers.clear();
    this.source = null;
    this.storedVersion = null;
  }
}
