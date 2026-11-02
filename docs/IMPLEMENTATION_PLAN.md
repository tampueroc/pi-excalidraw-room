# Implementation Plan — pi-excalidraw-room (local-first)

Companion to `PRODUCT_SPEC.md`. This plan is grounded in the running stack, not on
assumptions about excalidraw.com. Every protocol claim below was verified against
`http://127.0.0.1:8082` (relay), `http://127.0.0.1:8081` (storage) and the deployed
frontend bundle on 2026-11-02.

## 1. Verified environment

| Fact | Value |
|---|---|
| Excalidraw frontend | `alswl/excalidraw:v0.18.1-fork-b2`, `http://127.0.0.1/` |
| Relay | `alswl/excalidraw-room-go:v0.1.0` (**Go**, zishang520 engine.io v2), `http://127.0.0.1:8082` |
| Storage | `alswl/excalidraw-storage-backend:v2023.11.11` (NestJS), `http://127.0.0.1:8081/api/v2` |
| Frontend env | `VITE_APP_STORAGE_BACKEND=http`, `VITE_APP_HTTP_STORAGE_BACKEND_URL=http://127.0.0.1:8081/api/v2`, `VITE_APP_WS_SERVER_URL=http://127.0.0.1:8082` |
| Pi | 1.5.0, extension API `pi.registerTool` / `pi.registerCommand`, TypeBox params |
| Node | 24.11.0 (spec asks 22+; fine) |
| Room link | `http://127.0.0.1/#room=<roomId>,<roomKey>` — roomId = 20 hex, roomKey = 22 base64url chars (128-bit AES key) |

Verified by probe scripts (see §9):

1. Handshake: `GET /socket.io/?EIO=4&transport=polling` → `0{"maxPayload":5242880,...,"upgrades":["websocket"]}`.
2. `socket.io-client` connects over `websocket` **and** polling/upgrade, with and without an `Origin` header.
3. Join sequence: `connect` → server emits `init-room` → client emits `join-room <roomId>` → server emits `first-in-room` (alone) or `room-user-change [ids]`, and existing peers get `new-user <id>`.
4. Encrypted broadcast round-trip through the relay works: AES-GCM/A128GCM, JSON `{type, payload}`, 12-byte IV.
   Peer B received and decrypted peer A's `SCENE_INIT` (1 rectangle).
5. The relay does **not** persist: a fresh join to a used room always gets `first-in-room`, never a replayed scene.
   Scene survival is entirely the storage backend's job (the frontend writes `/api/v2/rooms/:id`).
6. Storage routes: `PUT|GET /api/v2/rooms/:id`, `POST /api/v2/scenes`, `GET /api/v2/scenes/:id`, `PUT|GET /api/v2/files/:id`.
7. Relay binary contains `init-room`, `join-room`, `first-in-room`, `new-user`, `room-user-change`,
   `client-broadcast`, `server-broadcast`, `server-volatile-broadcast`, `user-follow`, `leave-room`,
   `create-room`, `delete-room` → protocol-compatible with upstream `excalidraw-room`.

### Corrections to PRODUCT_SPEC.md this plan assumes

- The relay is **Go** (`excalidraw-room-go`), not the Node `excalidraw-room`. Upstream-compatible, but its quirks are ours.
- Persistence is **HTTP storage backend**, not Firestore. `excalidraw-room-mcp/src/firebase.ts` is not reusable; `crypto.ts` / `reconcile.ts` / `elements.ts` are.
- The relay persists nothing; without the storage client, scenes die on browser reload.
- `env.js` reports `PKG_VERSION: '0.15.0'` while the image is 0.18.1 — cosmetic, ignore.

## 2. Wire protocol contract (verified)

```
server → "init-room"                       client → "join-room", roomId
server → "first-in-room"                   (we are alone: nothing to receive)
server → "new-user", socketId              (a peer joined: send it SCENE_INIT)
server → "room-user-change", socketId[]    (participant list; includes us)
server → "client-broadcast", cipher, iv    peer message; decrypt with roomKey
client → "server-broadcast", roomId, cipher, iv
```

Plaintext payloads (JSON, UTF-8, then AES-GCM with the room key):

```jsonc
{ "type": "SCENE_INIT",   "payload": { "elements": [ /* full scene */ ] } }
{ "type": "SCENE_UPDATE", "payload": { "elements": [ /* changed subset */ ] } }
{ "type": "MOUSE_LOCATION", "payload": { "socketId", "pointer": {x,y,tool}, "button", "selectedElementIds", "username" } }
{ "type": "IDLE_STATUS",    "payload": { "socketId", "userState", "username" } }
```

Rules:
- Every element in a broadcast must have `version` bumped and `versionNonce` refreshed, or peers discard it.
- **Never broadcast an empty `SCENE_INIT`.** A browser applies whatever arrives: an empty init blanks the
  person's canvas, and the browser then persists that blank scene. An agent with nothing to say stays silent,
  and the browser falls back to the stored scene on its own (verified against `collab/Collab.tsx`).
- Merge rule (upstream `reconcile.ts`): per `id`, keep higher `version`; on tie keep lower `versionNonce`.
  Deletion = `isDeleted: true` + version bump, never removal from the array.
- Text is streamed per keystroke by browsers; do not react to content mid-typing.

### Persistence format (decoded from the deployed bundle)

```
PUT http://127.0.0.1:8081/api/v2/rooms/<roomId>
body = uint32BE scVersion || iv(12 bytes) || AES-GCM(roomKey, JSON.stringify(elements))

GET  .../rooms/<roomId> → same layout; 404 when the room was never saved
```
Save only if the fetched `scVersion` is behind ours (the frontend compares versions and
skips the write otherwise). Files use `PUT|GET /api/v2/files/:id` with
`{data, metadata}` encrypted, keyed by file id.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Transport | `socket.io-client` with `transports: ["websocket"]` | Fewer round trips than polling→upgrade; both verified. Keep polling as automatic fallback for reconnect. |
| Origin header | Send `Origin: <EXCALIDRAW_URL>` always | Harmless locally, required by public/nginx relays. |
| Element builders | Vendor a subset of `excalidraw-room-mcp/src/elements.ts` + `reconcile.ts` | MIT, already validated against 0.18 element shape. Attribution in `NOTICE`. Do **not** import `@excalidraw/excalidraw` in Node (DOM-bound). |
| Crypto | Port of `packages/excalidraw/data/encryption.ts` (WebCrypto AES-GCM 128) | Same as MCP `crypto.ts`; verified over the relay. |
| Persistence | Local storage client for `/api/v2/rooms/:id` | Relay keeps nothing; needed for reload survival. Optional at first run, required for Phase 2 acceptance. |
| Scene state | `Map<id, element>` + `reconcile()` | Same as MCP; matches browser semantics. |
| Config | env vars only, plus `/excalidraw join <url>`; no config file | Spec already defines the variables. |
| Agent presence | `username` in MOUSE_LOCATION/IDLE_STATUS + `customData.excalidrawRoomAgent` marker | Browsers ignore unknown keys; lets multiple agents spot each other later. |

## 4. Module plan

```
src/
  index.ts            default export (pi) → wires config, client, tools, command
  config.ts           env parsing + defaults; resolves relay/origin/storage URLs
  link.ts             parse "#room=<id>,<key>" and "<id>,<key>"; validation (20/22 chars)
  client/
    socket.ts         connect(), reconnect policy, event fan-out
    room-client.ts    join/leave/status, peers, scene map, broadcast(), ingestRemote()
    crypto.ts         encrypt/decrypt JSON payloads (AES-GCM 128)
  scene/
    elements.ts       builders: rectangle | ellipse | diamond | text | arrow | label
    mutations.ts      add / update / move / delete / connect → SCENE_UPDATE payload
    bindings.ts       arrow+shape bindings, bound text containers, geometry
    reconcile.ts      shouldDiscardRemote / reconcile / orderByIndex / sceneVersion
  storage/
    http-storage.ts   GET/PUT rooms; file upload for image elements (later)
  tools/
    room.ts           excalidraw_join | leave | status
    scene.ts          excalidraw_read | add | update | move | delete | connect
    files.ts          excalidraw_import | export
  commands/excalidraw.ts   /excalidraw join|leave|status|open|export|import
tests/
  unit/*.test.ts      crypto, link, reconcile, elements, http-storage body layout
  e2e/peers.ts        two headless peers over the live relay (the harness from §9)
```

Key signatures:

```ts
class RoomClient {
  join(link: string, opts?: { name?: string }): Promise<RoomStatus>
  leave(): Promise<void>
  status(): RoomStatus
  elements(includeDeleted?: boolean): ExcalidrawElement[]
  applyLocal(mutate: (scene: SceneMutator) => void): Promise<CommitResult>
  on("scene", (elements) => void): void
}
```

`applyLocal` is the single write path: it mutates the local map, bumps versions,
computes the minimal changed subset, encrypts and emits one `SCENE_UPDATE`, then
schedules a debounced persist. Nothing else emits.

Tool responses stay small: `{ ok, changed: [{id, type}], sceneVersion, error? }` plus a
one-line human summary. Never dump the whole scene from a write tool.

## 5. Milestones

### M0 — Skeleton (½ day) — **done**
`package.json` (`"pi": { "extensions": ["./src/index.ts"] }`, dep `socket.io-client`),
`tsconfig.json` (NodeNext, ESM, `.js` import suffixes), `src/index.ts` with
`/excalidraw status` and `excalidraw_status`.
**Accept:** `pi -e ./src/index.ts`, `/excalidraw status` → "not connected".

### M1 — Join + read (1 day) — **done**
`link.ts`, `crypto.ts`, `reconcile.ts`, `socket.ts`, `room-client.ts` join flow;
`excalidraw_join`, `excalidraw_read` (summary: count, types, bounding box, labels;
optional `ids`/`region` filter).
**Accept:** join the local room from Pi; a rectangle drawn in the browser shows up in
`excalidraw_read`; `excalidraw_status` lists the browser peer.

### M2 — Write (1½ days) — **done**
`elements.ts` (rectangle, ellipse, diamond, text), `mutations.ts` add/update/delete,
`excalidraw_add`, `excalidraw_update`, `excalidraw_delete`.
**Accept:** a rectangle created by Pi appears in the open browser tab without refresh;
renaming its text updates in place; deleting removes it while a person's nearby elements
stay untouched.

### M3 — Arrows, labels, move (1 day) — **done**
`bindings.ts` (inside/orbit binding points, `boundElements`, label text containers),
`excalidraw_connect`, `excalidraw_move`.
**Accept:** labels survive a resize; dragging a bound shape in the browser keeps the
arrow attached; `excalidraw_move` retargets bound arrows.

### M4 — Persistence + reconnect (1 day) — **done**
`http-storage.ts` (body layout from §2), load on `first-in-room`, debounced persist after
commits, full reload on reconnect.
**Accept:** reload the browser tab with no other peer → scene restored; kill and restart the
room container → Pi reconnects, re-persists, nothing duplicated or lost.

### M5 — Files + ergonomics (1 day) — **done**, except `/excalidraw open` for a link that was never pasted
`excalidraw_import` / `excalidraw_export` (`.excalidraw` JSON), `/excalidraw open|export|import`,
peer names in status, error surfaces (relay down, bad link, storage 4xx).

### Out of scope for the first pass
Auto-layout, notes addressed to the agent (`@pi`), multi-room, snapshot rendering,
image element uploads.

## 6. Testing

- **Unit (node --test):** crypto round-trip, link parsing, reconcile tie-breaking,
  builders (element field completeness, `versionNonce` changes, binding geometry),
  storage body layout (uint32 ‖ iv ‖ ciphertext).
- **Interop fixture:** decrypt a scene blob produced by the deployed frontend bundle
  (`/rooms/:id` capture) and re-encrypt it; parse both with the builders. Guards against
  0.18.1 element-shape drift.
- **Two-peer e2e (§9 harness):** no browser needed; asserts join, SCENE_INIT fan-out,
  SCENE_UPDATE apply, version bump, and file-based persistence through the storage API.
- **Manual browser checklist** (the only true acceptance): add → visible; update → visible;
  person's edit → readable; reload → restored; container restart → reconnect.

## 7. Risks and mitigations

| Risk | Evidence | Mitigation |
|---|---|---|
| Go relay panics (`fatal error: sync: inconsistent mutex state`, engine.io v2) and stays down | One occurrence during probing, 5/5 clean afterwards; `basic-room-1` has no restart policy | Add `restart: always` to the local compose; client reconnect with backoff; document `docker start basic-room-1` |
| Storage backend crashes on malformed body (`ERR_INVALID_ARG_TYPE`) | `PUT /rooms/:id` with `{}` killed the container; it restarted via `restart: always` | Validate body locally; never PUT on unvalidated input; treat 4xx/5xx as `NOT PERSISTED` and retry |
| No relay-side persistence | Verified: `first-in-room` on every fresh join | M4 storage client is mandatory for reload survival |
| Frontend shows `unhealthy` in `docker ps` while serving 200 | Observed | Check the frontend healthcheck path; not blocking |
| Element shape drift vs builders | 0.18.1 fork ≠ MCP's tested 0.18.0 | Interop fixture test; keep builder fields explicit |
| Prompt injection via canvas text | N/A yet | Canvas text is never treated as instructions; only explicit user messages drive edits |

## 8. Open questions

1. Persistence now (M4) or after the live-editing loop works end to end (M1–M3)?
2. Should the extension auto-join on session start from an env var, or require `/excalidraw join`?
3. Do you want agent-created elements visually marked (e.g. `customData.author = "pi"`)?
4. Multiple rooms later, or is one room per session enough?

## 9. Probe scripts used (reproducible)

- Handshake: `curl 'http://127.0.0.1:8082/socket.io/?EIO=4&transport=polling'`
- Join flow: 30-line `socket.io-client` script (connect → init-room → join-room, log peers).
- Crypto round-trip: two peers, `SCENE_INIT` encrypted with key `AAAAAAAAAAAAAAAAAAAAAA`.
- Persistence check: peer A broadcasts then leaves; peer B joins → `first-in-room`, no replay.
- Storage body: decoded from `index-Dl-AINLd.js` in the frontend image
  (`new Blob([uint32BE(version), iv, ciphertext])` → `PUT ${base}/rooms/${roomId}`).
